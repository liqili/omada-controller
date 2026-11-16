import { api, scoped, unwrap } from '../client';
import { fileMd5 } from '../md5';

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
//   POST files/sites/{sid}/device/upgrade   multipart data={md5} [+ file] → {fileId} (see manualUpgrade)
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
/** The band's Auto width code (vendor getAutoOptValue). */
export const AUTO_WIDTH: Record<RadioKey, string> = { radioSetting2g: '4', radioSetting5g: '6', radioSetting5g2: '6', radioSetting6g: '8' };

// channelInfo widthFlag bits (vendor ap_settings/configuration). 80 MHz and
// wider need the BASE bit as well.
const BIT = { w20: 65536, w40a: 131072, w40b: 262144, base: 256, w80: 8388608, w160: 16777216, w240: 67108864, w320: 33554432 };
const both = (flag: number, bit: number) => (flag & (BIT.base | bit)) === (BIT.base | bit);
const hasWidthFlags = (channels: ChannelOption[]) => channels.some((c) => c.widthFlag !== undefined && c.widthFlag !== null);
/** Whether a channel can run at a width code ("0"/Auto channels always can). */
function channelFits(c: ChannelOption, width: string): boolean {
  const f = Number(c.widthFlag) || 0;
  switch (width) {
    case '2':
      return (f & BIT.w20) !== 0;
    case '3':
      return (f & (BIT.w40a | BIT.w40b)) !== 0;
    case '5':
      return both(f, BIT.w80);
    case '7':
      return both(f, BIT.w160);
    case '9':
      return both(f, BIT.w240);
    case '10':
      return both(f, BIT.w320);
    default:
      return true;
  }
}

/**
 * Widths a wireless mode allows, per band (vendor support map, indexed by
 * wirelessMode 0–19; 6 GHz mode 11 behaves like 14). Only applied when the
 * radio has a fixed mode — Auto (-2) or unset offers every width.
 */
const T = true;
const F = false;
const MODE_WIDTHS: Record<'2g' | '5g' | '6g', Record<string, boolean[]>> = {
  '2g': {
    '2': [T, T, T, T, T, F, F, F, F, F, F, T, T, T, F, F, F, T, F, F],
    '3': [F, F, T, F, T, F, F, F, F, F, F, T, T, T, F, F, F, T, F, F],
  },
  '5g': {
    '2': [F, F, F, F, F, T, T, T, T, T, T, F, F, F, T, T, T, F, T, F],
    '3': [F, F, F, F, F, F, T, T, T, T, T, F, F, F, T, T, T, F, T, F],
    '5': [F, F, F, F, F, F, F, F, T, T, T, F, F, F, T, T, T, F, T, F],
    '7': [F, F, F, F, F, F, F, F, T, T, T, F, F, F, T, T, T, F, T, F],
    '9': [F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, T, F],
  },
  '6g': {
    '2': [F, F, F, F, F, F, F, F, F, F, F, T, F, F, T, F, F, F, F, T],
    '3': [F, F, F, F, F, F, F, F, F, F, F, T, F, F, T, F, F, F, F, T],
    '5': [F, F, F, F, F, F, F, F, F, F, F, T, F, F, T, F, F, F, F, T],
    '7': [F, F, F, F, F, F, F, F, F, F, F, T, F, F, T, F, F, F, F, T],
    '10': [F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, T],
  },
};
const MODE_BAND: Record<RadioKey, '2g' | '5g' | '6g'> = {
  radioSetting2g: '2g',
  radioSetting5g: '5g',
  radioSetting5g2: '5g',
  radioSetting6g: '6g',
};

/**
 * Channel widths offered for a radio, as the vendor's Config tab builds them
 * (generateRadioChannelWidthOpt + filterChannelWidthByMode): from what the
 * AP's channels support (channelInfo widthFlag), so a 5 GHz radio offers
 * 160 MHz (and 240/320) when its channels can do it. Auto comes first.
 */
