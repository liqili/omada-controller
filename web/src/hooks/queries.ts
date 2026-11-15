import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { listSites, createSite } from '../api/domains/site';
import {
  listDevices,
  getPendingDeviceGrid,
  getDevice,
  getOverview,
  adoptDevices,
  type AdoptTarget,
  type DeviceAccount,
  forgetDevice,
  deviceCmd,
  type DeviceCommand,
} from '../api/domains/device';
import { listActiveClients, clientCmd } from '../api/domains/client';
import {
  getSetting,
  getSettingList,
  getSiteSetting,
  listScenarios,
  patchSiteSetting,
  saveSetting,
  type SaveVerb,
} from '../api/domains/settings';
import {
  listWlanGroups,
  createWlanGroup,
  renameWlanGroup,
  deleteWlanGroup,
  listSsids,
  createSsid,
  updateSsid,
  deleteSsid,
  getSsidLookups,
  type Ssid,
} from '../api/domains/wlan';
import { listLogs, getAlertNum, getLogNums, type LogKind, type LogQuery } from '../api/domains/logs';
import {
  listUsers,
  getCurrentUser,
  listFirmwares,
  listVouchers,
  listAvailableRoles,
  getAccountSites,
  addAccount,
  editAccount,
  deleteAccount,
  confirmOwnPassword,
  type AccountInput,
  type ControllerUser,
} from '../api/domains/admin';
import {
  getRfPlanning,
  putRfPlanningConfig,
  startRfPlanning,
  cancelRfPlanning,
} from '../api/domains/rfPlanning';
import { getGlobalSetting, patchGlobalSetting, type GlobalSetting } from '../api/domains/global';
import { getInitialization } from '../api/domains/auth';
import {
  getApDetail,
  getChannelInfo,
  saveApConfig,
  getFirmwareInfo,
  getOnlineUpgradeStatus,
  startOnlineUpgrade,
  manualUpgrade,
  type ApConfigSection,
} from '../api/domains/ap';
import {
  getConfigFeatures,
  listConfigComponents,
  listConfigResultDevices,
  reapplyDeviceConfig,
  type ConfigResultQuery,
  type ConfigStatus,
} from '../api/domains/configResult';
import type { Device } from '../api/types';
import { deviceStatus } from '../components/StatusChip';

const POLL = 30_000;

export function useSites() {
  return useQuery({ queryKey: ['sites'], queryFn: listSites });
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });
}

// Controller first-run state — anonymous endpoint, cheap, never poll:
// it only flips false→true once via the setup wizard.
export function useInitialization() {
  return useQuery({
    queryKey: ['initialization'],
    queryFn: getInitialization,
    staleTime: 60_000,
    retry: false,
  });
}

export function useOverview(siteId?: string) {
  return useQuery({
    queryKey: ['overview', siteId],
    queryFn: () => getOverview(),
    refetchInterval: POLL,
  });
}

// Adoption/provisioning settle in seconds, so poll fast while any device is
// in one of those short-lived states and fall back to the normal interval.
const FAST_POLL = 2_000;
const anyTransient = (devices?: Device[]) => (devices ?? []).some((d) => deviceStatus(d.status, d.statusCategory).transient);

// A device command (adopt, forget, reboot, …) moves the device between the
// pending and adopted lists a few seconds later. The list it is about to join
// has nothing transient in it yet, so `anyTransient` alone would leave that
// list on the slow interval and the device would seem to vanish for up to 30 s.
// Keep every device query on the fast interval for a short while instead.
const SETTLE_MS = 30_000;
let settleUntil = 0;
const devicePoll = (devices?: Device[]) => (Date.now() < settleUntil || anyTransient(devices) ? FAST_POLL : POLL);

function deviceChanged(qc: QueryClient, mac?: string) {
  settleUntil = Date.now() + SETTLE_MS;
  qc.invalidateQueries({ queryKey: ['devices'] });
  qc.invalidateQueries({ queryKey: ['pendingDevices'] });
  qc.invalidateQueries({ queryKey: ['overview'] });
  if (mac) qc.invalidateQueries({ queryKey: ['device', mac] });
}

export function useDevices(siteId: string | undefined) {
  return useQuery({
    queryKey: ['devices', siteId],
    queryFn: () => (siteId ? listDevices(siteId) : []),
    enabled: Boolean(siteId),
    refetchInterval: (q) => devicePoll(q.state.data),
  });
}

