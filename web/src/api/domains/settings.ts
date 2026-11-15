import { api, getAllPages, scoped, unwrap } from '../client';

// Site-scoped settings. Everything lives under
//   /{omadacId}/api/v2/sites/{siteId}/setting[/<resource>]
// and each resource has its OWN save verb (the vendor SPA registry is the
// source of truth — a wrong verb answers -1600 "Unsupported request path").
//
// Live-verified against controller v5.15.6.7:
//   setting                      GET ✅ PATCH ✅   (full site config)
//   setting/snmp|ssh|upnp        GET ✅ PUT ✅
//   setting/dot1x|macAuth        GET ✅ PATCH ✅   (PUT → -1600)
// Verified 2026-11-13 unless marked otherwise (firewall/timeout write untested):
//   setting/mdns                 GET ✅ PUT ✅    ({enable:true} needs networkIds[])
//   setting/accessControl        GET ✅ PATCH ✅
//   setting/firewall/timeout     GET ✅ PATCH

export type SaveVerb = 'PUT' | 'PATCH';

const sitePath = (siteId: string, resource = '') =>
  scoped(`/api/v2/sites/${siteId}/setting${resource ? `/${resource}` : ''}`);

export async function getSiteSetting<T = Record<string, unknown>>(siteId: string): Promise<T> {
  return unwrap<T>(api.get(sitePath(siteId)));
}

/** PATCH the site config. Send only the sections being changed. */
export async function patchSiteSetting<T = Record<string, unknown>>(siteId: string, body: unknown): Promise<T> {
  return unwrap<T>(api.patch(sitePath(siteId), body));
}

export async function getSetting<T>(
  siteId: string,
  resource: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return unwrap<T>(api.get(sitePath(siteId, resource), { params }));
}

export async function putSetting<T>(siteId: string, resource: string, body: unknown): Promise<T> {
  return unwrap<T>(api.put(sitePath(siteId, resource), body));
}

export async function patchSetting<T>(siteId: string, resource: string, body: unknown): Promise<T> {
  return unwrap<T>(api.patch(sitePath(siteId, resource), body));
}

export function saveSetting<T>(siteId: string, resource: string, verb: SaveVerb, body: unknown): Promise<T> {
  return verb === 'PUT' ? putSetting<T>(siteId, resource, body) : patchSetting<T>(siteId, resource, body);
}

/** Normalized list result — the controller is not consistent about list envelopes. */
export interface SettingList<T> {
  rows: T[];
  total: number;
  /** Everything else the envelope carried (support flags, limits, …). */
  extra: Record<string, unknown>;
}

// List envelopes seen live on v5.15.6.7:
//   {totalRows, currentPage, currentSize, data:[…], …flags}   (most grids)
//   {data:[…]}                                                 (profiles/timeranges)
//   […]                                                        (portals, radiusProfiles)
//   {table:{totalRows,data}, …}                                (transmission/bandwidthControls)
export function normalizeList<T>(result: unknown): SettingList<T> {
  if (Array.isArray(result)) return { rows: result as T[], total: result.length, extra: {} };
  const obj = (result ?? {}) as Record<string, unknown>;
  const table = (obj.table ?? obj) as Record<string, unknown>;
  const rows = Array.isArray(table.data) ? (table.data as T[]) : [];
  const { data: _data, table: _table, ...extra } = obj;
  return { rows, total: typeof table.totalRows === 'number' ? table.totalRows : rows.length, extra };
}

/** Read a list-shaped setting resource (pagination params are mandatory on grids). */
export async function getSettingList<T = Record<string, unknown>>(
  siteId: string,
  resource: string,
  params: Record<string, unknown> = {},
): Promise<SettingList<T>> {
  return normalizeList<T>(await getAllPages(sitePath(siteId, resource), params));
}

/** Scenario names a site can be tagged with. The list starts with a null entry. */
export async function listScenarios(): Promise<(string | null)[]> {
  return (await unwrap<(string | null)[]>(api.get(scoped('/api/v2/scenarios')))) ?? [];
}
