// SSID form model — a line-by-line port of the vendor SPA's SSID editor
// (`WirelessForm` and its sub-forms in lib/omada-web-5.15.6.7-local.jar,
// static/modules/js/index-Cx7MbWxU.js + virtual_svg-icons-split-*.js).
//
// Why a port and not "echo the row": the controller turns the stored SSID
// straight into the AP's radio config, so every key the legacy editor sends
// (or leaves out) changes what is provisioned. Examples the old dialog got
// wrong: `deviceType` (1 = APs; omitted → stored as 3 = APs + gateways),
// multicast `arpCastEnable`/`ipv6CastEnable` (legacy defaults on), the rate
// limits being linked to the site's default profile, and versionPsk 4 meaning
// "WPA2-PSK/WPA3-SAE" with PMF *capable* on 2.4/5 GHz.
//
// formFromSsid() = the sub-forms' convertData(); serializeSsid() = their
// serializeData() applied, in the same order, to the same starting model
// (`N` in WirelessForm), followed by WirelessForm's submit clean-up. Keep both
// in step with the vendor code — ssidForm.test.ts pins the bodies.

import type { Ssid } from './wlan';

export type Band = '2g' | '5g' | '6g';
const BAND_BIT: Record<Band, number> = { '2g': 1, '5g': 2, '6g': 4 };
export const ALL_BANDS: Band[] = ['2g', '5g', '6g'];
export const bandsToMask = (b: Band[]) => b.reduce((m, x) => m | BAND_BIT[x], 0);
export const maskToBands = (m: number) => ALL_BANDS.filter((b) => m & BAND_BIT[b]);

export const SEC = { NONE: 0, ENTERPRISE: 2, PERSONAL: 3, PPSK: 4, PPSK_RADIUS: 5 } as const;
/** versionPsk / versionEnt */
export const WPA = { WPA: 1, WPA2: 2, WPA_WPA2: 3, WPA3: 4 } as const;
/** encryptionPsk / encryptionEnt */
export const ENC = { AUTO: 1, AES: 3, AES_GCM_256: 4, AES_CNSA: 5 } as const;
export const PMF = { MANDATORY: 1, CAPABLE: 2, DISABLED: 3 } as const;
export const UNIT = { KBPS: 0, MBPS: 1 } as const;
export const REKEY_UNIT = { SECONDS: 0, MINUTES: 1, HOURS: 2 } as const;
export const NAS_MODE = { DEFAULT: 0, DEVICE_NAME: 1, CUSTOM: 2 } as const;
export const PPSK_AUTH = { DEFAULT: 0, EKMS: 1, UNBOUND: 2 } as const;
export const VLAN_MODE = { DEFAULT: 0, CUSTOM: 1 } as const;
export const VLAN_BY = { NETWORK: 0, VLAN_ID: 1 } as const;
/** Multicast filter protocols and their bit (string index, MSB first, 4 wide). */
export const MCAST_FILTERS = [
  { value: 'igmp', label: 'IGMP', bit: 3 },
  { value: 'mdns', label: 'mDNS', bit: 2 },
  { value: 'nd', label: 'ND', bit: 0 },
  { value: 'others', label: 'Others', bit: 1 },
] as const;
export const CUSTOM = 'custom';

export const MAC_FORMATS = [
  'aabbccddeeff',
  'aa-bb-cc-dd-ee-ff',
  'aa:bb:cc:dd:ee:ff',
  'AABBCCDDEEFF',
  'AA-BB-CC-DD-EE-FF',
  'AA:BB:CC:DD:EE:FF',
];

/** 2.4 GHz minimum-rate slider stops (Mbps); 5/6 GHz and "CCK off" start at 6. */
export const RATES_2G = [1, 2, 5.5, 6, 9, 11, 12, 18, 24, 36, 48, 54];
export const RATES_OFDM = [6, 9, 12, 18, 24, 36, 48, 54];

export interface SsidForm {
  // — Basic —
  name: string;
  deviceType: ('eap' | 'gateway')[];
  bands: Band[];
  guestNetEnable: boolean;
  security: number;
  oweEnable: boolean;
  securityKey: string;
  hidePwd?: boolean;
  radiusProfileId: string;
  /** Selected RADIUS profile is the controller's built-in server. */
  builtInRadius: boolean;
  wpaNasMode: number;
  wpaNasId: string;
  ppskId: string;
  ppskType: number;
  ppskNasId: string;
  macFormat: number;
  // — Advanced —
  broadcast: boolean;
  vlanMode: number;
  customMode: number;
  /** `id` or `id_bridgeVlan` like the vendor's network select. */
  lanNetworkId?: string;
  vlanId?: number;
  wpaVersion: number;
  wpaEncryption: number;
  mloEnable: boolean;
  pmfMode: number;
  gikRekeyEnable: boolean;
  rekeyInterval: number;
  rekeyUnit: number;
  enable11r: boolean;
  clientRateLimitId: string;
  clientDownLimitEnable: boolean;
  clientDownLimit: number;
  clientDownLimitType: number;
  clientUpLimitEnable: boolean;
  clientUpLimit: number;
  clientUpLimitType: number;
  ssidRateLimitId: string;
  ssidDownLimitEnable: boolean;
  ssidDownLimit: number;
  ssidDownLimitType: number;
  ssidUpLimitEnable: boolean;
  ssidUpLimit: number;
  ssidUpLimitType: number;
  // — WLAN schedule —
  wlanScheduleEnable: boolean;
  /** 1 = radio on during the schedule, 0 = radio off. */
  scheduleAction: number;
  scheduleId?: string;
  // — 802.11 rate control —
  rate2gCtrlEnable: boolean;
  lowerDensity2g: number;
  cckRatesDisable: boolean;
  clientRatesRequire2g: boolean;
  sendBeacons2g: boolean;
  rate5gCtrlEnable: boolean;
  lowerDensity5g: number;
  clientRatesRequire5g: boolean;
  sendBeacons5g: boolean;
  rate6gCtrlEnable: boolean;
  lowerDensity6g: number;
  clientRatesRequire6g: boolean;
  sendBeacons6g: boolean;
  // — MAC filter —
  macFilterEnable: boolean;
  /** 1 = allow list, 0 = deny list */
  policy: number;
  macFilterId: string;
  ouiProfileIdList: string[];
  // — Multicast / broadcast management —
  multiCastEnable: boolean;
  ipv6CastEnable: boolean;
  channelUtil: number;
  arpCastEnable: boolean;
  filterEnable: boolean;
  filterMode: string[];
  macGroupId?: string;
}

