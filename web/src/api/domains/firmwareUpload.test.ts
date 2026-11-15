import { beforeEach, describe, expect, it, vi } from 'vitest';

// Records each POST: url, plus the multipart fields when the body is a form.
const posts: { url: string; data?: unknown; file?: string; body?: unknown }[] = [];
let holdsFile = false;

vi.mock('../client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../client')>();
  return {
    ...mod,
    scoped: (p: string) => `/cid${p}`,
    api: {
      post: vi.fn(async (url: string, body?: unknown) => {
        if (body instanceof FormData) {
          const file = body.get('file');
          posts.push({ url, data: JSON.parse(String(body.get('data'))), file: file instanceof File ? file.name : undefined });
          const result = file || holdsFile ? { fileId: 'F1' } : {};
          return { status: 200, data: { errorCode: 0, result } };
        }
        posts.push({ url, body });
        return { status: 200, data: { errorCode: 0, result: { upgradeId: 'U1' } } };
      }),
      delete: vi.fn(async () => ({ status: 200, data: { errorCode: 0 } })),
    },
  };
});

import { manualUpgrade } from './ap';

const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const md5 = '7cfdd07889b3295d6a550914ab35e068'; // MD5 of bytes 1..5
const file = () => new File([bytes], 'F76v1_1.0.2.bin');
const UPLOAD = '/cid/api/v2/files/sites/S1/device/upgrade';

beforeEach(() => {
  posts.length = 0;
  holdsFile = false;
});

describe('manual firmware upload (vendor two-step protocol)', () => {
  it('sends md5 alone, then md5 + file, then starts the upgrade', async () => {
    expect(await manualUpgrade('S1', { mac: 'M1', type: 'ap' }, file())).toBe('U1');
    expect(posts).toEqual([
      { url: '/cid/api/v2/sites/S1/cmd/devices/checkFirmware', body: { mac: ['M1'] } },
      { url: UPLOAD, data: { md5 }, file: undefined },
      { url: UPLOAD, data: { md5 }, file: 'F76v1_1.0.2.bin' },
      { url: '/cid/api/v2/sites/S1/cmd/devices/upgrade', body: { fileId: 'F1', macs: ['M1'], type: 'ap', isSingle: true } },
    ]);
  });

  it('skips sending the file when the controller already holds it', async () => {
    holdsFile = true;
    await manualUpgrade('S1', { mac: 'M1', type: 'ap' }, file());
    expect(posts.filter((p) => p.url === UPLOAD)).toEqual([{ url: UPLOAD, data: { md5 }, file: undefined }]);
  });
});