export function widthOptions(
  radio: RadioKey,
  channels: ChannelOption[] = [],
  opts: { wirelessMode?: number; support11ac?: boolean } = {},
): string[] {
  const auto = AUTO_WIDTH[radio];
  let widths: string[];
  // No list, or one without widthFlags (older firmware/simulator): the
  // vendor's no-channel-info defaults, plus 160 MHz on 6 GHz.
  if (!hasWidthFlags(channels)) {
    widths =
      radio === 'radioSetting2g' ? [auto, '2', '3'] : radio === 'radioSetting6g' ? [auto, '2', '3', '5', '7'] : [auto, '2', '3', '5'];
  } else if (!channels.some((c) => channelFits(c, '3'))) {
    widths = ['2'];
  } else {
    const can = (w: string) => channels.some((c) => channelFits(c, w));
    const wide =
      (opts.support11ac !== false && can('5') && radio === 'radioSetting5g') ||
      radio === 'radioSetting5g2' ||
      radio === 'radioSetting6g';
    if (!wide) widths = [auto, '2', '3'];
    else if (!can('7')) widths = [auto, '2', '3', '5'];
    else if (can('9')) widths = [auto, '2', '3', '5', '7', '9'];
    else if (can('10')) widths = [auto, '2', '3', '5', '7', '10'];
    else widths = [auto, '2', '3', '5', '7'];
  }
  const mode = opts.wirelessMode;
  if (mode === undefined || mode === -2) return widths;
  const map = MODE_WIDTHS[MODE_BAND[radio]];
  const idx = radio === 'radioSetting6g' && mode === 11 ? 14 : mode;
  return widths.filter((w) => w === auto || Boolean(map[w]?.[idx]));
}

/**
 * Channels usable at a width (vendor generateNewModelsRadioChannelOpt): a
 * fixed width keeps the channels whose widthFlag has it; Auto keeps those
 * that fit every width Auto may pick (up to 80 MHz on 5 GHz). 2.4 GHz isn't
 * filtered.
 */