export interface SsidFormContext {
  mode: 'add' | 'edit';
  wlanId: string;
  /** The SSID being edited (grid row). */
  row?: Ssid;
  /** Site has a 6 GHz-capable AP (`eaps/multi-band-6g/exist`). */
  has6g?: boolean;
  /** Bands whose SSID quota is used up. */
  bandFull?: Partial<Record<Band, boolean>>;
  /** MLO SSID quota used up. */
  mloFull?: boolean;
  /** The site's default rate-limit profile id (`isDefault`). */
  defaultRateLimitId?: string;
  /** Site-level "Pro" features (EoGRE, DHCP option 82). Not on this build. */
  sitePro?: boolean;
}

const has = (bands: Band[], b: Band) => bands.includes(b);
const sixOnly = (bands: Band[]) => has(bands, '6g') && !has(bands, '2g') && !has(bands, '5g');

// ───────────────────────── WPA mode / PMF rules ─────────────────────────

export interface WpaOption {
  version: number;
  label: string;
  disabled?: boolean;
  encryptions: { value: number; label: string }[];
}
const AUTO_AES = [
  { value: ENC.AUTO, label: 'Auto' },
  { value: ENC.AES, label: 'AES' },
];
const AES_ONLY = [{ value: ENC.AES, label: 'AES' }];
const PSK_OPTIONS: WpaOption[] = [
  { version: WPA.WPA, label: 'WPA-PSK', encryptions: AUTO_AES },
  { version: WPA.WPA2, label: 'WPA2-PSK', encryptions: AUTO_AES },
  { version: WPA.WPA_WPA2, label: 'WPA/WPA2-PSK', encryptions: AUTO_AES },
  { version: WPA.WPA3, label: 'WPA2-PSK/WPA3-SAE', encryptions: AES_ONLY },
];
const ENT_OPTIONS: WpaOption[] = [
  { version: WPA.WPA, label: 'WPA-Enterprise', encryptions: AUTO_AES },
  { version: WPA.WPA2, label: 'WPA2-Enterprise', encryptions: AUTO_AES },
  { version: WPA.WPA_WPA2, label: 'WPA/WPA2-Enterprise', encryptions: AUTO_AES },
  { version: WPA.WPA3, label: 'WPA3-Enterprise', encryptions: AES_ONLY },
];

/** The vendor's `wpaModeOptions` for a band set / security / MLO state. */
export function wpaOptions(bands: Band[], security: number, mlo: boolean): WpaOption[] {
  if (has(bands, '6g')) {
    const only6 = sixOnly(bands);
    if (security === SEC.PERSONAL) {
      if (only6 || mlo) return [{ version: WPA.WPA3, label: 'WPA3-SAE', encryptions: AES_ONLY }];
      return [{ version: WPA.WPA3, label: 'WPA2-PSK/WPA3-SAE', encryptions: AES_ONLY }];
    }
    if (security === SEC.ENTERPRISE) {
      return only6
        ? [
            {
              version: WPA.WPA3,
              label: 'WPA3-Enterprise',
              encryptions: [
                { value: ENC.AES_GCM_256, label: 'AES-GCM 256' },
                { value: ENC.AES_CNSA, label: 'AES-CNSA' },
              ],
            },
          ]
        : [{ version: WPA.WPA3, label: 'WPA3-Enterprise', encryptions: AES_ONLY }];
    }
    return PSK_OPTIONS;
  }
  if (security === SEC.ENTERPRISE) return ENT_OPTIONS;
  if (security === SEC.PPSK || security === SEC.PPSK_RADIUS) {
    return PSK_OPTIONS.map((o) => (o.version === WPA.WPA3 ? { ...o, disabled: true } : o));
  }
  return PSK_OPTIONS;
}

const wpaAllowed = (opts: WpaOption[], v: number, e: number) =>
  opts.some((o) => o.version === v && !o.disabled && o.encryptions.some((x) => x.value === e));

/** Vendor `pe()`: keep the WPA mode if still offered, else fall back. */
export function normalizeWpa(f: Pick<SsidForm, 'bands' | 'security' | 'mloEnable' | 'wpaVersion' | 'wpaEncryption'>) {
  const opts = wpaOptions(f.bands, f.security, f.mloEnable);
  if (wpaAllowed(opts, f.wpaVersion, f.wpaEncryption)) return { wpaVersion: f.wpaVersion, wpaEncryption: f.wpaEncryption };
  if (has(f.bands, '6g')) {
    if (f.security === SEC.PERSONAL) return { wpaVersion: WPA.WPA3, wpaEncryption: ENC.AES };
    if (f.security === SEC.ENTERPRISE) {
      return { wpaVersion: WPA.WPA3, wpaEncryption: sixOnly(f.bands) ? ENC.AES_GCM_256 : ENC.AES };
    }
    return { wpaVersion: f.wpaVersion, wpaEncryption: f.wpaEncryption };
  }
  return { wpaVersion: WPA.WPA2, wpaEncryption: ENC.AES };
}

