import { api, scoped, unwrap } from '../client';
import type { Site } from '../types';

interface GridResult<T> {
  data?: T[];
}

const norm = (s: Site): Site => ({ ...s, _id: (s.id ?? s._id ?? '') as string });

// Verified live against v5.15.6.7:
//   GET /{omadacId}/api/v2/sites?currentPage=1&pageSize=100
//     → {errorCode:0, result:{totalRows, currentPage, data:[…]}}  (multi-site)
//   GET /{omadacId}/api/v2/sites/default
//     → {errorCode:0, result:{id, omadacId, primary:true, name:"Default"}}
//     (single-site / basic mode — the grid can stay empty; use the default)
export async function listSites(): Promise<Site[]> {
  try {
    const grid = await unwrap<GridResult<Site>>(
      api.get(scoped('/api/v2/sites'), { params: { currentPage: 1, pageSize: 100 } }),
    );
    const rows = (grid?.data ?? []).map(norm).filter((s) => s._id);
    if (rows.length) return rows;
  } catch {
    /* fall through to the default-site lookup */
  }
  try {
    const def = await unwrap<Site>(api.get(scoped('/api/v2/sites/default')));
    const s = def ? norm(def) : undefined;
    return s?._id ? [s] : [];
  } catch {
    return [];
  }
}

/** Site detail — verified: GET /{omadacId}/api/v2/sites/{siteId} */
export async function getSite(siteId: string): Promise<Site> {
  return norm(await unwrap<Site>(api.get(scoped(`/api/v2/sites/${siteId}`))));
}

/** Create a site (POST /api/v2/sites; body is a SiteVO subset). */
export async function createSite(input: { name: string; desc?: string }): Promise<Site> {
  return norm(await unwrap<Site>(api.post(scoped('/api/v2/sites'), input)));
}