export function channelsForWidth(radio: RadioKey, channels: ChannelOption[], width: string | undefined): ChannelOption[] {
  if (radio === 'radioSetting2g' || !width || !hasWidthFlags(channels)) return channels;
  let need: string[];
  if (width === AUTO_WIDTH[radio]) {
    const autoList = widthOptions(radio, channels).filter((w) => w !== AUTO_WIDTH[radio]);
    need = radio === 'radioSetting6g' ? autoList.filter((w) => w !== '9' && w !== '10') : autoList.filter((w) => Number(w) <= 6);
  } else need = [width];
  return channels.filter((c) => channelOptionValue(c) === '0' || need.every((w) => channelFits(c, w)));
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

/**
 * One entry of channelInfo's channelList. `value` is what radioSetting.channel
 * stores and what the legacy Config tab uses as the option value; it is NOT
 * the channel number (`channelValue`, e.g. 36). `channelName` is the label,
 * e.g. "36 / 5180MHz". value 0 / "0" is Auto.
 */
export interface ChannelOption {
  value?: number | string;
  channelValue: number;
  channelName?: string;
  freq?: number;
  widthFlag?: number;
  dfs?: number;
  limit?: number;
  maxPow?: number;
}

/** The value radioSetting.channel holds for this option (legacy: item.value). */
export const channelOptionValue = (c: ChannelOption) => String(c.value ?? c.channelValue);

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

// — Per-AP SSID overrides (vendor device page "WLANs") —

/** One entry of `ssidOverrides`: the AP's view of one SSID of its WLAN group. */
export interface SsidOverride {
  /** The SSID's `idInt`. */
  index: number;
  globalSsid: string;
  /** 0 = 2.4 GHz, 1 = 5 GHz, 2 = 6 GHz (the bands this AP can broadcast it on). */
  supportBands?: number[];
  security?: number;
  /** Override name / password / VLAN on this AP. */
  enable: boolean;
  ssid: string;
  psk?: string;
  hidePwd?: boolean;
  vlanEnable: boolean;
  vlanId?: number;
  /** Broadcast this SSID on this AP. */
  ssidEnable: boolean;
  [k: string]: unknown;
}

export interface WlanSsidGroup {
  wlanId: string;
  wlanName: string;
  primary?: boolean;
  ssids: {
    idInt: number;
    name: string;
    bandInfo: number;
    securityMode: number;
    psk?: string;
    hidePwd?: boolean;
    vlanId?: number;
    ouiMacFilterEnable?: boolean;
  }[];
}

/** GET sites/{sid}/wlanSsid — every WLAN group with the SSIDs an AP override list is built from. */
export const getWlanSsids = (siteId: string, wirelessRouter: boolean) =>
  unwrap<WlanSsidGroup[]>(
    api.get(scoped(`/api/v2/sites/${siteId}/wlanSsid`), { params: { deviceType: wirelessRouter ? 1 : 0 } }),
  ).then((r) => r ?? []);

/**
 * The override list to show and save for `wlanId`. The AP's own group keeps
 * its saved overrides; another group starts from its SSIDs with nothing
 * overridden, keeping those the AP has a band for (vendor `changeWlanGroup`).
 */
export function overridesForGroup(ap: ApDetail, wlanId: string, groups: WlanSsidGroup[]): SsidOverride[] {
  if (wlanId === ap.wlanId) return ((ap.ssidOverrides as SsidOverride[] | undefined) ?? []).map((o) => ({ ...o }));
  const radios = supportedRadios(ap);
  const can = [
    radios.includes('radioSetting2g'),
    radios.includes('radioSetting5g') || radios.includes('radioSetting5g2'),
    radios.includes('radioSetting6g'),
  ];
  const group = groups.find((g) => g.wlanId === wlanId);
  return (group?.ssids ?? []).flatMap((s) => {
    const supportBands = [0, 1, 2].filter((b) => can[b] && (s.bandInfo & (1 << b)) !== 0);
    if (!supportBands.length) return [];
    return [
      {
        index: s.idInt,
        globalSsid: s.name,
        ssid: s.name,
        supportBands,
        security: s.securityMode,
        psk: s.psk,
        hidePwd: s.hidePwd,
        enable: false,
        vlanEnable: false,
        vlanId: s.vlanId || 1,
        ssidEnable: true,
      },
    ];
  });
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const PSK_TEXT = /^[\x20-\x7e]+$/;

/** Field errors for one override (vendor `ssidOverrideModel` rules plus the e39304 name clash). */
export function overrideProblems(o: SsidOverride, all: SsidOverride[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!o.enable) return e;
  const name = o.ssid.trim();
  if (!name) e.ssid = 'Enter an SSID name.';
  else if (utf8Bytes(name) > 32) e.ssid = 'The SSID name can be at most 32 bytes.';
  else if (all.some((x) => x.globalSsid === name || (x.index !== o.index && x.enable && x.ssid.trim() === name))) {
    e.ssid = 'Another SSID already uses this name.';
  }
  if (o.security === 3 && !o.hidePwd) {
    const k = o.psk ?? '';
    if (k.length < 8 || k.length > 63) e.psk = 'The password must be 8–63 characters.';
    else if (!PSK_TEXT.test(k)) e.psk = 'Use printable ASCII characters only.';
    else if (/^\s/.test(k)) e.psk = 'The password cannot start with a space.';
  }
  if (o.vlanEnable && !(Number.isInteger(o.vlanId) && o.vlanId! >= 1 && o.vlanId! <= 4094)) e.vlanId = 'VLAN ID must be 1–4094.';
  return e;
}

/** The body the vendor saves for one override (name trimmed, hidden password not sent). */
export function serializeOverride(o: SsidOverride): SsidOverride {
  const out: SsidOverride = { ...o, ssid: o.ssid.trim() };
  if (o.hidePwd) delete out.psk;
  return out;
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

/**
 * Upload a .bin for one device and start the upgrade. Returns the upgrade id.
 *
 * The upload is the vendor SPA's two-step one (su Proxy.upload with
 * resultFileIdName, found 2026-11-15 — a bare multipart file fails on a real
 * controller). Both POSTs go to files/sites/{sid}/device/upgrade as multipart:
 *   1. data={"md5":…} only — if the controller already holds that file it
 *      answers with {fileId} and nothing is sent;
 *   2. otherwise data={"md5":…} plus file.
 */
export async function manualUpgrade(
  siteId: string,
  device: { mac: string; type?: string },
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string | undefined> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/checkFirmware`), { mac: [device.mac] }));
  const url = scoped(`/api/v2/files/sites/${siteId}/device/upgrade`);
  const data = JSON.stringify({ md5: await fileMd5(file) });
  const form = (withFile: boolean) => {
    const f = new FormData();
    f.append('data', data);
    if (withFile) f.append('file', file, file.name);
    return f;
  };
  // The client defaults to JSON, and axios would then serialise the FormData
  // as JSON. Naming multipart makes it send the form as-is (the browser fills
  // in the boundary).
  const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };
  let uploaded = await unwrap<{ fileId?: string } | undefined>(api.post(url, form(false), multipart));
  if (!uploaded?.fileId) {
    uploaded = await unwrap<{ fileId?: string }>(
      api.post(url, form(true), {
        ...multipart,
        timeout: 3_600_000,
        onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
      }),
    );
  } else {
    onProgress?.(1);
  }
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