/** Which PMF choices are allowed (vendor `pmfEnableStatus`) and the default. */
export function pmfRule(wpaVersion: number, bands: Band[]): { allowed: number[]; preferred: number } {
  if (wpaVersion === WPA.WPA3) {
    const mixed = has(bands, '2g') || has(bands, '5g') || bands.length === 0;
    return mixed
      ? { allowed: [PMF.MANDATORY, PMF.CAPABLE], preferred: PMF.CAPABLE }
      : { allowed: [PMF.MANDATORY], preferred: PMF.MANDATORY };
  }
  if (wpaVersion === WPA.WPA) return { allowed: [PMF.DISABLED], preferred: PMF.DISABLED };
  return { allowed: [PMF.MANDATORY, PMF.CAPABLE, PMF.DISABLED], preferred: PMF.DISABLED };
}

/** 802.11r is offered (vendor `showEnable11r`). */
export function show11r(f: Pick<SsidForm, 'security' | 'wpaVersion' | 'ppskType'>) {
  if (!f.security) return false;
  if (f.security === SEC.PPSK_RADIUS && f.ppskType !== PPSK_AUTH.DEFAULT) return false;
  const v = f.wpaVersion;
  return v === WPA.WPA2 || v === WPA.WPA_WPA2 || (f.security === SEC.PERSONAL && v === WPA.WPA3);
}

/** Why MLO cannot be turned on, or null when it can (vendor `x()`). */
export function mloBlocker(f: Pick<SsidForm, 'security' | 'bands' | 'wpaVersion'>, ctx: SsidFormContext): string | null {
  if (f.security === SEC.NONE) return 'Cannot enable MLO when Security is None.';
  if (f.bands.length < 2) return 'MLO needs at least two bands.';
  if (ctx.mloFull && !ctx.row?.mloEnable) return 'The site has reached its MLO SSID limit.';
  if (f.wpaVersion !== WPA.WPA3) return 'WPA3 mode is required to use MLO.';
  return null;
}

/** Security choices for the band set (vendor `securityOptions`). */
export function securityOptions(bands: Band[]) {
  const opts: { value: number; label: string }[] = [
    { value: SEC.NONE, label: sixOnly(bands) ? 'Enhanced Open' : 'None' },
    { value: SEC.PERSONAL, label: 'WPA-Personal' },
    { value: SEC.ENTERPRISE, label: 'WPA-Enterprise' },
  ];
  if (!has(bands, '6g')) {
    opts.push({ value: SEC.PPSK, label: 'PPSK without RADIUS' }, { value: SEC.PPSK_RADIUS, label: 'PPSK with RADIUS' });
  }
  return opts;
}

/**
 * Apply one user change and the vendor watchers that follow from it: band →
 * security fallback; security/band/MLO → WPA options; WPA/bands → PMF reset;
 * MLO on → 802.11r off.
 */
export function applyChange(prev: SsidForm, patch: Partial<SsidForm>, ctx: SsidFormContext): SsidForm {
  let f: SsidForm = { ...prev, ...patch };
  if (patch.bands && !securityOptions(f.bands).some((o) => o.value === f.security)) f.security = SEC.PERSONAL;
  if (f.security !== prev.security && (f.security === SEC.PPSK || f.security === SEC.PPSK_RADIUS)) {
    f.ppskId = '';
  }
  // Any user change makes the vendor re-check MLO (its "unchanged edit"
  // exemption only covers the form as loaded).
  f = { ...f, ...normalizeWpa(f) };
  if (f.mloEnable && mloBlocker(f, ctx)) {
    f.mloEnable = false;
    f = { ...f, ...normalizeWpa(f) };
  }
  const before = pmfRule(prev.wpaVersion, prev.bands);
  const after = pmfRule(f.wpaVersion, f.bands);
  if (before.allowed.join() !== after.allowed.join() && patch.pmfMode === undefined) f.pmfMode = after.preferred;
  if (!after.allowed.includes(f.pmfMode)) f.pmfMode = after.preferred;
  if (f.mloEnable) f.enable11r = false;
  return f;
}

// ───────────────────────────── convertData ─────────────────────────────

