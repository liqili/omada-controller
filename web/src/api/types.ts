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
  uptime?: number;
  lastSeen?: number;
  clientNum?: number;
  site?: string;
  /** APs: the WLAN group they broadcast. */
  wlanGroup?: string;
  wlanId?: string;
  /** APs: BSSIDs in use (ApVO.bssids is a string array). */
  bssids?: string[];
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
  switchMac?: string;
  port?: number;
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