/** Pending grid incl. deviceStat category counts — powers the Add dialog tabs. */
export function usePendingDevices() {
  return useQuery({
    queryKey: ['pendingDevices'],
    queryFn: getPendingDeviceGrid,
    refetchInterval: (q) => devicePoll(q.state.data?.data),
  });
}

export function useDevice(siteId: string | undefined, mac: string | undefined) {
  return useQuery({
    queryKey: ['device', mac],
    queryFn: () => (mac ? getDevice(siteId, mac) : undefined),
    enabled: Boolean(mac),
    refetchInterval: (q) => devicePoll(q.state.data ? [q.state.data] : []),
  });
}

export function useClients(siteId: string | undefined) {
  return useQuery({
    queryKey: ['clients', siteId],
    queryFn: () => (siteId ? listActiveClients(siteId) : []),
    enabled: Boolean(siteId),
    refetchInterval: POLL,
  });
}

// — mutations (device adoption / actions, clients) —

/** Adopt pending devices; `siteId` in the input overrides the current site (Add dialog's target). */
export function useAdoptMany(siteId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ devices, account, siteId: target }: { devices: AdoptTarget[]; account?: DeviceAccount; siteId?: string }) =>
      target ?? siteId ? adoptDevices((target ?? siteId)!, devices, account) : Promise.reject(new Error('no site selected')),
    // Also on failure: a refused adopt moves the device to "Adopt failed"
    // (the vendor UI refreshes the row from the error's result).
    onSettled: () => deviceChanged(qc),
  });
}

export function useForgetDevice(siteId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mac: string) =>
      siteId ? forgetDevice(siteId, mac) : Promise.reject(new Error('no site selected')),
    onSuccess: () => deviceChanged(qc),
  });
}

export function useDeviceCmd(siteId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mac, cmd, enable }: { mac: string; cmd: DeviceCommand; enable?: boolean }) =>
      siteId ? deviceCmd(siteId, mac, cmd, enable) : Promise.reject(new Error('no site selected')),
    onSuccess: (_r, { mac }) => deviceChanged(qc, mac),
  });
}

export function useClientCmd(siteId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mac, cmd }: { mac: string; cmd: 'block' | 'unblock' | 'forget' | 'auth' | 'unauth' }) =>
      siteId ? clientCmd(siteId, mac, cmd) : Promise.reject(new Error('no site selected')),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients', siteId] }),
  });
}

// — settings / rf planning —

const noSite = () => Promise.reject(new Error('no site selected'));

// Wireless: WLAN groups → SSIDs (see api/domains/wlan.ts for the verified verbs).

export function useWlanGroups(siteId: string | undefined) {
  return useQuery({
    queryKey: ['wlanGroups', siteId],
    queryFn: () => listWlanGroups(siteId!),
    enabled: Boolean(siteId),
  });
}

export function useWlanGroupMutations(siteId: string | undefined) {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['wlanGroups', siteId] });
  return {
    create: useMutation({
      mutationFn: (name: string) => (siteId ? createWlanGroup(siteId, name) : noSite()),
      onSuccess,
    }),
    rename: useMutation({
      mutationFn: (v: { wlanId: string; name: string }) =>
        siteId ? renameWlanGroup(siteId, v.wlanId, v.name) : noSite(),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (wlanId: string) => (siteId ? deleteWlanGroup(siteId, wlanId) : noSite()),
      onSuccess,
    }),
  };
}

export function useSsids(siteId: string | undefined, wlanId: string | undefined) {
  return useQuery({
    queryKey: ['ssids', siteId, wlanId],
    queryFn: () => listSsids(siteId!, wlanId!),
    enabled: Boolean(siteId && wlanId),
  });
}

export function useSsidMutations(siteId: string | undefined, wlanId: string | undefined) {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['ssids', siteId] });
  const ready = siteId && wlanId;
  return {
    save: useMutation({
      mutationFn: async ({ id, body }: { id?: string; body: Ssid }) => {
        if (!ready) return noSite();
        if (id) await updateSsid(siteId, wlanId, id, body);
        else await createSsid(siteId, wlanId, body);
      },
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (ssidId: string) => (ready ? deleteSsid(siteId, wlanId, ssidId) : noSite()),
      onSuccess,
    }),
  };
}

/** Profiles and site facts the SSID editor offers (refetched each time it opens). */
export function useSsidLookups(siteId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['ssidLookups', siteId],
    queryFn: () => getSsidLookups(siteId!),
    enabled: Boolean(siteId) && enabled,
    staleTime: 0,
  });
}

// Generic site setting resources: object-shaped (form) and list-shaped (table).