export function formFromSsid(ctx: SsidFormContext): SsidForm {
  const row = ctx.mode === 'edit' ? ctx.row : undefined;
  const full = ctx.bandFull ?? {};
  const f: SsidForm = {
    name: '',
    deviceType: [],
    bands: [],
    guestNetEnable: false,
    security: SEC.PERSONAL,
    oweEnable: false,
    securityKey: '',
    hidePwd: undefined,
    radiusProfileId: '',
    builtInRadius: false,
    wpaNasMode: NAS_MODE.DEFAULT,
    wpaNasId: '',
    ppskId: '',
    ppskType: PPSK_AUTH.DEFAULT,
    ppskNasId: '',
    macFormat: 2,
    broadcast: true,
    vlanMode: VLAN_MODE.DEFAULT,
    customMode: VLAN_BY.NETWORK,
    lanNetworkId: undefined,
    vlanId: undefined,
    wpaVersion: WPA.WPA2,
    wpaEncryption: ENC.AES,
    mloEnable: false,
    pmfMode: PMF.DISABLED,
    gikRekeyEnable: false,
    rekeyInterval: 0,
    rekeyUnit: REKEY_UNIT.SECONDS,
    enable11r: false,
    clientRateLimitId: ctx.defaultRateLimitId ?? CUSTOM,
    clientDownLimitEnable: false,
    clientDownLimit: 0,
    clientDownLimitType: UNIT.KBPS,
    clientUpLimitEnable: false,
    clientUpLimit: 0,
    clientUpLimitType: UNIT.KBPS,
    ssidRateLimitId: ctx.defaultRateLimitId ?? CUSTOM,
    ssidDownLimitEnable: false,
    ssidDownLimit: 0,
    ssidDownLimitType: UNIT.KBPS,
    ssidUpLimitEnable: false,
    ssidUpLimit: 0,
    ssidUpLimitType: UNIT.KBPS,
    wlanScheduleEnable: false,
    scheduleAction: 1,
    scheduleId: undefined,
    rate2gCtrlEnable: false,
    lowerDensity2g: 1,
    cckRatesDisable: false,
    clientRatesRequire2g: false,
    sendBeacons2g: true,
    rate5gCtrlEnable: false,
    lowerDensity5g: 6,
    clientRatesRequire5g: false,
    sendBeacons5g: true,
    rate6gCtrlEnable: false,
    lowerDensity6g: 6,
    clientRatesRequire6g: false,
    sendBeacons6g: true,
    macFilterEnable: false,
    policy: 0,
    macFilterId: '',
    ouiProfileIdList: [],
    multiCastEnable: true,
    ipv6CastEnable: true,
    channelUtil: 100,
    arpCastEnable: true,
    filterEnable: false,
    filterMode: [],
    macGroupId: undefined,
  };

  if (!row) {
    if (!full['2g']) f.bands.push('2g');
    if (!full['5g']) f.bands.push('5g');
    if (!full['6g'] && ctx.has6g) f.bands.push('6g');
    f.deviceType = ['eap'];
    Object.assign(f, normalizeWpa(f));
    f.pmfMode = pmfRule(f.wpaVersion, f.bands).preferred;
    return f;
  }

  // Basic
  f.bands = maskToBands(row.band).sort((a, b) => ALL_BANDS.indexOf(a) - ALL_BANDS.indexOf(b));
  const dt = (row.deviceType as number | undefined) ?? 3;
  if (dt & 1) f.deviceType.push('eap');
  if (dt & 2) f.deviceType.push('gateway');
  f.name = row.name;
  f.security = row.security;
  f.guestNetEnable = row.guestNetEnable;
  f.hidePwd = row.hidePwd as boolean | undefined;
  if (row.pskSetting?.securityKey) f.securityKey = row.pskSetting.securityKey;
  else if (f.hidePwd) f.securityKey = '012345678912';
  const wpa = row.wpaSetting as Record<string, any> | undefined;
  if (wpa?.radiusProfileId) f.radiusProfileId = wpa.radiusProfileId;
  if (wpa?.mode) {
    f.wpaNasMode = wpa.mode;
    f.wpaNasId = wpa.mode === NAS_MODE.CUSTOM ? (wpa.nasId ?? '') : '';
  }
  const ppsk = row.ppskSetting as Record<string, any> | undefined;
  if (ppsk) {
    f.ppskId = ppsk.ppskProfileId ?? '';
    f.radiusProfileId = ppsk.radiusProfileId ?? f.radiusProfileId;
    f.ppskNasId = ppsk.nasId ?? '';
    f.ppskType = ppsk.type ?? PPSK_AUTH.DEFAULT;
    f.macFormat = ppsk.macFormat ?? 2;
  }
  if (row.oweEnable !== null && row.oweEnable !== undefined) f.oweEnable = Boolean(row.oweEnable);

  // Advanced
  f.broadcast = row.broadcast;
  const vlan = row.vlanSetting as { mode: number; customConfig?: Record<string, any> } | undefined;
  f.vlanMode = vlan?.mode ?? VLAN_MODE.DEFAULT;
  if (f.vlanMode === VLAN_MODE.CUSTOM) {
    const c = vlan?.customConfig ?? {};
    f.customMode = c.customMode;
    f.lanNetworkId =
      c.customMode === VLAN_BY.NETWORK ? (c.bridgeVlan ? `${c.lanNetworkId}_${c.bridgeVlan}` : c.lanNetworkId) : undefined;
    f.vlanId = c.customMode === VLAN_BY.VLAN_ID ? c.vlanId : undefined;
  }
  const rl = row.rateLimit ?? {};
  f.clientRateLimitId = rl.rateLimitId || CUSTOM;
  if (f.clientRateLimitId === CUSTOM) {
    f.clientDownLimitEnable = Boolean(rl.downLimitEnable);
    f.clientDownLimit = rl.downLimit ?? 0;
    f.clientDownLimitType = rl.downLimitType ?? UNIT.KBPS;
    f.clientUpLimitEnable = Boolean(rl.upLimitEnable);
    f.clientUpLimit = rl.upLimit ?? 0;
    f.clientUpLimitType = rl.upLimitType ?? UNIT.KBPS;
  }
  const srl = row.ssidRateLimit ?? {};
  f.ssidRateLimitId = srl.rateLimitId || CUSTOM;
  if (f.ssidRateLimitId === CUSTOM) {
    f.ssidDownLimitEnable = Boolean(srl.downLimitEnable);
    f.ssidDownLimit = srl.downLimit ?? 0;
    f.ssidDownLimitType = srl.downLimitType ?? UNIT.KBPS;
    f.ssidUpLimitEnable = Boolean(srl.upLimitEnable);
    f.ssidUpLimit = srl.upLimit ?? 0;
    f.ssidUpLimitType = srl.upLimitType ?? UNIT.KBPS;
  }
  const psk = row.pskSetting;
  if (psk) {
    f.wpaVersion = psk.versionPsk;
    f.wpaEncryption = psk.encryptionPsk;
    f.gikRekeyEnable = psk.gikRekeyPskEnable;
    f.rekeyInterval = psk.rekeyPskInterval || 0;
    f.rekeyUnit = psk.intervalPskType || REKEY_UNIT.SECONDS;
  }
  if (wpa) {
    f.wpaVersion = wpa.versionEnt;
    f.wpaEncryption = wpa.encryptionEnt;
    f.gikRekeyEnable = wpa.gikRekeyEnable;
    f.rekeyInterval = wpa.rekeyInterval || 0;
    f.rekeyUnit = wpa.intervalType || REKEY_UNIT.SECONDS;
  }
  f.mloEnable = Boolean(row.mloEnable);
  f.enable11r = Boolean(row.enable11r);
  const pmf = row.pmfMode as unknown;
  f.pmfMode =
    typeof pmf === 'number' && !Number.isNaN(pmf) ? pmf : pmfRule(f.wpaVersion, f.bands).preferred;

  // Schedule
  f.wlanScheduleEnable = row.wlanScheduleEnable;
  f.scheduleAction = row.action ? row.action : 0;
  f.scheduleId = row.scheduleId as string | undefined;

  // Rate control
  const rc = (row.rateAndBeaconCtrl ?? {}) as Record<string, any>;
  f.rate2gCtrlEnable = Boolean(rc.rate2gCtrlEnable);
  f.lowerDensity2g = rc.lowerDensity2g || 1;
  f.cckRatesDisable = Boolean(rc.cckRatesDisable);
  f.clientRatesRequire2g = Boolean(rc.clientRatesRequire2g);
  f.sendBeacons2g = Boolean(rc.sendBeacons2g);
  f.rate5gCtrlEnable = Boolean(rc.rate5gCtrlEnable);
  f.lowerDensity5g = rc.lowerDensity5g || 6;
  f.clientRatesRequire5g = Boolean(rc.clientRatesRequire5g);
  f.sendBeacons5g = Boolean(rc.sendBeacons5g);
  f.rate6gCtrlEnable = Boolean(rc.rate6gCtrlEnable);
  f.lowerDensity6g = rc.lowerDensity6g || 6;
  f.clientRatesRequire6g = Boolean(rc.clientRatesRequire6g);
  f.sendBeacons6g = Boolean(rc.sendBeacons6g);

  // MAC filter
  f.macFilterEnable = row.macFilterEnable;
  f.policy = row.policy ? row.policy : 0;
  f.macFilterId = (row.macFilterId as string) || '';
  f.ouiProfileIdList = [...((row.ouiProfileIdList as string[]) ?? [])];

  // Multicast
  const mc = row.multiCastSetting as Record<string, any> | undefined;
  if (mc) {
    f.multiCastEnable = mc.multiCastEnable;
    if (typeof mc.channelUtil === 'number') f.channelUtil = mc.channelUtil;
    f.arpCastEnable = mc.arpCastEnable;
    f.filterEnable = mc.filterEnable;
    f.ipv6CastEnable = mc.ipv6CastEnable;
    if (typeof mc.filterMode === 'number') {
      const bits = mc.filterMode.toString(2).padStart(4, '0');
      f.filterMode = MCAST_FILTERS.filter((x) => bits[x.bit] === '1').map((x) => x.value);
    }
    if (mc.macGroupId !== null && mc.macGroupId !== undefined) f.macGroupId = mc.macGroupId;
  }
  return f;
}

