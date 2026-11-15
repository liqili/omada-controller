import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, getAllPages } from './client';
import { listActiveClients } from './domains/client';

type Params = Record<string, unknown>;

/** Fake grid endpoint: 230 rows, served the way the controller pages them. */
function serveGrid(total: number) {
  const seen: Params[] = [];
  vi.spyOn(api, 'get').mockImplementation((async (_url: string, cfg?: { params?: Params }) => {
    const p = cfg?.params ?? {};
    seen.push(p);
    // Like the controller: only currentPageSize counts, anything else → 10 rows.
    const size = Number(p.currentPageSize ?? 10);
    const page = Number(p.currentPage);
    const data = Array.from({ length: total }, (_, i) => ({ mac: `m${i}` })).slice((page - 1) * size, page * size);
    return { status: 200, data: { errorCode: 0, result: { totalRows: total, currentPage: page, currentSize: size, data } } };
  }) as never);
  return seen;
}

afterEach(() => vi.restoreAllMocks());

describe('grid paging (legacy currentPage/currentPageSize)', () => {
  it('sends currentPageSize, never pageSize, and follows every page', async () => {
    const seen = serveGrid(230);
    const grid = await getAllPages<{ data: unknown[]; totalRows: number }>('/cid/api/v2/x');
    expect(grid.data).toHaveLength(230);
    expect(seen.map((p) => p.currentPage)).toEqual([1, 2, 3]);
    expect(seen.every((p) => p.currentPageSize === 100 && !('pageSize' in p))).toBe(true);
  });

  it('returns non-grid results unchanged', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ status: 200, data: { errorCode: 0, result: [{ a: 1 }] } } as never);
    expect(await getAllPages('/cid/api/v2/y')).toEqual([{ a: 1 }]);
  });

  it('asks for active clients like the legacy Clients page', async () => {
    const seen = serveGrid(12);
    const clients = await listActiveClients('S1');
    expect(clients).toHaveLength(12);
    expect(seen[0]).toMatchObject({ currentPage: 1, currentPageSize: 100, 'filters.active': true });
  });
});
