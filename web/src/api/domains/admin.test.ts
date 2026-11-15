// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { method: string; url: string; body?: unknown }[] = [];

vi.mock('../client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../client')>();
  const ok = (result: unknown = {}) => ({ status: 200, data: { errorCode: 0, result } });
  return {
    ...mod,
    scoped: (p: string) => `/cid${p}`,
    api: {
      get: vi.fn(async (url: string) => {
        calls.push({ method: 'GET', url });
        if (url.endsWith('/sites')) return ok({ sites: ['S1', { key: 'S2' }, { id: 'S3' }] });
        return ok({ roles: [{ id: 'admin_id', name: 'Administrator' }] });
      }),
      post: vi.fn(async (url: string, body?: unknown) => {
        calls.push({ method: 'POST', url, body });
        return ok({ token: 'T0K' });
      }),
      patch: vi.fn(async (url: string, body?: unknown) => {
        calls.push({ method: 'PATCH', url, body });
        return ok();
      }),
      delete: vi.fn(async (url: string, cfg?: { data?: unknown }) => {
        calls.push({ method: 'DELETE', url, body: cfg?.data });
        return ok();
      }),
    },
  };
});

import {
  addAccount,
  confirmOwnPassword,
  deleteAccount,
  editAccount,
  getAccountSites,
  listAvailableRoles,
  passwordProblem,
  type ControllerUser,
} from './admin';

const input = { name: 'bob', password: 'Str0ng!pw', roleId: 'viewer_id', alert: false, allSites: false, sites: ['S2'] };

beforeEach(() => {
  calls.length = 0;
});

describe('account management (vendor Admin page requests)', () => {
  it('adds a local account with its site privilege', async () => {
    await addAccount({ ...input, email: 'b@x.io' }, ['S1', 'S2']);
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/cid/api/v2/account/users',
        body: {
          type: 0,
          roleId: 'viewer_id',
          name: 'bob',
          password: 'Str0ng!pw',
          email: 'b@x.io',
          privilege: { all: false, sites: ['S2'] },
          alert: false,
        },
      },
    ]);
  });

  it('lists every site when the account gets all sites', async () => {
    await addAccount({ ...input, allSites: true }, ['S1', 'S2']);
    expect((calls[0].body as { privilege: unknown }).privilege).toEqual({ all: true, sites: ['S1', 'S2'] });
  });

  it('edits with the row minus display fields, keeping the password unless changed', async () => {
    const row: ControllerUser = {
      id: 'U1',
      name: 'bob',
      roleId: 'viewer_id',
      roleName: 'Viewer',
      customerRoleName: 'x',
      type: 0,
      verified: true,
    };
    await editAccount(row, { ...input, password: undefined, name: 'robert' }, ['S1', 'S2']);
    expect(calls[0]).toEqual({
      method: 'PATCH',
      url: '/cid/api/v2/account/users/U1',
      body: {
        name: 'robert',
        roleId: 'viewer_id',
        type: 0,
        verified: true,
        alert: false,
        email: '',
        privilege: { all: false, sites: ['S2'] },
      },
    });
    await editAccount(row, input, [], { token: 'T0K', forceModify: true });
    expect(calls[1].body).toMatchObject({ password: 'Str0ng!pw', token: 'T0K', forceModify: true });
  });

  it('confirms your own password for a token, and deletes with forceDelete', async () => {
    expect(await confirmOwnPassword('U1', 'mine')).toBe('T0K');
    await deleteAccount('U2');
    expect(calls).toEqual([
      { method: 'POST', url: '/cid/api/v2/cmd/users/U1/confirm', body: { password: 'mine' } },
      { method: 'DELETE', url: '/cid/api/v2/users/U2', body: { forceDelete: true } },
    ]);
  });

  it('reads roles and an account’s site ids', async () => {
    expect(await listAvailableRoles()).toEqual([{ id: 'admin_id', name: 'Administrator' }]);
    expect(await getAccountSites('U1')).toEqual(['S1', 'S2', 'S3']);
    expect(calls.map((c) => c.url)).toEqual(['/cid/api/v2/roles-available', '/cid/api/v2/account/users/U1/sites']);
  });

  it('applies the vendor strong-password rule', () => {
    expect(passwordProblem('Str0ng!pw')).toBeNull();
    expect(passwordProblem('Sh0rt!')).toMatch(/8 to 128/);
    expect(passwordProblem('nouppercase1!')).toMatch(/uppercase/);
    expect(passwordProblem('Has space1!')).toMatch(/not allowed/);
    expect(passwordProblem('Quest1on?x')).toMatch(/not allowed/);
  });
});
