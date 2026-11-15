import { CONFIG_STATUS, type ConfigComponent, type ConfigFeature, type ConfigStatus } from '../api/domains/configResult';

// Text for the configuration-result tables, ported from the vendor renderers
// (virtual_svg-icons-split chunk: qi, SQ, EQ, IQ) with its en_US strings.
// Feature names come from the controller as vendor i18n keys; we don't ship
// the vendor locale, so they are turned into words (WIFI_NETWORKS → "Wifi networks").

const ACRONYMS = new Set([
  'AP', 'ACL', 'DHCP', 'DNS', 'IP', 'IPV6', 'LAN', 'WAN', 'LED', 'MAC', 'NAT', 'QOS', 'RADIUS', 'SSID', 'VLAN',
  'WLAN', 'VPN', 'LLDP', 'SNMP', 'MDNS', 'PPSK', 'EAP', 'OSPF', 'IGMP', 'POE', 'STP', 'RF', 'UPNP', 'DDNS', 'CLI',
]);

/** "MENU.WIFI_NETWORKS" → "Wifi networks"; "VLAN_INTERFACE" → "VLAN interface". */
export function humanizeKey(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.split(/[_\s]+/).filter(Boolean);
  return words
    .map((w, i) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/** Vendor convertFeatureNameText: keys joined by "+" are shown joined by " - ". */
export function featureName(f: Pick<ConfigFeature, 'languageKey' | 'feature'>): string {
  if (!f.languageKey) return f.feature || '—';
  return f.languageKey.split('+').map(humanizeKey).join(' - ');
}

/** Vendor convertFeatureLocationText: "A-B;C" → "A > B, C". */
export function featureLocation(uiPosition?: string): string {
  if (!uiPosition) return '';
  return uiPosition
    .split(';')
    .map((p) => p.split('-').filter(Boolean).map(humanizeKey).join(' > '))
    .join(', ');
}

const OPERATIONS: Record<number, string> = { 1: 'Add', 2: 'Delete', 3: 'Edit', 4: 'Apply' };

const list = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

export function operationText(ops?: number | number[]): string {
  const l = list(ops);
  return l.length ? l.map((o) => OPERATIONS[o] ?? '—').join(', ') : '—';
}

const fmtTime = (t: number) => new Date(t).toLocaleString();

/** One time, or the earliest – latest of two. */
export function timeText(times?: number | number[]): string {
  const l = list(times).filter((t) => typeof t === 'number' && t > 0);
  if (!l.length) return '—';
  if (l.length === 1 || l[0] === l[1]) return fmtTime(l[0]);
  const [a, b] = [Math.min(l[0], l[1]), Math.max(l[0], l[1])];
  return `${fmtTime(a)} – ${fmtTime(b)}`;
}

const DEVICE_TIMEOUT = 'Device response timed out.';
const UNSUPPORTED_ALL = 'The device does not support this feature.';
const FAIL_CODES: Record<string, string> = {
  'osw_-1': 'Device does not support the command.',
  'osw_-2': 'Command encountered an unknown error.',
  'osw_-3': 'Device was offline during application.',
  'osw_-4': 'Application timed out.',
  'osw_-5': 'UI configurations had been deleted.',
  'osw_-6': DEVICE_TIMEOUT,
  'ap_-6': DEVICE_TIMEOUT,
  'osg_-6': DEVICE_TIMEOUT,
  '-6': DEVICE_TIMEOUT,
  '-7': UNSUPPORTED_ALL,
  'osw_-7': UNSUPPORTED_ALL,
  'ap_-7': UNSUPPORTED_ALL,
  'osg_-7': UNSUPPORTED_ALL,
};

/**
 * Vendor qi(): the controller's own messages when it sends them, else the
 * known codes in words; device-specific codes (e.g. "ap_4097") come out as
 * the generic text with the code, since the vendor's 45 KB code table isn't shipped.
 */
export function failReason(
  codes: ConfigFeature['uiErrorCodeList'] | ConfigComponent['uiErrorCode'],
  msgs: string | string[] | undefined,
  status: ConfigStatus,
): string {
  if (status === CONFIG_STATUS.CONFIGURING) return '—';
  const m = list(msgs).filter(Boolean);
  if (m.length) return m.join(', ');
  const c = list(codes).map(String).filter((s) => s !== '');
  if (!c.length) return '—';
  return c.map((code) => FAIL_CODES[code] ?? `Device failed to apply configurations (code ${code}).`).join(', ');
}

/** Why an incompatible (ALERT) feature or component isn't applied: vendor "Capability description". */
type CapabilitySource = Pick<ConfigFeature, 'unsupportCaps' | 'errCode' | 'entryLimit' | 'subEntryLimit' | 'component'> &
  Pick<ConfigComponent, 'notSupportInfo'>;

export function capabilityText(r: CapabilitySource): string {
  if (r.notSupportInfo) return r.notSupportInfo;
  if (r.errCode === -7) return UNSUPPORTED_ALL;
  if (r.errCode === -10)
    return 'The device name only takes effect on the controller and is not delivered to the device (Hostname, LLDP).';
  if (r.errCode === -11) return 'The port or LAG name only takes effect on the controller and is not delivered to the device.';
  const parts: string[] = [];
  if (r.unsupportCaps?.length) parts.push(`The device does not support ${r.unsupportCaps.join(', ')}.`);
  const c = r.component ?? '';
  if (['osg_macGroup', 'osw_macGroup', 'ap_macFilterList'].includes(c)) {
    if (r.entryLimit && r.subEntryLimit)
      parts.push(`MAC Group supports ${r.entryLimit} profiles. Each profile supports ${r.subEntryLimit} items.`);
  } else if (c === 'osg_network' && r.entryLimit) parts.push(`The device supports ${r.entryLimit} interfaces.`);
  else if (/^ap_ssid_(2G|5G|5G2|6G)$/.test(c) && r.subEntryLimit) parts.push(`The device supports up to ${r.subEntryLimit} PPSKs.`);
  else if (r.entryLimit) parts.push(`The device supports ${r.entryLimit} items.`);
  return parts.length ? parts.join(' ') : '—';
}

/** Which columns each status shows — vendor SQ render() for features, IQ for components. */
export function featureColumns(status: ConfigStatus) {
  return {
    operation: status === CONFIG_STATUS.FAIL || status === CONFIG_STATUS.CONFIGURING || status === CONFIG_STATUS.PRECONFIG,
    time: status === CONFIG_STATUS.FAIL || status === CONFIG_STATUS.CONFIGURING || status === CONFIG_STATUS.PRECONFIG,
    capability: status === CONFIG_STATUS.ALERT,
    reason: status === CONFIG_STATUS.FAIL,
  };
}

export function componentColumns(status: ConfigStatus) {
  return {
    operation: status === CONFIG_STATUS.FAIL || status === CONFIG_STATUS.PRECONFIG,
    time: status === CONFIG_STATUS.FAIL || status === CONFIG_STATUS.PRECONFIG,
    capability: status === CONFIG_STATUS.ALERT,
    reason: status === CONFIG_STATUS.FAIL,
  };
}

/** What each status means — vendor CONFIGURATION_RESULT_* explanations, shortened. */
export const STATUS_EXPLANATION: Partial<Record<ConfigStatus, string>> = {
  [CONFIG_STATUS.FAIL]:
    'The configuration was not delivered. For a device response timeout, force provision or restart the device; otherwise check the failed setting, correct and save it, and deliver it again.',
  [CONFIG_STATUS.PRECONFIG]:
    'The configuration may not have been delivered because the device was offline. If the device is connected now, force provision or restart it. This does not affect managing or using the device.',
  [CONFIG_STATUS.ALERT]: "The configuration is not supported by the device's current firmware.",
};

/** List label for a device: stack masters carry the stack name, as in the vendor list. */
export function configDeviceName(d: { name?: string; mac: string; stackId?: string; masterMac?: string; stackName?: string }) {
  const name = d.name || d.mac;
  return d.stackId && d.masterMac === d.mac && d.stackName ? `${name} [${d.stackName}]` : name;
}

/** A search box entry that looks like a MAC (or a run of it) is sent as `mac`, otherwise as `name`. */
export function configSearch(text: string): { name?: string; mac?: string } {
  const t = text.trim();
  if (!t) return {};
  return /^[0-9a-f]{2}([-:][0-9a-f]{2}){1,5}[-:]?$/i.test(t) ? { mac: t.toUpperCase().replace(/:/g, '-') } : { name: t };
}
