import { api, getAllPages, scoped, unwrap } from '../client';
import type { Device, DeviceGridResult, Overview } from '../types';

// Verified live against v5.15.6.7:
//   GET  /{omadacId}/api/v2/grid/devices/pending?currentPage=1&currentPageSize=100
//        → grid of discovered-but-not-yet-adopted devices (+ deviceStat)
//   GET  /{omadacId}/api/v2/grid/devices/adopted?currentPage=1&currentPageSize=100
//        → adopted devices grid
//   GET  /{omadacId}/api/v2/sites/{siteId}/devices
//        → site device list (array)
//   POST /{omadacId}/api/v2/sites/{siteId}/cmd/devices/adopt      — one device (see adoptDevices)
//   POST /{omadacId}/api/v2/sites/{siteId}/cmd/devices/batchAdopt — several
//   GET  /{omadacId}/api/v2/dashboard/overview                 — stat tiles

/** Full pending grid incl. deviceStat (counts per category for the tabs). */
export async function getPendingDeviceGrid(): Promise<DeviceGridResult<Device>> {
  return (
    (await getAllPages<DeviceGridResult<Device>>(scoped('/api/v2/grid/devices/pending'))) ?? {}
  );
}

export async function listPendingDevices(): Promise<Device[]> {
  const grid = await getPendingDeviceGrid();
  return grid?.data ?? [];
}

// NOTE: grid/devices/adopted is controller-scoped (verified) — siteId kept in
// the signature for domain symmetry; switch to sites/{siteId}/devices once the
// site-scoped grid is confirmed.
export async function listDevices(_siteId: string): Promise<Device[]> {
  const grid = await getAllPages<DeviceGridResult<Device>>(scoped('/api/v2/grid/devices/adopted'));
  return grid?.data ?? [];
}

/**
 * Per-type detail paths, as the legacy UI uses them (verified on v5.15.6.7:
 * each answers "-39303 AP does not exist" / "-39700 Switch does not exist" /
 * "-39501 This gateway does not exist." for an unknown MAC). There is NO
 * controller-level `devices/{mac}` — it returns -1600 "Unsupported request path".
 */
const DETAIL_PATH: Partial<Record<string, string>> = { ap: 'eaps', switch: 'switches', gateway: 'gateways' };

const sameMac = (a: string, b: string) => a.replace(/[:-]/g, '').toUpperCase() === b.replace(/[:-]/g, '').toUpperCase();

/**
 * Single device: its row from the adopted (or pending) grid — which carries the
 * type, site and status the list shows — merged with the per-type detail
 * (`sites/{sid}/eaps|switches|gateways/{mac}`, e.g. ApDetailVO) for adopted
 * devices. Pending devices have no site yet, so they get the grid row alone.
 */
export async function getDevice(siteId: string | undefined, mac: string): Promise<Device | undefined> {
  const row =
    (await listDevices(siteId ?? '')).find((d) => sameMac(d.mac, mac)) ??
    (await listPendingDevices()).find((d) => sameMac(d.mac, mac));
  if (!row) return undefined;
  const kind = DETAIL_PATH[row.type];
  const site = row.site ?? siteId;
  if (!kind || !site || row.statusCategory === 2) return row;
  const detail = await unwrap<Partial<Device>>(api.get(scoped(`/api/v2/sites/${site}/${kind}/${row.mac}`))).catch(
    () => undefined,
  );
  if (!detail) return row;
  return { ...row, ...detail, type: row.type, statusCategory: detail.statusCategory ?? row.statusCategory };
}

/** Controller-wide stat tiles (verified: dashboard/overview). */
export async function getOverview(): Promise<Overview> {
  return unwrap<Overview>(api.get(scoped('/api/v2/dashboard/overview')));
}

/** The device's own login, asked for when the controller cannot use the factory one. */
export interface DeviceAccount {
  username: string;
  password: string;
}

export type AdoptTarget = Pick<Device, 'mac' | 'status' | 'adoptFailType' | 'deviceSeriesType'>;

/**
 * Whether adopting needs the device's username/password, as the vendor UI
 * decides it (access_points/device_index: isAdoptFactoryAp, batchAdopt):
 *  - one device: managed by another controller (26/27), or a failed adoption
 *    (24/25) whose adoptFailType is not -1;
 *  - several: any of them in 24–27.
 */
export function adoptNeedsAccount(devices: AdoptTarget[]): boolean {
  if (devices.length === 1) {
    const { status, adoptFailType } = devices[0];
    return status === 26 || status === 27 || ((status === 24 || status === 25) && adoptFailType !== -1);
  }
  return devices.some((d) => d.status >= 24 && d.status <= 27);
}

/**
 * Adopt pending devices into a site, with the vendor UI's requests (found
 * 2026-11-15: a {macList} body was never what the controller takes):
 *   one     POST sites/{sid}/cmd/devices/adopt      {mac, username?, password?}
 *   several POST sites/{sid}/cmd/devices/batchAdopt {macs, deviceSeriesType, username?, password?}
 */
export async function adoptDevices(siteId: string, devices: AdoptTarget[], account?: DeviceAccount): Promise<void> {
  if (!devices.length) return;
  const body =
    devices.length === 1
      ? { mac: devices[0].mac, ...account }
      : { macs: devices.map((d) => d.mac), deviceSeriesType: devices[0].deviceSeriesType, ...account };
  const cmd = devices.length === 1 ? 'adopt' : 'batchAdopt';
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/${cmd}`), body, { timeout: 600_000 }));
}

/** Forget / un-adopt a device. Body {mac}, as the vendor UI sends it. */
export async function forgetDevice(siteId: string, mac: string): Promise<void> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/${mac}/forget`), { mac }));
}

export type DeviceCommand = 'reboot' | 'locate' | 'forceProvision';

/**
 * Device action: POST sites/{sid}/cmd/devices/{mac}/reboot | locate | forceProvision.
 * Bodies as the vendor SPA sends them (an empty body for locate fails on a real
 * controller, found 2026-11-15):
 *   locate         {locateEnable: boolean} — true starts flashing the LED, false stops it
 *   reboot         {mac}
 *   forceProvision no body
 * `enable` only applies to locate (default true).
 */
export async function deviceCmd(siteId: string, mac: string, cmd: DeviceCommand, enable = true): Promise<void> {
  const url = scoped(`/api/v2/sites/${siteId}/cmd/devices/${mac}/${cmd}`);
  const body = cmd === 'locate' ? { locateEnable: enable } : cmd === 'reboot' ? { mac } : undefined;
  await unwrap<unknown>(api.post(url, body));
}
