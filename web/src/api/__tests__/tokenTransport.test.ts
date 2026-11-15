// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import { api, tokenStore } from '../client';
import { logout } from '../domains/auth';

// Capture requests at the adapter: what would actually go on the wire.
const sent: InternalAxiosRequestConfig[] = [];
const original = api.defaults.adapter;

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  api.defaults.adapter = async (config) => {
    sent.push(config);
    return { data: { errorCode: 0 }, status: 200, statusText: 'OK', headers: {}, config };
  };
});
afterEach(() => {
  api.defaults.adapter = original;
});

const urlOf = (c: InternalAxiosRequestConfig) => api.getUri(c);

describe('session token transport (vendor UI: Csrf-Token header only)', () => {
  it('sends the token in the Csrf-Token header and never in the URL', async () => {
    tokenStore.set('secret-token');
    tokenStore.setOmadacId('omadac0001');
    await api.get('/omadac0001/api/v2/sites/S1/logs/alerts', { params: { currentPage: 1 } });
    await api.post('/omadac0001/api/v2/sites/S1/cmd/devices/adopt', { mac: 'M1' });
    for (const c of sent) {
      expect(c.headers.get('Csrf-Token')).toBe('secret-token');
      expect(urlOf(c)).not.toContain('token');
    }
    expect(urlOf(sent[0])).toContain('currentPage=1');
  });

  it('signs out on the omadac-scoped path, header only', async () => {
    tokenStore.set('secret-token');
    tokenStore.setOmadacId('omadac0001');
    await logout();
    expect(sent).toHaveLength(1);
    expect(urlOf(sent[0])).toBe('/controller-api/omadac0001/api/v2/logout');
    expect(sent[0].headers.get('Csrf-Token')).toBe('secret-token');
    expect(tokenStore.get()).toBeNull();
  });
});
