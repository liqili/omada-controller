import { api, scoped, unwrap } from '../client';

// Per-device settings and firmware. Paths and bodies come from the vendor SPA
// (ap_settings/configuration, access_points/device_index, v5.15.6.7) and the
// controller's DTOs (ApDetailVO, ApGeneralConfigVO, ApRadiosConfigVO,
// IpSettingVO in docs/api-spec.yaml). No AP is adopted on the test controller,
// so these are exercised against the simulator (sim/omada-sim.mjs) only.
//
//   GET  sites/{sid}/eaps/{mac}                      → ApDetailVO (device + its config)
//   GET  sites/{sid}/eaps/{mac}/channelInfo          → {data:[{radioId, channelList:[{channelValue,channelName,freq}]}]}
//   PUT  sites/{sid}/eaps/{mac}/config/general       {name, ledSetting}
//   PUT  sites/{sid}/eaps/{mac}/config/radios        {radioSetting2g|5g|5g2|6g: ApRadioSettingVO}  (one band per call)
//   PUT  sites/{sid}/eaps/{mac}/config/ip-settings   {ipSetting: IpSettingVO}
//   PUT  sites/{sid}/eaps/{mac}/config/wlans         {wlanId, ssidOverrides}
//   PUT  sites/{sid}/eaps/{mac}/config/services      {lldpEnable, loopbackDetectEnable, …}
//
//   GET  sites/{sid}/devices/{mac}/firmware                  → {curFwVer?, lastFwVer, fwReleaseLog}
//   GET  sites/{sid}/devices/{mac}/onlineUpgrade/status      → {status} (0 = idle)
//   POST sites/{sid}/cmd/devices/{mac}/onlineUpgrade         {mac}
//   POST sites/{sid}/cmd/devices/checkFirmware               {mac:[mac]}   (before a manual upload)
//   POST files/sites/{sid}/device/upgrade   multipart "file" → {fileId}
//   DELETE files/sites/{sid}/device/upgrade/{fileId}
//   POST sites/{sid}/cmd/devices/upgrade    {fileId, macs:[mac], type, isSingle:true} → {upgradeId}

/** ledSetting / lldpEnable: 2 = follow the site setting. */
export const FOLLOW_SITE = 2;

export const RADIO_KEYS = ['radioSetting2g', 'radioSetting5g', 'radioSetting5g2', 'radioSetting6g'] as const;
export type RadioKey = (typeof RADIO_KEYS)[number];
export const RADIO_LABEL: Record<RadioKey, string> = {
  radioSetting2g: '2.4 GHz',
  radioSetting5g: '5 GHz',
  radioSetting5g2: '5 GHz (2)',
  radioSetting6g: '6 GHz',
};
/** radioId used by channelInfo. */
export const RADIO_ID: Record<RadioKey, number> = { radioSetting2g: 0, radioSetting5g: 1, radioSetting5g2: 2, radioSetting6g: 3 };

/** channelWidth codes (strings in the DTO). Auto differs per band. */
export const WIDTH_LABEL: Record<string, string> = {
  '2': '20 MHz',
  '3': '40 MHz',
  '4': 'Auto (20/40 MHz)',
  '5': '80 MHz',
  '6': 'Auto (20/40/80 MHz)',
  '7': '160 MHz',
  '8': 'Auto',
  '9': '240 MHz',
  '10': '320 MHz',
};
export function widthOptions(radio: RadioKey): string[] {
  if (radio === 'radioSetting2g') return ['4', '2', '3'];
  if (radio === 'radioSetting6g') return ['8', '2', '3', '5', '7'];
  return ['6', '2', '3', '5'];
}

/** txPowerLevel codes. */
export const POWER_LABEL: Record<number, string> = { 4: 'Auto', 0: 'Low', 1: 'Medium', 2: 'High', 3: 'Custom' };
export const POWER_CUSTOM = 3;

export interface ApRadioSetting {
  radioEnable?: boolean;
  channelWidth?: string;
  /** "0" = auto */
  channel?: string;
  txPower?: number;
  txPowerLevel?: number;
  channelRange?: number[];
  channelLimitEnable?: boolean;
  freq?: number;
  wirelessMode?: number;
}

export interface IpSetting {
  /** "dhcp" | "static" */
  mode?: string;
  configIp?: string;
  configMask?: string;
  configGate?: string;
  preferredDNS?: string;
  alternateDNS?: string;
  fallback?: boolean;
  fallbackIp?: string;
  fallbackMask?: string;
  fallbackGate?: string;
  useFixedAddr?: boolean;
  netId?: string;
  dhcpIp?: string;
}