// ──────────────────────────── serializeData ────────────────────────────

/** The SSID model WirelessForm starts from (`N`). */
function startingModel(wlanId: string): Record<string, any> {
  return {
    name: '',
    band: 0,
    guestNetEnable: false,
    security: 3,
    broadcast: true,
    vlanSetting: { mode: VLAN_MODE.DEFAULT },
    pskSetting: { securityKey: '', encryptionPsk: ENC.AES, versionPsk: WPA.WPA2, gikRekeyPskEnable: false, rekeyPskInterval: 0, intervalPskType: 0 },
    wpaSetting: { radiusProfileId: '', encryptionEnt: ENC.AES, versionEnt: WPA.WPA2, gikRekeyEnable: false, rekeyInterval: 0, intervalType: 0, mode: NAS_MODE.DEFAULT },
    rateLimit: {},
    ssidRateLimit: {},
    wlanScheduleEnable: false,
    action: 0,
    scheduleId: undefined,
    rateAndBeaconCtrl: {
      rate2gCtrlEnable: false, higherDensity2g: 0, lowerDensity2g: 1, cckRatesDisable: false, clientRatesRequire2g: false, sendBeacons2g: false,
      rate5gCtrlEnable: false, higherDensity5g: 0, lowerDensity5g: 6, clientRatesRequire5g: false, sendBeacons5g: false,
      rate6gCtrlEnable: false, higherDensity6g: 0, lowerDensity6g: 6, clientRatesRequire6g: false, sendBeacons6g: false,
    },
    macFilterEnable: false,
    policy: 0,
    macFilterId: '',
    ouiProfileIdList: [],
    wlanId,
    ppskSetting: { ppskProfileId: '' },
    enable11r: false,
    pmfMode: PMF.DISABLED,
    multiCastSetting: { multiCastEnable: true, channelUtil: 100, arpCastEnable: false, filterEnable: false },
  };
}

