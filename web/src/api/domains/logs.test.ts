import { beforeEach, describe, expect, it, vi } from 'vitest';

const gets: { url: string; params?: Record<string, unknown> }[] = [];

vi.mock('../client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../client')>();
  return {
    ...mod,
    scoped: (p: string) => `/cid${p}`,
    api: {
      get: vi.fn(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
        gets.push({ url, params: cfg?.params });
        return {
          status: 200,
          data: { errorCode: 0, result: { totalRows: 1, currentPage: 1, currentSize: 50, data: [{ id: 'L1', key: 'APDisconnected' }] } },
        };
      }),
    },
  };
});

import { listLogs, logText } from './logs';

beforeEach(() => {
  gets.length = 0;
});

describe('logs API (vendor logs/alerts, logs/events)', () => {
  it('asks sites/{sid}/logs/alerts for unresolved alerts by default, like the vendor page', async () => {
    const page = await listLogs('S1', 'alerts', { timeStart: 1, timeEnd: 2 });
    expect(page).toEqual({ rows: [{ id: 'L1', key: 'APDisconnected' }], total: 1 });
    expect(gets).toEqual([
      {
        url: '/cid/api/v2/sites/S1/logs/alerts',
        params: { 'filters.timeStart': 1, 'filters.timeEnd': 2, 'filters.resolved': false, currentPage: 1, currentPageSize: 50 },
      },
    ]);
  });

  it('sends events without a resolved filter, plus the optional filters', async () => {
    await listLogs('S1', 'events', { timeStart: 1, timeEnd: 2, level: 'Critical', module: 'Device', search: 'F65', page: 2, pageSize: 20 });
    expect(gets[0].url).toBe('/cid/api/v2/sites/S1/logs/events');
    expect(gets[0].params).toEqual({
      'filters.timeStart': 1,
      'filters.timeEnd': 2,
      'filters.level': 'Critical',
      'filters.module': 'Device',
      searchKey: 'F65',
      currentPage: 2,
      currentPageSize: 20,
    });
  });

  it('can ask for resolved alerts', async () => {
    await listLogs('S1', 'alerts', { timeStart: 1, timeEnd: 2, resolved: true });
    expect(gets[0].params?.['filters.resolved']).toBe(true);
  });
});

describe('logText', () => {
  it('replaces [type:id] placeholders with device and client names', () => {
    expect(
      logText({
        content: '[ap:20-36-26-D5-A7-20] lost [client:AA-BB-CC-DD-EE-FF].',
        deviceNames: { '20-36-26-D5-A7-20': 'Office AP' },
        clientNames: { 'AA-BB-CC-DD-EE-FF': 'Phone' },
      }),
    ).toBe('Office AP lost Phone.');
  });

  it('keeps the id when no name is known, and falls back to the key', () => {
    expect(logText({ content: '[switch:00-11-22-33-44-55] restarted.' })).toBe('00-11-22-33-44-55 restarted.');
    expect(logText({ key: 'SYS_UPGRADE' })).toBe('SYS_UPGRADE');
  });
});