export interface ApDetail {
  mac: string;
  name?: string;
  type?: string;
  model?: string;
  firmwareVersion?: string;
  status?: number;
  ip?: string;
  /** 0 off · 1 on · 2 site setting */
  ledSetting?: number;
  ipSetting?: IpSetting;
  wlanId?: string;
  lldpEnable?: number;
  loopbackDetectEnable?: boolean;
  radioSetting2g?: ApRadioSetting;
  radioSetting5g?: ApRadioSetting;
  radioSetting5g2?: ApRadioSetting;
  radioSetting6g?: ApRadioSetting;
  deviceMisc?: { support2g?: boolean; support5g?: boolean; support5g2?: boolean; support6g?: boolean; [k: string]: unknown };
  [k: string]: unknown;
}

export interface ChannelOption {
  channelValue: number;
  channelName?: string;
  freq?: number;
}

const eap = (siteId: string, mac: string, rest = '') => scoped(`/api/v2/sites/${siteId}/eaps/${mac}${rest}`);

export const getApDetail = (siteId: string, mac: string) => unwrap<ApDetail>(api.get(eap(siteId, mac)));

export async function getChannelInfo(siteId: string, mac: string): Promise<Record<number, ChannelOption[]>> {
  const r = await unwrap<{ data?: { radioId: number; channelList?: ChannelOption[] }[] }>(
    api.get(eap(siteId, mac, '/channelInfo')),
  );
  const out: Record<number, ChannelOption[]> = {};
  for (const row of r?.data ?? []) out[row.radioId] = row.channelList ?? [];
  return out;
}

/** Bands this AP actually has, from deviceMisc (falls back to the radio blocks present). */
export function supportedRadios(ap: ApDetail): RadioKey[] {
  const misc = ap.deviceMisc ?? {};
  const flag: Record<RadioKey, boolean | undefined> = {
    radioSetting2g: misc.support2g !== false,
    radioSetting5g: misc.support5g,
    radioSetting5g2: misc.support5g2,
    radioSetting6g: misc.support6g,
  };
  return RADIO_KEYS.filter((k) => (flag[k] ?? false) || (misc.support5g === undefined && ap[k] !== undefined));
}

export type ApConfigSection = 'general' | 'radios' | 'ip-settings' | 'wlans' | 'services';

export async function saveApConfig(siteId: string, mac: string, section: ApConfigSection, body: object): Promise<void> {
  await unwrap<unknown>(api.put(eap(siteId, mac, `/config/${section}`), body));
}

// — firmware —

export interface FirmwareInfo {
  curFwVer?: string;
  lastFwVer?: string;
  fwReleaseLog?: string;
}

export const getFirmwareInfo = (siteId: string, mac: string) =>
  unwrap<FirmwareInfo>(api.get(scoped(`/api/v2/sites/${siteId}/devices/${mac}/firmware`)));

export async function getOnlineUpgradeStatus(siteId: string, mac: string): Promise<number | undefined> {
  const r = await unwrap<{ status?: number }>(api.get(scoped(`/api/v2/sites/${siteId}/devices/${mac}/onlineUpgrade/status`)));
  return r?.status;
}

export async function startOnlineUpgrade(siteId: string, mac: string): Promise<void> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/${mac}/onlineUpgrade`), { mac }));
}

/** Upload a .bin for one device and start the upgrade. Returns the upgrade id. */
export async function manualUpgrade(
  siteId: string,
  device: { mac: string; type?: string },
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string | undefined> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/checkFirmware`), { mac: [device.mac] }));
  const form = new FormData();
  form.append('file', file, file.name);
  const uploaded = await unwrap<{ fileId?: string }>(
    api.post(scoped(`/api/v2/files/sites/${siteId}/device/upgrade`), form, {
      timeout: 3_600_000,
      // The client defaults to JSON, and axios would then serialise the
      // FormData as JSON. Naming multipart makes it send the form as-is
      // (the browser fills in the boundary).
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
    }),
  );
  if (!uploaded?.fileId) throw new Error('The controller did not accept the file.');
  try {
    const r = await unwrap<{ upgradeId?: string }>(
      api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/upgrade`), {
        fileId: uploaded.fileId,
        macs: [device.mac],
        type: device.type,
        isSingle: true,
      }),
    );
    return r?.upgradeId;
  } catch (e) {
    await api.delete(scoped(`/api/v2/files/sites/${siteId}/device/upgrade/${uploaded.fileId}`)).catch(() => {});
    throw e;
  }
}