/** JSON.stringify semantics: drop undefined, recursively. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const filterMask = (modes: string[]) => {
  const bits = ['', '', '', ''];
  for (const x of MCAST_FILTERS) bits[x.bit] = modes.includes(x.value) ? '1' : '0';
  return parseInt(bits.join(''), 2);
};

/** The exact body the legacy editor POSTs (add) or PATCHes (edit). */
export function serializeSsid(f: SsidForm, ctx: SsidFormContext): Ssid {
  const d = startingModel(ctx.wlanId);

  // FormBasic
  d.oweEnable = undefined;
  d.name = f.name.trim();
  d.band = bandsToMask(f.bands);
  d.guestNetEnable = f.guestNetEnable;
  d.security = f.security;
  delete d.hidePwd;
  if (ctx.mode === 'add') d.deviceType = (f.deviceType.includes('gateway') ? 2 : 0) | (f.deviceType.includes('eap') ? 1 : 0);
  switch (f.security) {
    case SEC.NONE:
      d.pskSetting = undefined;
      d.wpaSetting = undefined;
      d.ppskSetting = undefined;
      if (!sixOnly(f.bands)) d.oweEnable = f.oweEnable;
      break;
    case SEC.PERSONAL:
    case SEC.PPSK:
    case SEC.PPSK_RADIUS:
      d.pskSetting ??= { encryptionPsk: ENC.AES, versionPsk: WPA.WPA2, gikRekeyPskEnable: false };
      d.pskSetting.securityKey = undefined;
      d.wpaSetting = undefined;
      d.ppskSetting = undefined;
      if (f.security === SEC.PPSK) d.ppskSetting = { ppskProfileId: f.ppskId };
      else if (f.security === SEC.PPSK_RADIUS) {
        d.ppskSetting = { radiusProfileId: f.radiusProfileId, nasId: f.ppskNasId.trim(), type: f.ppskType, macFormat: f.macFormat };
        if (f.builtInRadius) d.ppskSetting.ppskProfileId = f.ppskId;
      } else {
        d.hidePwd = f.hidePwd;
        if (!f.hidePwd) d.pskSetting.securityKey = f.securityKey;
      }
      break;
    case SEC.ENTERPRISE:
      d.wpaSetting ??= { radiusProfileId: '', encryptionEnt: ENC.AES, versionEnt: WPA.WPA2, gikRekeyEnable: false, mode: NAS_MODE.DEFAULT };
      d.wpaSetting.radiusProfileId = f.radiusProfileId;
      d.wpaSetting.mode = f.wpaNasMode;
      d.wpaSetting.nasId = f.wpaNasMode === NAS_MODE.CUSTOM ? f.wpaNasId.trim() : undefined;
      d.pskSetting = undefined;
      d.ppskSetting = undefined;
      break;
    default:
      d.pskSetting = undefined;
      d.wpaSetting = undefined;
      d.ppskSetting = undefined;
  }

  // FormAdvanced
  if (ctx.sitePro) d.greEnable = Boolean(ctx.row?.greEnable);
  d.broadcast = f.broadcast;
  d.vlanSetting = { mode: f.vlanMode };
  if (f.vlanMode === VLAN_MODE.CUSTOM) {
    const c: Record<string, any> = {
      customMode: f.customMode,
      lanNetworkId: f.customMode === VLAN_BY.NETWORK ? f.lanNetworkId : undefined,
      vlanId: f.customMode === VLAN_BY.VLAN_ID ? f.vlanId : undefined,
    };
    if (typeof c.lanNetworkId === 'string' && c.lanNetworkId.includes('_')) {
      const [id, bridge] = c.lanNetworkId.split('_');
      c.lanNetworkId = id;
      c.bridgeVlan = parseInt(bridge, 10);
    }
    d.vlanSetting.customConfig = c;
  }
  d.rateLimit = { rateLimitId: f.clientRateLimitId };
  if (f.clientRateLimitId === CUSTOM) {
    d.rateLimit.downLimitEnable = f.clientDownLimitEnable;
    if (f.clientDownLimitEnable) {
      d.rateLimit.downLimit = Number(f.clientDownLimit);
      d.rateLimit.downLimitType = f.clientDownLimitType;
    }
    d.rateLimit.upLimitEnable = f.clientUpLimitEnable;
    if (f.clientUpLimitEnable) {
      d.rateLimit.upLimit = Number(f.clientUpLimit);
      d.rateLimit.upLimitType = f.clientUpLimitType;
    }
  }
  d.ssidRateLimit = { rateLimitId: f.ssidRateLimitId };
  if (f.ssidRateLimitId === CUSTOM) {
    d.ssidRateLimit.downLimitEnable = f.ssidDownLimitEnable;
    if (f.ssidDownLimitEnable) {
      d.ssidRateLimit.downLimit = Number(f.ssidDownLimit);
      d.ssidRateLimit.downLimitType = f.ssidDownLimitType;
    }
    d.ssidRateLimit.upLimitEnable = f.ssidUpLimitEnable;
    if (f.ssidUpLimitEnable) {
      d.ssidRateLimit.upLimit = Number(f.ssidUpLimit);
      d.ssidRateLimit.upLimitType = f.ssidUpLimitType;
    }
  }
  if ((f.security === SEC.PERSONAL || f.security === SEC.PPSK || f.security === SEC.PPSK_RADIUS) && d.pskSetting) {
    d.pskSetting.encryptionPsk = f.wpaEncryption;
    d.pskSetting.versionPsk = f.wpaVersion;
    d.pskSetting.gikRekeyPskEnable = f.gikRekeyEnable;
    d.pskSetting.rekeyPskInterval = f.gikRekeyEnable ? Number(f.rekeyInterval) : undefined;
    d.pskSetting.intervalPskType = f.gikRekeyEnable ? f.rekeyUnit : undefined;
  }
  if (f.security === SEC.ENTERPRISE && d.wpaSetting) {
    d.wpaSetting.encryptionEnt = f.wpaEncryption;
    d.wpaSetting.versionEnt = f.wpaVersion;
    d.wpaSetting.gikRekeyEnable = f.gikRekeyEnable;
    d.wpaSetting.rekeyInterval = f.gikRekeyEnable ? Number(f.rekeyInterval) : undefined;
    d.wpaSetting.intervalType = f.gikRekeyEnable ? f.rekeyUnit : undefined;
  }
  d.mloEnable = f.mloEnable;
  d.enable11r = show11r(f) ? f.enable11r : false;
  if (f.security !== SEC.NONE) d.pmfMode = f.pmfMode;
  else delete d.pmfMode;

  // FormWlanSchedule
  d.wlanScheduleEnable = f.wlanScheduleEnable;
  d.action = f.wlanScheduleEnable ? f.scheduleAction : undefined;
  d.scheduleId = f.wlanScheduleEnable ? f.scheduleId : undefined;

  // FormRateControl
  const rc = d.rateAndBeaconCtrl;
  rc.rate2gCtrlEnable = f.rate2gCtrlEnable;
  rc.rate5gCtrlEnable = f.rate5gCtrlEnable;
  rc.rate6gCtrlEnable = f.rate6gCtrlEnable;
  Object.assign(
    rc,
    f.rate2gCtrlEnable
      ? { higherDensity2g: 54, lowerDensity2g: f.lowerDensity2g, cckRatesDisable: f.cckRatesDisable, clientRatesRequire2g: f.clientRatesRequire2g, sendBeacons2g: f.sendBeacons2g }
      : { higherDensity2g: undefined, lowerDensity2g: undefined, cckRatesDisable: undefined, clientRatesRequire2g: undefined, sendBeacons2g: undefined },
    f.rate5gCtrlEnable
      ? { higherDensity5g: 54, lowerDensity5g: f.lowerDensity5g, clientRatesRequire5g: f.clientRatesRequire5g, sendBeacons5g: f.sendBeacons5g }
      : { higherDensity5g: undefined, lowerDensity5g: undefined, clientRatesRequire5g: undefined, sendBeacons5g: undefined },
    f.rate6gCtrlEnable
      ? { higherDensity6g: 54, lowerDensity6g: f.lowerDensity6g, clientRatesRequire6g: f.clientRatesRequire6g, sendBeacons6g: f.sendBeacons6g }
      : { higherDensity6g: undefined, lowerDensity6g: undefined, clientRatesRequire6g: undefined, sendBeacons6g: undefined },
  );

  // FormMacFilter (OUI profiles are a Pro feature: `i` = isPro)
  d.macFilterEnable = f.macFilterEnable;
  d.policy = f.macFilterEnable ? f.policy : undefined;
  d.ouiProfileIdList = f.macFilterEnable && ctx.sitePro ? f.ouiProfileIdList : undefined;
  d.macFilterId = f.macFilterEnable && f.macFilterId !== '' ? f.macFilterId : undefined;

  // FormMulticastManagement
  const mc: Record<string, any> = {
    multiCastEnable: f.multiCastEnable,
    arpCastEnable: f.arpCastEnable,
    filterEnable: f.filterEnable,
    ipv6CastEnable: f.ipv6CastEnable,
  };
  if (f.multiCastEnable || f.ipv6CastEnable) mc.channelUtil = Number(f.channelUtil);
  if (f.filterEnable) {
    mc.filterMode = filterMask(f.filterMode);
    if (f.macGroupId !== null && f.macGroupId !== undefined) mc.macGroupId = f.macGroupId;
  }
  d.multiCastSetting = mc;

  // FormDhcpOption82 runs on Pro sites only; keep what the SSID has.
  if (ctx.sitePro && ctx.row?.dhcpOption82) d.dhcpOption82 = ctx.row.dhcpOption82;

  // WirelessForm submit
  if (d.rateLimit.rateLimitId === CUSTOM) delete d.rateLimit.rateLimitId;
  if (d.ssidRateLimit.rateLimitId === CUSTOM) delete d.ssidRateLimit.rateLimitId;
  const oui = d.ouiProfileIdList as string[] | undefined;
  if (d.macFilterId && oui?.length) d.macFilterType = 3;
  else if (d.macFilterId) d.macFilterType = 1;
  else if (oui?.length) d.macFilterType = 2;

  return clean(d) as Ssid;
}

