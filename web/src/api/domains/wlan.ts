import { api, getAllPages, scoped, unwrap } from '../client';

// Wireless networks — WLAN groups and their SSIDs.
// All verbs below were live-verified against controller v5.15.6.7 on
// 2026-11-13 with a create → edit → delete cycle (nothing left behind):
//
//   GET    sites/{sid}/setting/wlans                         → {data:[group], maxSsids2G/5G/6G/Mlo}
//   POST   sites/{sid}/setting/wlans        {name, clone}    → {wlanId}
//   PATCH  sites/{sid}/setting/wlans/{wlanId} {name}
//   DELETE sites/{sid}/setting/wlans/{wlanId}
//   GET    sites/{sid}/setting/wlans/{wlanId}/ssids?currentPage&currentPageSize
//   POST   sites/{sid}/setting/wlans/{wlanId}/ssids          → {ssidId}
//   PATCH  sites/{sid}/setting/wlans/{wlanId}/ssids/{ssidId} (full body, see ssidForm.ts)
//   DELETE sites/{sid}/setting/wlans/{wlanId}/ssids/{ssidId}
//
// WPA3 (versionPsk 4 + pmfMode 1) create → delete also verified.
//
// Things that look optional but are not:
//   - `band` is a BITMASK (1 = 2.4 GHz, 2 = 5 GHz, 4 = 6 GHz). 0 → -1001.
//   - `pmfMode` must be 1 (mandatory) | 2 (capable) | 3 (disabled).
//   - PATCH needs the whole SSID; a partial body → "-1001 … should not be null".
//   - There is no GET for a single SSID (→ -1600) and no per-SSID enable flag.
//   - The flat `setting/ssids` resource is read-only.

export const BAND_2G = 1;
export const BAND_5G = 2;
export const BAND_6G = 4;

export const SECURITY = {
  NONE: 0,
  WPA_ENTERPRISE: 2,
  WPA_PERSONAL: 3,
  PPSK_WITHOUT_RADIUS: 4,
  PPSK_WITH_RADIUS: 5,
} as const;

export const SECURITY_LABEL: Record<number, string> = {
  0: 'Open',
  2: 'WPA-Enterprise',
  3: 'WPA-Personal',
  4: 'PPSK',
  5: 'PPSK + RADIUS',
};

export const PMF = { MANDATORY: 1, CAPABLE: 2, DISABLED: 3 } as const;

export interface WlanGroup {
  id: string;
  name: string;
  primary?: boolean;
  clone?: boolean;
  site?: string;
}

export interface WlanGroupList {
  groups: WlanGroup[];
  maxSsids2G?: number;
  maxSsids5G?: number;
  maxSsids6G?: number;
  maxSsidsMlo?: number;
}

export interface RateLimit {
  rateLimitId?: string;
  downLimitEnable?: boolean;
  downLimit?: number;
  /** 0 = Kbps, 1 = Mbps */
  downLimitType?: number;
  upLimitEnable?: boolean;
  upLimit?: number;
  upLimitType?: number;
}

export interface PskSetting {
  securityKey?: string;
  /** 1 = WPA, 2 = WPA2, 3 = WPA/WPA2, 4 = WPA3 */
  versionPsk: number;
  /** 1 = auto, 3 = AES */
  encryptionPsk: number;
  gikRekeyPskEnable: boolean;
  rekeyPskInterval?: number;
  intervalPskType?: number;
}

