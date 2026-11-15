// Phase 1 entity types — field names mirror web/docs/api-spec.yaml (extracted
// from the controller's compiled DTOs). Replace with openapi-typescript-codegen
// output once the spec is live-verified (`npm run gen:api`).

// Envelope verified live against controller v5.15.6.7 (2026-11-10).
export interface IoResponse<T = unknown> {
  errorCode: number;
  msg?: string;
  result?: T;
}

/** Grid pagination envelope — verified: {totalRows, currentPage, currentSize, data}. */
export interface DeviceGridResult<T> {
  totalRows?: number;
  currentPage?: number;
  currentSize?: number;
  data?: T[];
  deviceStat?: Record<string, number>;
  stackData?: unknown[];
}

export interface LoginRequest {
  username: string;
  password: string;
  remember?: boolean;
}

// result fields verified live: omadacId + token (the token is also the
// session CSRF token sent back as the "Csrf-Token" header on every call).
export interface LoginResult {
  token: string;
  omadacId?: string;
  roleType?: number;
}

export interface Site {
  /** /sites/default returns `id`; grid rows may use `_id` — accept both. */
  id?: string;
  /** Normalized by listSites() — always present on returned sites. */
  _id: string;
  name: string;
  desc?: string;
  omadacId?: string;
  primary?: boolean;
  /** Both id fields normalized to `_id` by listSites(). */
}

/** Dashboard stat tiles — monitor OverviewVO (subset used by the UI). */
export interface Overview {
  totalGatewayNum?: number;
  connectedGatewayNum?: number;
  disconnectedGatewayNum?: number;
  netCapacity?: number;
  netUtilization?: number;
  totalSwitchNum?: number;
  connectedSwitchNum?: number;
  disconnectedSwitchNum?: number;
  totalPorts?: number;
  availablePorts?: number;
  totalApNum?: number;
  connectedApNum?: number;
  isolatedApNum?: number;
  disconnectedApNum?: number;
  totalClientNum?: number;
  wiredClientNum?: number;
  wirelessClientNum?: number;
  guestNum?: number;
}

/** Site-scoped overview (dashboard SiteInfoVO subset). */
export interface SiteInfo {
  gatewayStatus?: number;
  totalApNum?: number;
  connectedApNum?: number;
  totalSwitchNum?: number;
  connectedSwitchNum?: number;
  totalClientNum?: number;
  wiredClientNum?: number;
  wirelessClientNum?: number;
  alertNum?: number;
}

// Vendor UI compares against "ap" / "switch" / "gateway" / "olt" (device_index bundle).
export type DeviceType = 'gateway' | 'ap' | 'switch' | 'olt' | string;

/** DeviceVO / ApVO subset — field names from web/docs/api-spec.yaml. */
export type RadioBand = '2g' | '5g' | '5g2' | '6g';

/** ApWirelessParamVO — live state of one radio. */
export interface WirelessParam {
  /** "36 / 5180MHz", or "N/A". */
  actualChannel?: string;
  /** e.g. "a/n/ac/ax mixed". */
  rdMode?: string;
  bandWidth?: string;
  txPower?: number;
  txUtil?: number;
  rxUtil?: number;
  interUtil?: number;
  busyUtil?: number;
}

/** ApRadioTrafficVO / ApLanTrafficVO. */
export interface Traffic {
  rxPkts?: number;
  rx?: number;
  rxDropPkts?: number;
  rxErrPkts?: number;
  txPkts?: number;
  tx?: number;
  txDropPkts?: number;
  txErrPkts?: number;
}

export interface RadioSettingBrief {
  radioEnable?: boolean;
  channel?: string;
  txPowerLevel?: number;
  txPower?: number;
}

export interface WiredUplink {
  uplinkMac?: string;
  name?: string;
  type?: string;
  /** 0 auto · 1 half · 2 full. */
  duplex?: number;
  /** Mbps. Real controllers send a string ("2500"); format with detailFormat.num. */
  rate?: number | string;
  upPackets?: number;
  upBytes?: number;
  downPackets?: number;
  downBytes?: number;
  /** Bytes per second. */
  activity?: number;
}

export interface WirelessUplink {
  uplinkMac?: string;
  name?: string;
  rssi?: number;
  txRateInt?: number;
  rxRateInt?: number;
  upPackets?: number;
  upBytes?: number;
  downPackets?: number;
  downBytes?: number;
  activity?: number;
}