// ───────────────────────────── validation ─────────────────────────────

const utf8Len = (s: string) => new TextEncoder().encode(s).length;
const PSK_CHARS = /^[\x20-\x7e]+$/;

/** Field → message, mirroring the vendor form rules. */
export function validateSsidForm(f: SsidForm, ctx: SsidFormContext): Record<string, string> {
  const e: Record<string, string> = {};
  const name = f.name.trim();
  if (!name) e.name = 'Enter a network name.';
  else if (utf8Len(name) > 32) e.name = 'The network name can be at most 32 bytes.';
  if (ctx.mode === 'add' && f.deviceType.length === 0) e.deviceType = 'Pick at least one device type.';
  if (f.bands.length === 0) e.bands = 'Pick at least one band.';
  if (f.security === SEC.PERSONAL && !f.hidePwd) {
    const k = f.securityKey;
    if (!k) e.securityKey = 'Enter a password.';
    else if (k.length < 8 || k.length > 63) e.securityKey = 'The password must be 8–63 characters.';
    // Vendor `pskPassword`: printable ASCII, spaces anywhere included.
    else if (!PSK_CHARS.test(k)) e.securityKey = 'Use printable ASCII characters only.';
  }
  if ((f.security === SEC.ENTERPRISE || f.security === SEC.PPSK_RADIUS) && !f.radiusProfileId) {
    e.radiusProfileId = 'Pick a RADIUS profile.';
  }
  if (f.security === SEC.ENTERPRISE && f.wpaNasMode === NAS_MODE.CUSTOM) {
    if (!f.wpaNasId.trim()) e.wpaNasId = 'Enter a NAS ID.';
    else if (utf8Len(f.wpaNasId.trim()) > 64) e.wpaNasId = 'At most 64 bytes.';
  }
  if (f.security === SEC.PPSK_RADIUS) {
    if (f.ppskType === PPSK_AUTH.EKMS && !f.ppskNasId.trim()) e.ppskNasId = 'Enter a NAS ID.';
    else if (utf8Len(f.ppskNasId.trim()) > 64) e.ppskNasId = 'At most 64 bytes.';
  }
  if ((f.security === SEC.PPSK || (f.security === SEC.PPSK_RADIUS && f.builtInRadius)) && !f.ppskId) {
    e.ppskId = 'Pick a PPSK profile.';
  }
  if (f.vlanMode === VLAN_MODE.CUSTOM) {
    if (f.customMode === VLAN_BY.NETWORK && !f.lanNetworkId) e.lanNetworkId = 'Pick a network.';
    if (f.customMode === VLAN_BY.VLAN_ID && !(Number.isInteger(f.vlanId) && f.vlanId! >= 1 && f.vlanId! <= 4094)) {
      e.vlanId = 'VLAN ID must be 1–4094.';
    }
  }
  if (f.security !== SEC.NONE && f.gikRekeyEnable) {
    const [lo, hi] = f.rekeyUnit === REKEY_UNIT.SECONDS ? [30, 86400] : f.rekeyUnit === REKEY_UNIT.MINUTES ? [1, 1440] : [1, 24];
    const v = Number(f.rekeyInterval);
    if (!Number.isInteger(v) || v < lo || v > hi) e.rekeyInterval = `Enter ${lo}–${hi}.`;
  }
  const limit = (key: string, on: boolean, v: number, unit: number) => {
    if (!on) return;
    const hi = unit === UNIT.MBPS ? 10240 : 10485760;
    if (!Number.isInteger(Number(v)) || v < 1 || v > hi) e[key] = `Enter 1–${hi} ${unit === UNIT.MBPS ? 'Mbps' : 'Kbps'}.`;
  };
  if (f.clientRateLimitId === CUSTOM) {
    limit('clientDownLimit', f.clientDownLimitEnable, f.clientDownLimit, f.clientDownLimitType);
    limit('clientUpLimit', f.clientUpLimitEnable, f.clientUpLimit, f.clientUpLimitType);
  }
  if (f.ssidRateLimitId === CUSTOM) {
    limit('ssidDownLimit', f.ssidDownLimitEnable, f.ssidDownLimit, f.ssidDownLimitType);
    limit('ssidUpLimit', f.ssidUpLimitEnable, f.ssidUpLimit, f.ssidUpLimitType);
  }
  if (f.wlanScheduleEnable && !f.scheduleId) e.scheduleId = 'Pick a schedule.';
  if (f.macFilterEnable && !f.macFilterId && !(ctx.sitePro && f.ouiProfileIdList.length)) e.macFilterId = 'Pick a MAC group.';
  if ((f.multiCastEnable || f.ipv6CastEnable) && !(Number.isInteger(Number(f.channelUtil)) && f.channelUtil >= 1 && f.channelUtil <= 100)) {
    e.channelUtil = 'Enter 1–100.';
  }
  const mlo = f.mloEnable ? mloBlocker(f, ctx) : null;
  if (mlo) e.mloEnable = mlo;
  return e;
}

