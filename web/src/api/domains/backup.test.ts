// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { method: string; url: string; params?: unknown; responseType?: string }[] = [];
let fileResponse: { status: number; data: Blob; headers: Record<string, string> };

vi.mock('../client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../client')>();
  return {
    ...mod,
    scoped: (p: string) => `/cid${p}`,
    api: {
      post: vi.fn(async (url: string) => {
        calls.push({ method: 'POST', url });
        return { status: 200, data: { errorCode: 0 } };
      }),
      get: vi.fn(async (url: string, cfg?: { params?: unknown; responseType?: string }) => {
        calls.push({ method: 'GET', url, params: cfg?.params, responseType: cfg?.responseType });
        if (url.endsWith('/files/backup')) return fileResponse;
        return { status: 200, data: { errorCode: 0, result: { status: 1, percent: 40 } } };
      }),
    },
  };
});

import { backupParams, downloadBackup, filenameFrom, getBackupStatus } from './backup';

const base = { retainUser: false, retainAuthRecord: false, retainFirmwareLog: false, retention: 30 };

beforeEach(() => {
  calls.length = 0;
  fileResponse = {
    status: 200,
    data: new Blob(['CFGDATA'], { type: 'application/octet-stream' }),
    headers: { 'content-disposition': 'attachment; filename="Omada_Backup_2026-11-16.cfg"' },
  };
});

describe('controller backup (vendor Maintenance → Backup, local file)', () => {
  it('is settings-only unless data is retained, like the vendor page', () => {
    expect(backupParams(base)).toEqual({ retention: -1, retainUser: false, retainAuthRecord: false, retainFirmwareLog: false });
    // User info lives in the settings file: still settings-only.
    expect(backupParams({ ...base, retainUser: true }).retention).toBe(-1);
    expect(backupParams({ ...base, retainFirmwareLog: true }).retention).toBe(30);
    expect(backupParams({ ...base, retainAuthRecord: true, retention: 0 }).retention).toBe(0);
  });

  it('prepares, then downloads the file with the options as query parameters', async () => {
    const { blob, filename } = await downloadBackup({ ...base, retainUser: true });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /cid/api/v2/maintenance/backup/prepare',
      'GET /cid/api/v2/files/backup',
    ]);
    expect(calls[1].params).toEqual({ retention: -1, retainUser: true, retainAuthRecord: false, retainFirmwareLog: false });
    expect(calls[1].responseType).toBe('blob');
    expect(filename).toBe('Omada_Backup_2026-11-16.cfg');
    expect(await blob.text()).toBe('CFGDATA');
  });

  it('turns a JSON refusal instead of a file into the controller’s error', async () => {
    fileResponse = {
      status: 200,
      data: new Blob([JSON.stringify({ errorCode: -30300, msg: 'Importing... Please wait.' })], { type: 'application/json' }),
      headers: {},
    };
    await expect(downloadBackup(base)).rejects.toMatchObject({ errorCode: -30300, message: 'Importing... Please wait.' });
  });

  it('names the file from Content-Disposition, or by date', () => {
    expect(filenameFrom("attachment; filename*=UTF-8''Site%20A.cfg", 'x.cfg')).toBe('Site A.cfg');
    expect(filenameFrom('attachment; filename=plain.cfg', 'x.cfg')).toBe('plain.cfg');
    expect(filenameFrom(undefined, 'x.cfg')).toBe('x.cfg');
  });

  it('reads progress from backup/result', async () => {
    expect(await getBackupStatus()).toEqual({ status: 1, percent: 40 });
    expect(calls[0].url).toBe('/cid/api/v2/maintenance/backup/result');
  });
});
