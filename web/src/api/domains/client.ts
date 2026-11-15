import { api, getAllPages, scoped, unwrap } from '../client';
import type { Client } from '../types';

//   GET  sites/{siteId}/clients?currentPage&currentPageSize&filters.active=true
//        → grid {totalRows, currentPage, currentSize, data: ActiveClientVO[]}
//        (the legacy Clients page's request; with `pageSize` instead of
//        currentPageSize the controller answered -1)
//   GET  sites/{siteId}/clients/{mac}   → -41011 when mac unknown
//   POST sites/{siteId}/cmd/clients/{mac}/{block|unblock|forget|auth|unauth}
//   GET  dashboard/client/overview       → 200 counts (verified)
export async function listActiveClients(siteId: string): Promise<Client[]> {
  const grid = await getAllPages<{ data?: Client[] } | Client[]>(scoped(`/api/v2/sites/${siteId}/clients`), {
    'filters.active': true,
  });
  return Array.isArray(grid) ? grid : grid?.data ?? [];
}

export async function getClient(siteId: string, mac: string): Promise<Client | undefined> {
  return unwrap<Client>(api.get(scoped(`/api/v2/sites/${siteId}/clients/${mac}`))).catch(
    () => undefined,
  );
}

/** Block / unblock / forget / authorize a client. */
export async function clientCmd(
  siteId: string,
  mac: string,
  cmd: 'block' | 'unblock' | 'forget' | 'auth' | 'unauth',
): Promise<void> {
  await unwrap<unknown>(api.post(scoped(`/api/v2/sites/${siteId}/cmd/clients/${mac}/${cmd}`), {}));
}

/** Controller-wide client counts — verified: dashboard/client/overview. */
export async function getClientOverview(): Promise<Record<string, number>> {
  return unwrap<Record<string, number>>(api.get(scoped('/api/v2/dashboard/client/overview')));
}
