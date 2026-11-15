import type { Client } from '../api/types';

const isPort = (v: unknown): v is number | string =>
  (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

export interface ClientUplink {
  /** "AP/Port" cell text, "--" when unknown. */
  text: string;
  /** MAC of the device it links to (AP, switch or gateway), if adopted here. */
  deviceMac?: string;
}

/**
 * The legacy clients grid "AP/Port" column (modules/clients, dataIndex apOrPort):
 * - wireless → AP name
 * - wired on an AP → "AP Port N"
 * - wired on a switch → "Switch Port N" ("LAG N" for a LAG; "[stack]" on a stack)
 * - wired on a gateway → gateway name
 */
export function clientUplink(c: Client): ClientUplink {
  const wireless = c.wireless ?? c.type === 1;
  let kind = c.connectDevType;
  if (kind === 'switch' && c.stackableSwitch) kind = 'stack';
  const portText = () => (isPort(c.lagId) ? `LAG ${c.lagId}` : isPort(c.port) ? `Port ${c.port}` : '');
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

  if (wireless) return c.apName ? { text: c.apName, deviceMac: c.apMac } : { text: '--' };
  let text = '';
  let deviceMac: string | undefined;
  if (kind === 'ap') {
    text = join(c.apName, isPort(c.port) ? `Port ${c.port}` : '');
    deviceMac = c.apMac;
  } else if (kind === 'switch') {
    text = join(c.switchName ?? c.switchMac, portText());
    deviceMac = c.switchMac;
  } else if (kind === 'stack') {
    text = join(`${c.switchName ?? c.switchMac ?? ''}${c.stackName ? `[${c.stackName}]` : ''}`, portText());
  } else if (kind === 'gateway') {
    text = c.gatewayName ?? '';
    deviceMac = c.gatewayMac;
  }
  return text ? { text, deviceMac } : { text: '--' };
}
