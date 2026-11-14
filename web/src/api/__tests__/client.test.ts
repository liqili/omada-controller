import { describe, expect, it, vi, beforeEach } from 'vitest';
import { unwrap, OmadaApiError, tokenStore } from '../client';

beforeEach(() => {
  tokenStore.clear();
});

describe('unwrap ({errorCode,msg,result} envelope)', () => {
  it('returns result on errorCode 0', async () => {
    const res = await unwrap<string>(Promise.resolve({ status: 200, data: { errorCode: 0, msg: 'Success.', result: 'ok' } }));
    expect(res).toBe('ok');
  });

  it('throws OmadaApiError on non-zero errorCode', async () => {
    await expect(
      unwrap(Promise.resolve({ status: 200, data: { errorCode: -30104, msg: 'Invalid username.' } })),
    ).rejects.toThrow('Invalid username.');
  });

  it('maps axios error to OmadaApiError with status', async () => {
    const axiosErr = Object.assign(new Error('Request failed'), {
      response: { status: 404, data: { msg: 'not found' } },
    });
    const err = (await unwrap(Promise.reject(axiosErr)).catch((e) => e)) as OmadaApiError;
    expect(err).toBeInstanceOf(OmadaApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('not found');
  });

  it('treats a 302 as unauthenticated: clears token and fires logout', async () => {
    tokenStore.set('tok');
    const spy = vi.fn();
    window.addEventListener('omada:logout', spy);
    await expect(unwrap(Promise.resolve({ status: 302, data: {} as never }))).rejects.toThrow('Not authenticated');
    expect(tokenStore.get()).toBeNull();
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('omada:logout', spy);
  });

  it('clears token and fires logout on 401 axios error', async () => {
    tokenStore.set('tok');
    const spy = vi.fn();
    window.addEventListener('omada:logout', spy);
    const axiosErr = Object.assign(new Error('unauthorized'), { response: { status: 401, data: {} } });
    await expect(unwrap(Promise.reject(axiosErr))).rejects.toThrow();
    expect(tokenStore.get()).toBeNull();
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('omada:logout', spy);
  });
});
