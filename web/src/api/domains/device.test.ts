import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake controller: answers by path, like v5.15.6.7 does.
const routes = new Map<string, unknown>();
const calls: string[] = [];
const posts: [string, unknown][] = [];

vi.mock('../client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../client')>();
  return {
    ...mod,
    scoped: (p: string) => `/cid${p}`,
    getAllPages: vi.fn(async (url: string) => {
      calls.push(url);
      const result = routes.get(url);
      if (result === undefined) throw new Error('-1600 Unsupported request path.');
      return result;
    }),
    api: {
      post: vi.fn(async (url: string, body?: unknown) => {
        posts.push([url, body]);
        return { status: 200, data: { errorCode: 0 } };
      }),
      get: vi.fn(async (url: string) => {
        calls.push(url);
        const result = routes.get(url);
        return {
          status: 200,
          data: result === undefined ? { errorCode: -1600, msg: 'Unsupported request path.' } : { errorCode: 0, result },
        };
      }),
    },
  };
});

import { adoptDevices, adoptNeedsAccount, deviceCmd, forgetDevice, getDevice } from './device';

const AP = { mac: '40-AE-30-EC-E3-2E', type: 'ap', name: 'Hall', status: 14, statusCategory: 1, site: 'S1' };

beforeEach(() => {
  routes.clear();
  calls.length = 0;
  posts.length = 0;
  routes.set('/cid/api/v2/grid/devices/adopted', { data: [AP] });
  routes.set('/cid/api/v2/grid/devices/pending', { data: [{ mac: 'AA-BB-CC-DD-EE-01', type: 'switch', status: 0, statusCategory: 2 }] });
});

describe('getDevice', () => {
  it('reads an adopted AP from sites/{site}/eaps/{mac}, never devices/{mac}', async () => {
    routes.set('/cid/api/v2/sites/S1/eaps/40-AE-30-EC-E3-2E', { ...AP, ip: '10.0.0.31', uptime: '1day(s) 2h 3m 4s', uptimeLong: 93784 });
    const d = await getDevice('S1', '40-ae-30-ec-e3-2e');
    expect(d).toMatchObject({ mac: AP.mac, type: 'ap', ip: '10.0.0.31', uptimeLong: 93784, statusCategory: 1 });
    expect(calls).toContain('/cid/api/v2/sites/S1/eaps/40-AE-30-EC-E3-2E');
    expect(calls.some((c) => c.includes('/api/v2/devices/'))).toBe(false);
  });

  it('uses switches/ and gateways/ for wired devices', async () => {
    routes.set('/cid/api/v2/grid/devices/adopted', {
      data: [
        { mac: '11-11-11-11-11-11', type: 'switch', status: 14, statusCategory: 1, site: 'S1' },
        { mac: '22-22-22-22-22-22', type: 'gateway', status: 14, statusCategory: 1, site: 'S1' },
      ],
    });
    routes.set('/cid/api/v2/sites/S1/switches/11-11-11-11-11-11', { mac: '11-11-11-11-11-11', ip: '10.0.0.2' });
    routes.set('/cid/api/v2/sites/S1/gateways/22-22-22-22-22-22', { mac: '22-22-22-22-22-22', ip: '10.0.0.1' });
    expect(await getDevice('S1', '11-11-11-11-11-11')).toMatchObject({ type: 'switch', ip: '10.0.0.2' });
    expect(await getDevice('S1', '22-22-22-22-22-22')).toMatchObject({ type: 'gateway', ip: '10.0.0.1' });
  });

  it('falls back to the grid row when the detail call fails', async () => {
    const d = await getDevice('S1', AP.mac);
    expect(d).toMatchObject({ name: 'Hall', status: 14 });
  });

  it('returns a pending device from the pending grid without a detail call', async () => {
    const d = await getDevice('S1', 'AA-BB-CC-DD-EE-01');
    expect(d).toMatchObject({ statusCategory: 2 });
    expect(calls.some((c) => c.includes('/switches/'))).toBe(false);
  });

  it('returns undefined for an unknown MAC', async () => {
    expect(await getDevice('S1', '00-00-00-00-00-00')).toBeUndefined();
  });
});

describe('device commands send the vendor bodies', () => {
  it('locate sends {locateEnable}, reboot {mac}, forceProvision nothing', async () => {
    await deviceCmd('S1', AP.mac, 'locate');
    await deviceCmd('S1', AP.mac, 'locate', false);
    await deviceCmd('S1', AP.mac, 'reboot');
    await deviceCmd('S1', AP.mac, 'forceProvision');
    const base = `/cid/api/v2/sites/S1/cmd/devices/${AP.mac}`;
    expect(posts).toEqual([
      [`${base}/locate`, { locateEnable: true }],
      [`${base}/locate`, { locateEnable: false }],
      [`${base}/reboot`, { mac: AP.mac }],
      [`${base}/forceProvision`, undefined],
    ]);
  });
});

describe('adoption and forget send the vendor bodies', () => {
  const base = '/cid/api/v2/sites/S1/cmd/devices';

  it('adopts one device with {mac}, several with batchAdopt {macs, deviceSeriesType}', async () => {
    await adoptDevices('S1', [{ mac: 'M1', status: 20 }]);
    await adoptDevices('S1', [
      { mac: 'M1', status: 20, deviceSeriesType: 0 },
      { mac: 'M2', status: 20, deviceSeriesType: 0 },
    ]);
    await adoptDevices('S1', [{ mac: 'M3', status: 26 }], { username: 'admin', password: 'pw' });
    expect(posts).toEqual([
      [`${base}/adopt`, { mac: 'M1' }],
      [`${base}/batchAdopt`, { macs: ['M1', 'M2'], deviceSeriesType: 0 }],
      [`${base}/adopt`, { mac: 'M3', username: 'admin', password: 'pw' }],
    ]);
  });

  it('asks for the device login exactly when the vendor UI does', () => {
    expect(adoptNeedsAccount([{ mac: 'a', status: 20 }])).toBe(false); // factory, pending
    expect(adoptNeedsAccount([{ mac: 'a', status: 26 }])).toBe(true); // managed by others
    expect(adoptNeedsAccount([{ mac: 'a', status: 24, adoptFailType: -1 }])).toBe(false);
    expect(adoptNeedsAccount([{ mac: 'a', status: 24, adoptFailType: 3 }])).toBe(true);
    expect(adoptNeedsAccount([{ mac: 'a', status: 20 }, { mac: 'b', status: 24, adoptFailType: -1 }])).toBe(true); // batch: any 24–27
    expect(adoptNeedsAccount([{ mac: 'a', status: 20 }, { mac: 'b', status: 21 }])).toBe(false);
  });

  it('forgets with {mac}', async () => {
    await forgetDevice('S1', 'M1');
    expect(posts).toEqual([[`${base}/M1/forget`, { mac: 'M1' }]]);
  });
});