export function useSetting<T = Record<string, unknown>>(siteId: string | undefined, resource: string) {
  return useQuery({
    queryKey: ['setting', siteId, resource],
    queryFn: () => getSetting<T>(siteId!, resource),
    enabled: Boolean(siteId),
    retry: false,
  });
}

export function useSaveSetting(siteId: string | undefined, resource: string, verb: SaveVerb) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => (siteId ? saveSetting(siteId, resource, verb, body) : noSite()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setting', siteId, resource] }),
  });
}

export function useSettingList<T = Record<string, unknown>>(
  siteId: string | undefined,
  resource: string,
  params?: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ['settingList', siteId, resource, params],
    queryFn: () => getSettingList<T>(siteId!, resource, params),
    enabled: Boolean(siteId),
    retry: false,
  });
}

export function useSiteSetting<T = Record<string, unknown>>(siteId: string | undefined) {
  return useQuery({
    queryKey: ['siteSetting', siteId],
    queryFn: () => getSiteSetting<T>(siteId!),
    enabled: Boolean(siteId),
  });
}

export function usePatchSiteSetting(siteId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => (siteId ? patchSiteSetting(siteId, body) : noSite()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['siteSetting', siteId] });
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });
}

/** Site scenario names (Office, Home, …) — GET scenarios, verified live. */
export function useScenarios() {
  return useQuery({
    queryKey: ['scenarios'],
    queryFn: async () => (await listScenarios()).filter((s): s is string => Boolean(s)),
    staleTime: Infinity,
    retry: false,
  });
}

// Logs & alerts.

export function useLogs(siteId: string | undefined, kind: LogKind, query: LogQuery) {
  return useQuery({
    queryKey: ['logs', siteId, kind, query],
    queryFn: () => listLogs(siteId!, kind, query),
    enabled: Boolean(siteId),
    retry: false,
  });
}

export function useAlertNum(siteId: string | undefined) {
  return useQuery({
    queryKey: ['alertNum', siteId],
    queryFn: () => getAlertNum(siteId!),
    enabled: Boolean(siteId),
    refetchInterval: POLL,
    retry: false,
  });
}

export function useLogNums() {
  return useQuery({ queryKey: ['logNums'], queryFn: getLogNums, retry: false });
}

// Controller administration (read-only).

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: listUsers, retry: false });
}

export function useCurrentUser() {
  return useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser, retry: false });
}

export function useAvailableRoles(enabled = true) {
  return useQuery({ queryKey: ['rolesAvailable'], queryFn: listAvailableRoles, enabled, retry: false });
}

export function useAccountSites(userId: string | undefined) {
  return useQuery({
    queryKey: ['accountSites', userId],
    queryFn: () => getAccountSites(userId!),
    enabled: Boolean(userId),
    retry: false,
  });
}

function accountsChanged(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['users'] });
  qc.invalidateQueries({ queryKey: ['accountSites'] });
  qc.invalidateQueries({ queryKey: ['currentUser'] });
}

export function useAddAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, allSiteIds }: { input: AccountInput; allSiteIds: string[] }) => addAccount(input, allSiteIds),
    onSuccess: () => accountsChanged(qc),
  });
}

/** Edit; for your own account pass `ownPassword` (checked first, as the vendor UI does). */
export function useEditAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      user,
      input,
      allSiteIds,
      ownPassword,
      forceModify,
    }: {
      user: ControllerUser;
      input: AccountInput;
      allSiteIds: string[];
      ownPassword?: string;
      forceModify?: boolean;
    }) => {
      const token = ownPassword ? await confirmOwnPassword(user.id, ownPassword) : undefined;
      await editAccount(user, input, allSiteIds, { token, forceModify });
    },
    onSuccess: () => accountsChanged(qc),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: deleteAccount, onSuccess: () => accountsChanged(qc) });
}

export function useFirmwares() {
  return useQuery({ queryKey: ['firmwares'], queryFn: listFirmwares, retry: false });
}

export function useVouchers(siteId: string | undefined) {
  return useQuery({
    queryKey: ['vouchers', siteId],
    queryFn: () => listVouchers(siteId!),
    enabled: Boolean(siteId),
    retry: false,
  });
}

export function useRfPlanning(siteId: string | undefined) {
  return useQuery({
    queryKey: ['rfplanning', siteId],
    queryFn: () => (siteId ? getRfPlanning(siteId) : null),
    enabled: Boolean(siteId),
  });
}

export function useRfPlanningRun(siteId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (start: boolean) =>
      !siteId
        ? Promise.reject(new Error('no site selected'))
        : start
          ? startRfPlanning(siteId)
          : cancelRfPlanning(siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rfplanning', siteId] }),
  });
}

