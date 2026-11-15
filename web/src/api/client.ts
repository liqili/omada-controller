import axios, { AxiosError, type AxiosInstance } from 'axios';
import type { IoResponse } from './types';

// Auth scheme verified live against controller v5.15.6.7:
//   1. POST /api/v2/login → result {omadacId, token}. The token doubles as
//      the session CSRF token (WebUtils.isVaildToken compares the
//      "Csrf-Token" header against the Shiro session attribute).
//   2. authenticated calls need:
//        - the Shiro cookie TPOMADA_SESSIONID (browser sends it via proxy)
//        - header "Csrf-Token: <token>"
//        - path prefix "/{omadacId}" (LoginFilter omadacTemplate; paths
//          without it return -1600 "Unsupported request path")
//   3. grid endpoints paginate with currentPage/currentPageSize (missing →
//      server throws "Parameter page: [-1] is illegal" → errorCode -1;
//      `pageSize` is NOT read — the page then defaults to 10 rows).

const TOKEN_KEY = 'omada.token';
const OMADAC_KEY = 'omada.omadacId';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  omadacId: () => localStorage.getItem(OMADAC_KEY),
  setOmadacId: (id: string) => localStorage.setItem(OMADAC_KEY, id),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(OMADAC_KEY);
  },
};

export class OmadaApiError extends Error {
  constructor(
    message: string,
    public errorCode?: number,
    public status?: number,
  ) {
    super(message);
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: '/controller-api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  // The controller answers unauthenticated requests with a 302 to its own
  // https login page — following it breaks (cert + CORS). Treat it instead
  // as "not logged in".
  maxRedirects: 0,
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  // Header only, as the vendor UI sends it: the controller checks Csrf-Token
  // against the session; a ?token= copy would just leak the session token
  // into proxy logs and URLs (removed 2026-11-15).
  if (token) config.headers.set('Csrf-Token', token);
  return config;
});

/** /{omadacId}/api/v2/… — every authenticated endpoint is omadac-scoped. */
export function scoped(path: string): string {
  const omadacId = tokenStore.omadacId();
  const clean = path.startsWith('/') ? path : `/${path}`;
  return omadacId ? `/${omadacId}${clean}` : clean;
}

/**
 * Grid pagination params, named as the legacy UI sends them. The controller
 * reads `currentPageSize`; an unknown `pageSize` is ignored and the page
 * silently falls back to 10 rows (response `currentSize: 10`).
 */
export const PAGE_SIZE = 100;
export const pageParams = (currentPage = 1, currentPageSize = PAGE_SIZE) => ({ currentPage, currentPageSize });

/** Most pages getAllPages will follow (100 rows each). */
const MAX_PAGES = 50;

/**
 * GET a grid endpoint and follow `currentPage` until `totalRows` are in, so a
 * list never stops at the first page. A non-grid result (a plain array or
 * object without `data`) is returned unchanged.
 */
export async function getAllPages<R = unknown>(url: string, params: Record<string, unknown> = {}): Promise<R> {
  const first = await unwrap<unknown>(api.get(url, { params: { ...params, ...pageParams(1) } }));
  const grid = first as { data?: unknown[]; totalRows?: number } | undefined;
  if (!grid || Array.isArray(grid) || !Array.isArray(grid.data)) return first as R;
  const data = [...grid.data];
  const total = typeof grid.totalRows === 'number' ? grid.totalRows : data.length;
  for (let page = 2; data.length < total && page <= MAX_PAGES; page++) {
    const next = await unwrap<{ data?: unknown[] }>(api.get(url, { params: { ...params, ...pageParams(page) } }));
    if (!next?.data?.length) break;
    data.push(...next.data);
  }
  return { ...grid, data } as R;
}

// -1200: session dropped by LoginFilter (re-login). -30104: bad creds.
const RELOGIN_CODES = new Set([-1200]);

/** Unwraps the controller's {errorCode, msg, result} envelope. */
export async function unwrap<T>(promise: Promise<{ status: number; data: IoResponse<T> }>): Promise<T> {
  try {
    const res = await promise;
    if (res.status === 302) {
      tokenStore.clear();
      window.dispatchEvent(new Event('omada:logout'));
      throw new OmadaApiError('Not authenticated', undefined, 302);
    }
    const body = res.data;
    if (body && typeof body.errorCode === 'number' && body.errorCode !== 0) {
      if (RELOGIN_CODES.has(body.errorCode)) {
        tokenStore.clear();
        window.dispatchEvent(new Event('omada:logout'));
      }
      throw new OmadaApiError(body.msg ?? `API error ${body.errorCode}`, body.errorCode);
    }
    return (body?.result ?? body) as T;
  } catch (e) {
    const err = e as AxiosError;
    const status = err?.response?.status;
    if (status === 401 || status === 302) {
      tokenStore.clear();
      window.dispatchEvent(new Event('omada:logout'));
    }
    if (e instanceof OmadaApiError) throw e;
    const msg =
      (err?.response?.data as IoResponse | undefined)?.msg ?? err?.message ?? 'Request failed';
    throw new OmadaApiError(msg, (err?.response?.data as IoResponse | undefined)?.errorCode, status);
  }
}
