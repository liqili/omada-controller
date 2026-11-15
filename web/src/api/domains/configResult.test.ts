import { beforeEach, describe, expect, it, vi } from 'vitest';

const gets: [string, Record<string, unknown> | undefined][] = [];
const posts: [string, unknown][] = [];
let answer: unknown = {};

vi.mock('../client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../client')>();
  return {
    ...mod,
    scoped: (p: string) => `/cid${p}`,
    api: {
      get: vi.fn(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
        gets.push([url, cfg?.params]);
        return { status: 200, data: { errorCode: 0, result: answer } };
      }),
      post: vi.fn(async (url: string, body?: unknown) => {
        posts.push([url, body]);
        return { status: 200, data: { errorCode: 0 } };
      }),
    },
  };
});

import {
  CONFIG_STATUS,
  getConfigFeatures,
  listConfigComponents,
  listConfigResultDevices,
  reapplyDeviceConfig,
} from './configResult';

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  answer = {};
});

describe('configuration results API (vendor Devices → Configuration Results)', () => {
  it('asks for the device grid the way the vendor page does (the user’s status=3 request)', async () => {
    answer = {
      totalRows: 1,
      statistic: { fail: 0, alert: 1, preConfig: 0, osgAndOsw: 0, ap: 1 },
      onlyNotificationData: false,
      data: [{ mac: 'M1', name: 'Garden AP', type: 'ap' }],
    };
    const page = await listConfigResultDevices('S1', { status: CONFIG_STATUS.ALERT });
    expect(gets[0]).toEqual([
      '/cid/api/v2/sites/S1/config-result/devices',
      { currentPage: 1, currentPageSize: 10, status: 3 },
    ]);
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(page.statistic.alert).toBe(1);
  });

  it('sends the device-type filter and search only when set', async () => {
    await listConfigResultDevices('S1', { status: CONFIG_STATUS.FAIL, deviceType: 'gatewaySwitch', name: 'rack', page: 2, pageSize: 20 });
    await listConfigResultDevices('S1', { status: CONFIG_STATUS.FAIL, deviceType: 'ap', mac: 'AA-BB' });
    await listConfigResultDevices('S1', { status: CONFIG_STATUS.FAIL, deviceType: 'all' });
    expect(gets[0][1]).toEqual({ currentPage: 2, currentPageSize: 20, status: 2, 'filters.deviceType': '1,2', name: 'rack' });
    expect(gets[1][1]).toEqual({ currentPage: 1, currentPageSize: 10, status: 2, 'filters.deviceType': '3', mac: 'AA-BB' });
    expect(gets[2][1]).not.toHaveProperty('filters.deviceType');
  });

  it('reads a device’s features and a feature’s components', async () => {
    answer = { deviceFunctionList: [{ feature: 'ap_ssid', expandable: true }] };
    expect(await getConfigFeatures('S1', 'M1', { status: CONFIG_STATUS.ALERT, deviceType: 'ap' })).toHaveLength(1);
    expect(gets[0]).toEqual(['/cid/api/v2/sites/S1/config-result/device/M1/feature', { status: 3, deviceType: 'ap' }]);

    answer = { totalRows: 1, data: [{ name: 'Guests' }] };
    const c = await listConfigComponents('S1', 'M1', { feature: 'ap_ssid', status: CONFIG_STATUS.ALERT });
    expect(c).toEqual({ rows: [{ name: 'Guests' }], total: 1 });
    expect(gets[1]).toEqual([
      '/cid/api/v2/sites/S1/config-result/devices/M1/feature/grid',
      { currentPage: 1, currentPageSize: 10, feature: 'ap_ssid', status: 3 },
    ]);
  });

  it('"Apply again" is a body-less POST to config/fullSync', async () => {
    await reapplyDeviceConfig('S1', 'M1');
    expect(posts).toEqual([['/cid/api/v2/sites/S1/devices/M1/config/fullSync', undefined]]);
  });
});
