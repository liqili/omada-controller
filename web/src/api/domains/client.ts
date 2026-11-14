import { api, pageParams, scoped, unwrap } from '../client';
import type { Client } from '../types';

// Probed against v5.15.6.7 (no clients attached yet — keep tolerant):
//   GET  sites/{siteId}/clients          → -1 today (no client service data)
//   GET  sites/{siteId}/clients/{mac}   → -41011 when mac unknown
//   POST sites/{siteId}/cmd/clients/{mac}/{block|unblock|forget|auth|unauth}
//   GET  dashboard/client/overview       → 200 counts (verified)
export async function listActiveClients(siteId: string): Promise<Client[]> {
  const data = await unwrap<Client[]>(
    api.get(scoped(`/api/v2/sites/${siteId}/clients`), { params: pageParams(1, 200) }),
  ).catch(() => [] as Client[]);
  return Array.isArray(data) ? data : [];
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