/** ApDownLinkStatusVO. */
export interface Downlink {
  port?: string;
  name?: string;
  deviceName?: string;
  ip?: string;
  mac?: string;
  type?: string;
  /** Truthy = link up. */
  link?: boolean | number;
  /** Link speed CODE (LINK_SPEED_n: 2 = 100 Mbps, 3 = 1000 Mbps…), not Mbps. */
  speed?: number;
  /** 0 auto · 1 half · 2 full. */
  duplex?: number;
}

export interface Device {
  mac: string;
  name?: string;
  model?: string;
  showModel?: string;
  type: DeviceType;
  subDevType?: number;
  ip?: string;
  /** Detail code — see components/StatusChip.tsx for the table. */
  status: number;
  /** 0 disconnected · 1 connected · 2 pending · 3 heartbeat missed · 4 isolated */
  statusCategory?: number;
  firmwareVersion?: string;
  hwVersion?: string;
  /** Pending/unknown device firmware — vendor field on the pending grid. */
  version?: string;
  /** Vendor field is a display string (e.g. "3day(s) 4h 5m 6s"); seconds are in uptimeLong. */
  uptime?: string;
  uptimeLong?: number;
  /** Why adoption failed (status 24/25); -1 = no credentials problem (vendor isAdoptFactoryAp). */
  adoptFailType?: number;
  /** 0 Omada · 1 Omada Pro; sent with a batch adoption. */
  deviceSeriesType?: number;
  /** LED is flashing after a locate command (device row field). */
  locateEnable?: boolean;
  lastSeen?: number;
  clientNum?: number;
  site?: string;
  /** APs: the WLAN group they broadcast. */
  wlanGroup?: string;
  wlanId?: string;
  /** APs: BSSIDs in use (ApVO.bssids is a string array). */
  bssids?: string[];
  // ── Per-type detail (sites/{sid}/eaps|switches|gateways/{mac}, e.g. ApDetailVO) ──
  sn?: string;
  customName?: string;
  specialModel?: boolean;
  publicIp?: string;
  ipv6List?: string[];
  cpuUtil?: number;
  memUtil?: number;
  deviceMisc?: { support5g2?: boolean };
  /** Live radio state per band ("wireless param"). */
  wp2g?: WirelessParam;
  wp5g?: WirelessParam;
  wp5g2?: WirelessParam;
  wp6g?: WirelessParam;
  radioTraffic2g?: Traffic;
  radioTraffic5g?: Traffic;
  radioTraffic5g2?: Traffic;
  radioTraffic6g?: Traffic;
  /** Configured radio per band; channel "0" = auto. */
  radioSetting2g?: RadioSettingBrief;
  radioSetting5g?: RadioSettingBrief;
  radioSetting5g2?: RadioSettingBrief;
  radioSetting6g?: RadioSettingBrief;
  lanTraffic?: Traffic;
  /** Device-list row (DeviceVO): uplink link speed code — LINK_SPEED_n (3 = 1000 Mbps). */
  linkSpeed?: number;
  /** Device-list row (DeviceVO): 0 auto · 1 half · 2 full. */
  duplex?: number;
  uplinkDeviceMac?: string;
  uplinkDeviceName?: string;
  uplinkDevicePort?: string;
  wiredUplink?: WiredUplink;
  wirelessUplink?: WirelessUplink;
  downlinkList?: Downlink[];
  /** Only present on devices served by the local simulator (web/sim). */
  simulated?: boolean;
  /** Simulator only: SSIDs the AP is broadcasting, per band. */
  simBroadcast?: { ssid: string; band: string; bssid: string }[];
  /** Simulator only: what the last provisioning/configuration pushed. */
  provision?: { at?: number; reason?: string; request?: string; items?: string[] };
}

/** ActiveClientVO subset. */
export interface Client {
  mac: string;
  name?: string;
  hostname?: string;
  ip?: string;
  ssid?: string;
  wlanId?: number;
  apMac?: string;
  apName?: string;
  switchMac?: string;
  switchName?: string;
  gatewayMac?: string;
  gatewayName?: string;
  stackId?: string;
  stackName?: string;
  stackableSwitch?: boolean;
  /** "ap" | "switch" | "gateway": what a wired client is plugged into. */
  connectDevType?: string;
  port?: number;
  lagId?: number;
  wireless?: boolean;
  networkName?: string;
  type: number; // 0=wired 1=wireless
  status?: number;
  oxid?: number;
  authed?: boolean;
  blocked?: boolean;
  authorized?: boolean;
  txRate?: number;
  rxRate?: number;
  tx?: number;
  rx?: number;
  onlineTime?: number;
}

export interface Alert {
  omadaAlertId?: string;
  siteName?: string;
  title?: string;
  content?: string;
  level?: number; // 1=critical 2=major 3=minor 4=notice
  createTime?: number;
  status?: string;
}