export interface Ssid {
  id?: string;
  name: string;
  wlanId?: string;
  band: number;
  guestNetEnable: boolean;
  security: number;
  broadcast: boolean;
  vlanSetting?: { mode: number; customConfig?: Record<string, unknown> };
  pskSetting?: PskSetting;
  rateLimit: RateLimit;
  ssidRateLimit: RateLimit;
  wlanScheduleEnable: boolean;
  action?: number;
  rateAndBeaconCtrl?: Record<string, unknown>;
  macFilterEnable: boolean;
  policy?: number;
  enable11r?: boolean;
  pmfMode: number;
  multiCastSetting?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface SsidList {
  ssids: Ssid[];
  total: number;
  ssidNum2g?: number;
  ssidNum5g?: number;
  ssidNum6g?: number;
  ssidNumMlo?: number;
}

const wlans = (siteId: string, rest = '') => scoped(`/api/v2/sites/${siteId}/setting/wlans${rest}`);

export async function listWlanGroups(siteId: string): Promise<WlanGroupList> {
  const r = await unwrap<{ data?: WlanGroup[] } & Omit<WlanGroupList, 'groups'>>(api.get(wlans(siteId)));
  const { data, ...limits } = r ?? {};
  return { groups: data ?? [], ...limits };
}

export async function createWlanGroup(siteId: string, name: string): Promise<string | undefined> {
  const r = await unwrap<{ wlanId?: string }>(api.post(wlans(siteId), { name: name.trim(), clone: false }));
  return r?.wlanId;
}

export async function renameWlanGroup(siteId: string, wlanId: string, name: string): Promise<void> {
  await unwrap<unknown>(api.patch(wlans(siteId, `/${wlanId}`), { name: name.trim() }));
}

export async function deleteWlanGroup(siteId: string, wlanId: string): Promise<void> {
  await unwrap<unknown>(api.delete(wlans(siteId, `/${wlanId}`)));
}

export async function listSsids(siteId: string, wlanId: string): Promise<SsidList> {
  const r = await getAllPages<{ data?: Ssid[]; totalRows?: number } & Omit<SsidList, 'ssids' | 'total'>>(
    wlans(siteId, `/${wlanId}/ssids`),
  );
  const { data, totalRows, ...counts } = r ?? {};
  return { ssids: data ?? [], total: totalRows ?? data?.length ?? 0, ...counts };
}

// Bodies come from ssidForm.serializeSsid() — the legacy editor's exact shape.
export async function createSsid(siteId: string, wlanId: string, body: Ssid): Promise<string | undefined> {
  const r = await unwrap<{ ssidId?: string }>(api.post(wlans(siteId, `/${wlanId}/ssids`), body));
  return r?.ssidId;
}

export async function updateSsid(siteId: string, wlanId: string, ssidId: string, body: Ssid): Promise<void> {
  await unwrap<unknown>(api.patch(wlans(siteId, `/${wlanId}/ssids/${ssidId}`), body));
}

export async function deleteSsid(siteId: string, wlanId: string, ssidId: string): Promise<void> {
  await unwrap<unknown>(api.delete(wlans(siteId, `/${wlanId}/ssids/${ssidId}`)));
}

// — Lookups the SSID editor uses (same endpoints as the vendor form) —

export interface RateLimitProfile {
  id: string;
  name: string;
  isDefault?: boolean;
  downLimitEnable?: boolean;
  downLimit?: number;
  downLimitType?: number;
  upLimitEnable?: boolean;
  upLimit?: number;
  upLimitType?: number;
}
export interface TimeRange {
  id: string;
  name: string;
  /** 0 every day, 1 weekdays, 2 weekend, 3 custom */
  dayMode?: number;
}
export interface RadiusProfile {
  radiusProfileId: string;
  name: string;
  builtInServer?: boolean;
  authServer?: unknown[];
  acctServer?: unknown[];
  domainEnable?: boolean;
}
export interface PpskProfile {
  id: string;
  profileName: string;
  /** 0 without RADIUS, 1 with the built-in RADIUS server */
  type: number;
}
export interface MacGroup {
  groupId: string;
  name: string;
  macAddressList?: { macAddress: string; name?: string }[];
}
export interface LanNetworkOption {
  value: string;
  label: string;
}
export interface SsidLookups {
  rateLimits: RateLimitProfile[];
  timeRanges: TimeRange[];
  radiusProfiles: RadiusProfile[];
  ppskProfiles: PpskProfile[];
  macGroups: MacGroup[];
  lanNetworks: LanNetworkOption[];
  has6g: boolean;
}

const site = (siteId: string, rest: string) => scoped(`/api/v2/sites/${siteId}/${rest}`);
const soft = async <T>(p: Promise<T>, fallback: T) => {
  try {
    return (await p) ?? fallback;
  } catch {
    return fallback;
  }
};

export async function getSsidLookups(siteId: string): Promise<SsidLookups> {
  const [rateLimits, timeRanges, radiusProfiles, ppsk0, ppsk1, macGroups, lan, has6g] = await Promise.all([
    soft(unwrap<RateLimitProfile[]>(api.get(site(siteId, 'setting/profiles/rateLimits'))), []),
    soft(unwrap<{ data?: TimeRange[] }>(api.get(site(siteId, 'setting/profiles/timeranges'))), {}),
    soft(unwrap<RadiusProfile[]>(api.get(site(siteId, 'setting/radiusProfiles'))), []),
    soft(unwrap<PpskProfile[]>(api.get(site(siteId, 'setting/profiles/ppsk'), { params: { type: 0 } })), []),
    soft(unwrap<PpskProfile[]>(api.get(site(siteId, 'setting/profiles/ppsk'), { params: { type: 1 } })), []),
    soft(unwrap<{ data?: MacGroup[] }>(api.get(site(siteId, 'setting/profiles/groups/2'))), {}),
    soft(
      unwrap<{ data?: { id: string; name: string; vlan: number; vlanType?: number; primary?: boolean }[]; supportDefault?: boolean }>(
        api.get(site(siteId, 'setting/lan/networks-split')),
      ),
      {},
    ),
    soft(unwrap<boolean>(api.get(site(siteId, 'eaps/multi-band-6g/exist'))), false),
  ]);
  const ppskProfiles = [...ppsk0, ...ppsk1].filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
  // Vendor: the primary (default) network is offered only when supportDefault;
  // multi-VLAN networks (vlanType 1) are keyed "id_vlan".
  const lanNetworks = (lan.data ?? [])
    .filter((n) => !n.primary || lan.supportDefault)
    .map((n) => ({ label: `${n.name}(${n.vlan})`, value: n.vlanType === 1 ? `${n.id}_${n.vlan}` : n.id }));
  return {
    rateLimits,
    timeRanges: timeRanges.data ?? [],
    radiusProfiles,
    ppskProfiles,
    macGroups: macGroups.data ?? [],
    lanNetworks,
    has6g: Boolean(has6g),
  };
}
