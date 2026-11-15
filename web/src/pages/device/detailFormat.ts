// Formatting for the device detail page, ported from the legacy controller UI
// (modules/ap_settings/controllers: initDetails, getTrafficData, transferRate,
// the channel-utilization header, and index.transferRealtimeRadio).
import type { Device, RadioBand, WirelessParam } from '../../api/types';

export const BANDS: RadioBand[] = ['2g', '5g', '5g2', '6g'];

/** Band label as the legacy UI shows it (5 GHz-1 when the AP has two 5 GHz radios). */
export function bandLabel(band: RadioBand, device: Pick<Device, 'deviceMisc'>): string {
  if (band === '5g') return device.deviceMisc?.support5g2 ? '5 GHz-1' : '5 GHz';
  return { '2g': '2.4 GHz', '5g2': '5 GHz-2', '6g': '6 GHz' }[band];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Numeric value or numeric string → number (like the legacy N.isNumeric checks); else undefined.
 *  The controller is not consistent: e.g. wiredUplink.rate arrives as the string "2500". */
export type Numeric = number | string;
export function num(v: unknown): number | undefined {
  if (isNum(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Bytes → "0" / "512 B" / "1.50 KB" / "2.00 MB" / "3.10 GB" (1024-based, like getTrafficData). */
export function trafficText(value?: Numeric): string {
  const bytes = num(value);
  if (bytes === undefined) return '--';
  if (bytes < 1) return '0';
  const KB = 1024;
  const MB = 1024 * KB;
  const GB = 1024 * MB;
  if (bytes > GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes > MB) return `${(bytes / MB).toFixed(2)} MB`;
  if (bytes > KB) return `${(bytes / KB).toFixed(2)} KB`;
  return `${bytes} B`;
}

/** Link rate in Mbps → "866Mbps" / "1.20Gbps" (transferRate). */
export function rateText(value?: Numeric): string {
  const mbps = num(value);
  if (mbps === undefined) return '--';
  return mbps > 1000 ? `${(mbps / 1000).toFixed(2)}Gbps` : `${mbps}Mbps`;
}

/** "packets / bytes", "--" for a missing half. */
export function packetsBytes(packets?: Numeric, bytes?: Numeric): string {
  return `${num(packets) ?? '--'} / ${trafficText(bytes)}`;
}

/** Seconds → "249day(s) 22h 17m 46s"; falls back to the controller's own text. */
export function uptimeText(value?: Numeric, text?: string): string {
  const seconds = num(value);
  if (seconds === undefined) return text || '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d ? `${d}day(s) ` : ''}${d || h ? `${h}h ` : ''}${d || h || m ? `${m}m ` : ''}${s}s`;
}

export const DUPLEX_LABEL: Record<number, string> = { 0: 'Auto', 1: 'Half Duplex', 2: 'Full Duplex' };

/** Legacy AP_SETTINGS.LINK_SPEED_n — the code a device row's / port's linkSpeed carries. */
export const LINK_SPEED_LABEL: Record<number, string> = {
  1: '10 Mbps',
  2: '100 Mbps',
  3: '1000 Mbps',
  4: '2.5 Gbps',
  5: '10 Gbps',
  6: '5 Gbps',
  7: '25 Gbps',
  8: '100 Gbps',
};

/**
 * Downlink port speed as the legacy downlink grid writes it:
 * SWITCH_SETTINGS.LINK_SPEED_{speed} + " " + DUPLEX_{duplex}, e.g.
 * "1000 Mbps Full Duplex". `speed` is a code, not Mbps; "--" unless both known.
 */
export function downlinkSpeed(l: { speed?: Numeric; duplex?: Numeric }): string {
  const code = num(l.speed);
  const d = num(l.duplex);
  const speed = code !== undefined ? (code === 0 ? 'Auto' : LINK_SPEED_LABEL[code]) : undefined;
  const duplex = d !== undefined ? DUPLEX_LABEL[d] : undefined;
  return speed && duplex ? `${speed} ${duplex}` : '--';
}

/**
 * Negotiated speed of the wired uplink: wiredUplink.rate in Mbps (what the
 * legacy drawer shows), else the device row's linkSpeed code.
 */
export function negotiatedSpeed(device: Pick<Device, 'wiredUplink' | 'linkSpeed'>): string {
  // rate arrives as a string ("2500") from real controllers.
  const rate = num(device.wiredUplink?.rate);
  if (rate !== undefined && rate > 0) return `${rate} Mbps`;
  const code = num(device.linkSpeed);
  return (code !== undefined && LINK_SPEED_LABEL[code]) || '--';
}

/** Channel number the radio is on now: "36 / 5180MHz" → "36"; "N/A" or junk → undefined. */
export function actualChannelNumber(wp?: WirelessParam): string | undefined {
  const first = wp?.actualChannel?.split('/')[0]?.trim();
  return first && /^[1-9]\d*$/.test(first) ? String(parseInt(first, 10)) : undefined;
}

/**
 * Live channel as the legacy UI writes it: "Auto(36)" when the radio is set to
 * auto (channel "0"), the actual channel otherwise, "-" when not connected.
 */
export function liveChannelText(
  configured: string | undefined,
  wp: WirelessParam | undefined,
  connected: boolean,
): string {
  if (!connected) return configured === '0' ? 'Auto(-)' : '-';
  const actual = actualChannelNumber(wp) ?? '-';
  return configured === '0' ? `Auto(${actual})` : actual;
}

export interface Utilization {
  /** Percent shown in "(x% Utilized)". */
  total: number;
  rx: number;
  tx: number;
  interference: number;
  /** Older firmware reports a single busy figure instead of rx/tx/interference. */
  busy?: number;
  rating: 'Good' | 'Acceptable' | 'High';
}

/** Channel utilization header data, or undefined when the radio reports none. */
export function utilization(wp?: WirelessParam): Utilization | undefined {
  if (!wp) return undefined;
  let u: Omit<Utilization, 'rating'>;
  const rx = num(wp.rxUtil), tx = num(wp.txUtil), inter = num(wp.interUtil), busy = num(wp.busyUtil);
  if (rx !== undefined && tx !== undefined && inter !== undefined) {
    u = { rx, tx, interference: inter, total: rx + tx + inter };
  } else if (busy !== undefined) {
    u = { rx: 0, tx: 0, interference: 0, busy, total: busy };
  } else {
    return undefined;
  }
  const rating = u.total < 20 ? 'Good' : u.total < 40 ? 'Acceptable' : 'High';
  return { ...u, rating };
}
