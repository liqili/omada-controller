import { describe, expect, it } from 'vitest';
import { Md5, fileMd5 } from './md5';

// Deterministic bytes (an LCG), so the expected digests below are fixed.
// They were produced with node:crypto's MD5 over the same bytes; node types
// are not available to the app's tsc build, so they are not computed here.
export const testBytes = (n: number, seed = n) => {
  const a = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    a[i] = x >>> 24;
  }
  return a;
};
const NODE_MD5: Record<number, string> = {
  1: '524a50782178998021a88b8cd4c8dcd8',
  55: 'fbadbad591b8b3ba7dd7a093a67a1acc',
  56: 'a1fdf89913c217863d8b002f0299d1c4',
  57: '4f7afdfd88308ec1066c4f34d2d6a174',
  63: '24c291e22f962065b73ef0261dafe831',
  64: 'd947920b0d8b96ae40c0da35b906957d',
  65: 'b2224f91576832b1ea70bd5b92681d58',
  119: '7ecd7329de7f8953db193da0cf9f75f0',
  120: '03a70a610fb59dfb53f2f42ce2913fca',
  128: '20e1c2115e7e2009fede106f4ef707b9',
  1000: '883c2d3cf33a8f42cda60da240bf291d',
  70001: '6fd54f16e206d725153cede7a30ec3f5',
};

describe('md5', () => {
  it('matches the RFC 1321 test vectors', () => {
    const enc = new TextEncoder();
    expect(new Md5().update(enc.encode('')).hex()).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(new Md5().update(enc.encode('abc')).hex()).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(new Md5().update(enc.encode('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).hex()).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    );
  });

  it('matches node:crypto for every length around block edges and in uneven pieces', () => {
    for (const [len, want] of Object.entries(NODE_MD5)) {
      const data = testBytes(Number(len));
      expect(new Md5().update(data).hex()).toBe(want);
      const m = new Md5();
      for (let i = 0; i < data.length; i += 37) m.update(data.subarray(i, i + 37));
      expect(m.hex()).toBe(want);
    }
  });

  it('hashes a file in slices', async () => {
    expect(await fileMd5(new Blob([testBytes(300_000)]), 65_536 + 7)).toBe('6c00ae92f09d14bc4160a2b3a37e65e2');
  });
});
