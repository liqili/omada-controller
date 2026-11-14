import { api, scoped, unwrap } from '../client';
import type { Device, DeviceGridResult, Overview } from '../types';

// Verified live against v5.15.6.7:
//   GET  /{omadacId}/api/v2/grid/devices/pending?currentPage=1&pageSize=100
//        → grid of discovered-but-not-yet-adopted devices (+ deviceStat)
//   GET  /{omadacId}/api/v2/grid/devices/adopted?currentPage=1&pageSize=100
//        → adopted devices grid
//   GET  /{omadacId}/api/v2/sites/{siteId}/devices
//        → site device list (array)
//   POST /{omadacId}/api/v2/sites/{siteId}/cmd/devices/add  — adopt by mac
//   POST /{omadacId}/api/v2/sites/{siteId}/cmd/devices/adopt — batch adopt
//   GET  /{omadacId}/api/v2/dashboard/overview                 — stat tiles

/** Full pending grid incl. deviceStat (counts per category for the tabs). */
export async function getPendingDeviceGrid(): Promise<DeviceGridResult<Device>> {
  return (
    (await unwrap<DeviceGridResult<Device>>(
      api.get(scoped('/api/v2/grid/devices/pending'), {
        params: { currentPage: 1, pageSize: 100 },
      }),
    )) ?? {}
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
  const grid = await unwrap<DeviceGridResult<Device>>(
    api.get(scoped('/api/v2/grid/devices/adopted'), {
      params: { currentPage: 1, pageSize: 200 },
    }),
  );
  return grid?.data ?? [];
}

/** Single device detail — verified: GET /{omadacId}/api/v2/devices/{mac} */
export async function getDevice(mac: string): Promise<Device | undefined> {
  return unwrap<Device>(api.get(scoped(`/api/v2/devices/${mac}`))).catch(() => undefined);
}

/** Controller-wide stat tiles (verified: dashboard/overview). */
export async function getOverview(): Promise<Overview> {
  return unwrap<Overview>(api.get(scoped('/api/v2/dashboard/overview')));
}

/** Adopt a single discovered device by MAC into a site. */
export async function addDevice(
  siteId: string,
  input: { mac: string; name?: string; model?: string; version?: string },
): Promise<void> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/add`), { ...input }));
}

/** Batch-adopt already-discovered devices. */
export async function adoptDevices(siteId: string, macs: string[]): Promise<void> {
  await unwrap<unknown>(
    api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/adopt`), { macList: macs }),
  );
}

/** Forget / un-adopt a device. */
export async function forgetDevice(siteId: string, mac: string): Promise<void> {
  await unwrap<unknown>(
    api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/${mac}/forget`), {}),
  );
}

export type DeviceCommand = 'reboot' | 'locate' | 'forceProvision';

/**
 * Device action. Paths from the vendor SPA registry (v5.15.6.7):
 *   POST sites/{sid}/cmd/devices/{mac}/reboot | locate | forceProvision
 * Not live-verified against real hardware (no device adopted yet); exercised
 * end-to-end against the local simulator (web/sim).
 */
export async function deviceCmd(siteId: string, mac: string, cmd: DeviceCommand): Promise<void> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/devices/${mac}/${cmd}`), {}));
}
