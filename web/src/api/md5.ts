/**
 * Incremental MD5 (RFC 1321), for the firmware upload: the controller wants the
 * file's MD5 next to it, as the vendor UI sends it (CryptoJS.MD5 over the
 * whole file). WebCrypto has no MD5, and this keeps us off another dependency.
 * Not for security — only a content fingerprint the controller checks.
 */

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export class Md5 {
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private total = 0;
  private w = new Uint32Array(16);

  update(data: Uint8Array): this {
    let i = 0;
    this.total += data.length;
    if (this.bufLen) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen < 64) return this;
      this.block(this.buf, 0);
      this.bufLen = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    if (i < data.length) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = data.length - i;
    }
    return this;
  }

  /** Lower-case hex digest, as CryptoJS's toString() gives it. */
  hex(): string {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.bufLen < 56 ? 56 : 120) - this.bufLen) + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, bits >>> 0, true);
    view.setUint32(pad.length - 4, Math.floor(bits / 2 ** 32), true);
    this.update(pad);
    let out = '';
    for (const word of this.h) for (let b = 0; b < 4; b++) out += ((word >>> (b * 8)) & 0xff).toString(16).padStart(2, '0');
    return out;
  }

  private block(d: Uint8Array, o: number) {
    const w = this.w;
    for (let j = 0; j < 16; j++) w[j] = d[o + j * 4] | (d[o + j * 4 + 1] << 8) | (d[o + j * 4 + 2] << 16) | (d[o + j * 4 + 3] << 24);
    let [a, b, c, e] = this.h;
    for (let j = 0; j < 64; j++) {
      let f: number;
      let g: number;
      if (j < 16) [f, g] = [(b & c) | (~b & e), j];
      else if (j < 32) [f, g] = [(e & b) | (~e & c), (5 * j + 1) % 16];
      else if (j < 48) [f, g] = [b ^ c ^ e, (3 * j + 5) % 16];
      else [f, g] = [c ^ (b | ~e), (7 * j) % 16];
      const t = (a + f + K[j] + w[g]) | 0;
      a = e;
      e = c;
      c = b;
      b = (b + ((t << S[j]) | (t >>> (32 - S[j])))) | 0;
    }
    this.h[0] += a;
    this.h[1] += b;
    this.h[2] += c;
    this.h[3] += e;
  }
}

/** MD5 of a file, read in 4 MB slices so a 256 MB image never sits in memory twice. */
export async function fileMd5(file: Blob, chunk = 4 * 1024 * 1024): Promise<string> {
  const md5 = new Md5();
  for (let at = 0; at < file.size; at += chunk) {
    md5.update(new Uint8Array(await readBlob(file.slice(at, at + chunk))));
  }
  return md5.hex();
}

// Blob.arrayBuffer() where there is one (browsers); FileReader otherwise (jsdom).
function readBlob(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
}