export function usePutRfPlanningConfig(siteId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      siteId ? putRfPlanningConfig(siteId, body) : Promise.reject(new Error('no site selected')),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rfplanning', siteId] }),
  });
}

// — controller-level global settings —

export function useGlobalSetting() {
  return useQuery({ queryKey: ['globalSetting'], queryFn: getGlobalSetting });
}

export function usePutGlobalSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GlobalSetting) => patchGlobalSetting(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['globalSetting'] }),
  });
}

// — per-device configuration and firmware (api/domains/ap.ts) —

export function useApDetail(siteId: string | undefined, mac: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['apDetail', siteId, mac],
    queryFn: () => getApDetail(siteId!, mac!),
    enabled: Boolean(siteId && mac && enabled),
  });
}

export function useChannelInfo(siteId: string | undefined, mac: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['channelInfo', siteId, mac],
    queryFn: () => getChannelInfo(siteId!, mac!),
    enabled: Boolean(siteId && mac && enabled),
    staleTime: 5 * 60_000,
  });
}

export function useSaveApConfig(siteId: string | undefined, mac: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ section, body }: { section: ApConfigSection; body: object }) =>
      siteId && mac ? saveApConfig(siteId, mac, section, body) : Promise.reject(new Error('no device selected')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apDetail', siteId, mac] });
      deviceChanged(qc, mac);
    },
  });
}

export function useFirmwareInfo(siteId: string | undefined, mac: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['firmware', siteId, mac],
    queryFn: () => getFirmwareInfo(siteId!, mac!),
    enabled: Boolean(siteId && mac && enabled),
  });
}

export function useOnlineUpgradeStatus(siteId: string | undefined, mac: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['onlineUpgradeStatus', siteId, mac],
    queryFn: () => getOnlineUpgradeStatus(siteId!, mac!),
    enabled: Boolean(siteId && mac && enabled),
    refetchInterval: (q) => (q.state.data ? FAST_POLL : false),
  });
}

function firmwareChanged(qc: QueryClient, siteId?: string, mac?: string) {
  qc.invalidateQueries({ queryKey: ['firmware', siteId, mac] });
  qc.invalidateQueries({ queryKey: ['onlineUpgradeStatus', siteId, mac] });
  deviceChanged(qc, mac);
}

export function useOnlineUpgrade(siteId: string | undefined, mac: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => (siteId && mac ? startOnlineUpgrade(siteId, mac) : Promise.reject(new Error('no device selected'))),
    onSuccess: () => firmwareChanged(qc, siteId, mac),
  });
}

export function useManualUpgrade(siteId: string | undefined, device: { mac: string; type?: string } | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: (f: number) => void }) =>
      siteId && device ? manualUpgrade(siteId, device, file, onProgress) : Promise.reject(new Error('no device selected')),
    onSuccess: () => firmwareChanged(qc, siteId, device?.mac),
  });
}

// ── Configuration results (Devices → Configuration Results) ─────────────────

export function useConfigResultDevices(siteId: string | undefined, query: ConfigResultQuery) {
  return useQuery({
    queryKey: ['configResult', 'devices', siteId, query],
    queryFn: () => listConfigResultDevices(siteId!, query),
    enabled: Boolean(siteId),
    placeholderData: keepPreviousData,
    refetchInterval: POLL,
    retry: false,
  });
}

export function useConfigFeatures(
  siteId: string | undefined,
  device: { mac: string; type?: string } | undefined,
  status: ConfigStatus,
) {
  return useQuery({
    queryKey: ['configResult', 'features', siteId, device?.mac, status],
    queryFn: () => getConfigFeatures(siteId!, device!.mac, { status, deviceType: device?.type }),
    enabled: Boolean(siteId && device),
    retry: false,
  });
}

export function useConfigComponents(
  siteId: string | undefined,
  mac: string | undefined,
  q: { feature: string; status: ConfigStatus; page: number; pageSize: number } | undefined,
) {
  return useQuery({
    queryKey: ['configResult', 'components', siteId, mac, q],
    queryFn: () => listConfigComponents(siteId!, mac!, q!),
    enabled: Boolean(siteId && mac && q),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useReapplyConfig(siteId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mac: string) => (siteId ? reapplyDeviceConfig(siteId, mac) : Promise.reject(new Error('no site selected'))),
    onSettled: () => qc.invalidateQueries({ queryKey: ['configResult'] }),
  });
}
