import { api, scoped, unwrap } from '../client';

// RF Planning ("setup space") — verified against the vendor SPA bundle:
//   GET  /{omadacId}/api/v2/sites/{siteId}/rfPlanning
//        → {channelDeployEnable, channelWidthDeployEnable, bandDeployEnable,
//           powerAdjustEnable, …}
//   PUT  /{omadacId}/api/v2/sites/{siteId}/rfPlanning/config  — save toggles
//        (verified live 2026-11-12: errorCode 0; root PUT/PATCH → -1600)
//   PUT  /{omadacId}/api/v2/sites/{siteId}/rfPlanning/excludeAps
//   POST /{omadacId}/api/v2/sites/{siteId}/cmd/rfPlanning      — start run
//        (returns -1600 on this build until a wireless AP is adopted)
//   POST /{omadacId}/api/v2/sites/{siteId}/cmd/rfPlanning/cancel
export interface RfPlanningSetting {
  channelDeployEnable?: boolean;
  channelWidthDeployEnable?: boolean;
  bandDeployEnable?: boolean;
  powerAdjustEnable?: boolean;
  [key: string]: unknown;
}

export async function getRfPlanning(siteId: string): Promise<RfPlanningSetting> {
  return unwrap<RfPlanningSetting>(api.get(scoped(`/api/v2/sites/${siteId}/rfPlanning`)));
}

/** Persist the optimization toggles (full rfPlanning object echoed back). */
export async function putRfPlanningConfig(siteId: string, body: RfPlanningSetting): Promise<RfPlanningSetting> {
  return unwrap<RfPlanningSetting>(
    api.put(scoped(`/api/v2/sites/${siteId}/rfPlanning/config`), body),
  );
}

export async function startRfPlanning(siteId: string, body: unknown = {}): Promise<void> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/rfPlanning`), body));
}

export async function cancelRfPlanning(siteId: string): Promise<void> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/rfPlanning/cancel`), {}));
}