/**
 * A RADIUS profile that cannot serve this security mode (vendor
 * `radiusProfileItemIsDisabled`): several auth/accounting servers work only
 * with WPA-Enterprise, and a domain-name server only with PPSK + RADIUS.
 */
export function radiusProfileDisabled(
  p: { authServer?: unknown[]; acctServer?: unknown[]; domainEnable?: boolean },
  security: number,
): boolean {
  const multi = (p.authServer?.length ?? 0) > 1 || (p.acctServer?.length ?? 0) > 1;
  return (security !== SEC.ENTERPRISE && multi) || (Boolean(p.domainEnable) && security !== SEC.PPSK_RADIUS);
}

/** OWE counts as two SSIDs per 2.4/5 GHz band (vendor `oweLimited`). */
export function oweLimited(
  f: Pick<SsidForm, 'bands'>,
  counts: { n2g: number; n5g: number },
  max: { max2g: number; max5g: number },
  row?: Ssid,
) {
  const orig = row ? maskToBands(row.band) : [];
  const origOwe = Boolean(row?.oweEnable);
  const used2 = orig.includes('2g') ? (origOwe ? 2 : 1) : 0;
  const used5 = orig.includes('5g') ? (origOwe ? 2 : 1) : 0;
  const need2 = f.bands.includes('2g') ? 2 : 0;
  const need5 = f.bands.includes('5g') ? 2 : 0;
  return counts.n2g + (need2 - used2) > max.max2g || counts.n5g + (need5 - used5) > max.max5g;
}
