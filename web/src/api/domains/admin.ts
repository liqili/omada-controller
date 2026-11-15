import { api, getAllPages, scoped, unwrap } from '../client';
import { normalizeList, type SettingList } from './settings';

// Controller-level administration: accounts, firmware, hotspot vouchers.
// GET verified live against v5.15.6.7 (2026-11-13):
//   GET current/user-detail                 → signed-in account
//   GET upgrade/firmwares?currentPage&currentPageSize → uploaded firmware files (grid)
//   GET hotspot/sites/{sid}/vouchers?currentPage&currentPageSize → voucher grid
//   ✗   users/roles → -1005, upgrade/overview|history → -1600
//
// Accounts (2026-11-16, read from the vendor Admin page, index-GGeklYTc +
// the endpoint registry; the vendor fills {userId} from a path store):
//   GET    account/users?currentPage&currentPageSize   → account grid (local view)
//   GET    roles-available                             → {roles:[{id,name}]}
//   GET    account/users/{userId}/sites                → {sites} (the grid row lists only a few)
//   POST   account/users     {type:0, name, password, email?, roleId,
//                             privilege:{all, sites:[siteId…]}, alert}
//   PATCH  account/users/{userId}  the row minus id/roleName/customerRoleName,
//          with name, password (only when changed), roleId, email, alert,
//          privilege; + token when editing yourself; -30135 (role change
//          moves its accounts to root) is confirmed by resending forceModify:true
//   POST   cmd/users/{userId}/confirm {password}       → {token}  (before editing yourself)
//   DELETE users/{userId}   {forceDelete:true}
// privilege.sites lists every site when `all` is true. The main admin
// (roleId master_admin_id) and yourself can't be deleted.

export interface ControllerUser {
  id: string;
  name: string;
  roleName?: string;
  roleId?: string;
  type?: number;
  verified?: boolean;
  email?: string;
  privilege?: { all?: boolean; sites?: { name?: string; key?: string }[]; siteNum?: number };
  [k: string]: unknown;
}

export interface CurrentUser {
  id?: string;
  name?: string;
  roleName?: string;
  enableMFA?: boolean;
  sitePrivilege?: { all?: boolean; sites?: string[] };
}

export interface Firmware {
  id?: string;
  name?: string;
  model?: string;
  version?: string;
  size?: number;
  uploadTime?: number;
  [k: string]: unknown;
}

export interface Voucher {
  id?: string;
  code?: string;
  duration?: number;
  status?: number;
  note?: string;
  [k: string]: unknown;
}

export async function listUsers(): Promise<SettingList<ControllerUser>> {
  return normalizeList(await getAllPages(scoped('/api/v2/account/users')));
}

// ── account management ─────────────────────────────────────────────────

export const MASTER_ADMIN_ROLE = 'master_admin_id';
/** Local account; 1 is a cloud (TP-Link ID) account. */
export const LOCAL_ACCOUNT = 0;

export interface Role {
  id: string;
  name: string;
}

export async function listAvailableRoles(): Promise<Role[]> {
  const r = await unwrap<{ roles?: Role[] }>(api.get(scoped('/api/v2/roles-available')));
  return r?.roles ?? [];
}

/** Every site id an account may manage (sites come as ids or {key|id}). */
export async function getAccountSites(userId: string): Promise<string[]> {
  const r = await unwrap<{ sites?: (string | { key?: string; id?: string })[] }>(
    api.get(scoped(`/api/v2/account/users/${userId}/sites`)),
  );
  return (r?.sites ?? [])
    .map((x) => (typeof x === 'string' ? x : (x.key ?? x.id ?? '')))
    .filter(Boolean);
}

/** Your own password, checked before editing your account; returns the token the edit carries. */
export async function confirmOwnPassword(userId: string, password: string): Promise<string> {
  const r = await unwrap<{ token?: string }>(api.post(scoped(`/api/v2/cmd/users/${userId}/confirm`), { password }));
  return r?.token ?? '';
}

export interface AccountInput {
  name: string;
  /** New password; leave empty when editing to keep it. */
  password?: string;
  email?: string;
  roleId: string;
  alert: boolean;
  allSites: boolean;
  /** Site ids when not all sites. */
  sites: string[];
}

const privilegeOf = (a: AccountInput, allSiteIds: string[]) => ({
  all: a.allSites,
  sites: a.allSites ? allSiteIds : a.sites,
});

export async function addAccount(a: AccountInput, allSiteIds: string[]): Promise<void> {
  const body: Record<string, unknown> = {
    type: LOCAL_ACCOUNT,
    roleId: a.roleId,
    name: a.name,
    password: a.password,
    privilege: privilegeOf(a, allSiteIds),
    alert: a.alert,
  };
  if (a.email) body.email = a.email;
  await unwrap(api.post(scoped('/api/v2/account/users'), body));
}

export async function editAccount(
  user: ControllerUser,
  a: AccountInput,
  allSiteIds: string[],
  opts: { token?: string; forceModify?: boolean } = {},
): Promise<void> {
  const { id: _id, roleName: _r, customerRoleName: _c, ...row } = user;
  const body: Record<string, unknown> = {
    ...row,
    name: a.name,
    roleId: a.roleId,
    alert: a.alert,
    email: a.email ?? '',
    privilege: privilegeOf(a, allSiteIds),
  };
  if (a.password) body.password = a.password;
  if (opts.token) body.token = opts.token;
  if (opts.forceModify) body.forceModify = true;
  await unwrap(api.patch(scoped(`/api/v2/account/users/${user.id}`), body));
}

export async function deleteAccount(userId: string): Promise<void> {
  await unwrap(api.delete(scoped(`/api/v2/users/${userId}`), { data: { forceDelete: true } }));
}

/** Vendor strong-password rule; returns the problem, or null when it's fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8 || pw.length > 128) return 'Use 8 to 128 characters.';
  if (/[\x00-\x20"?\x7f]/.test(pw) || !/^[\x21-\x7e]+$/.test(pw)) return 'Spaces, " and ? are not allowed.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[!#$%&'()*+,\-./:;<=>@[\\\]^_`{|}~]/.test(pw))
    return 'Include a lowercase letter, an uppercase letter, a number and a symbol.';
  return null;
}

/** The vendor's messages for account errors (err.js). */
export const ACCOUNT_ERRORS: Record<number, string> = {
  [-30100]: 'Select at least one site.',
  [-30101]: 'This username is already used by a hotspot operator.',
  [-30102]: 'This role does not exist.',
  [-30103]: 'Invalid email address.',
  [-30104]: 'Invalid username.',
  [-30105]: 'Invalid password.',
  [-30106]: 'This username is already registered.',
  [-30112]: 'This account does not exist.',
  [-30113]: 'The default account cannot be deleted.',
  [-30115]: 'This account is signed in right now, so it cannot be deleted.',
  [-30133]:
    "An administrator can't have fewer sites than the viewer accounts it created. Edit those viewers' sites first.",
  [-30134]: "A viewer can't have more sites than the account above it. Edit that account's sites first.",
  [-30136]: 'This would give a viewer more sites than the account above it.',
};
/** Role change needs confirming: the account's own accounts move to root. */
export const ACCOUNT_ROLE_CHANGE = -30135;

export async function getCurrentUser(): Promise<CurrentUser> {
  return unwrap<CurrentUser>(api.get(scoped('/api/v2/current/user-detail')));
}

export async function listFirmwares(): Promise<SettingList<Firmware>> {
  return normalizeList(await getAllPages(scoped('/api/v2/upgrade/firmwares')));
}

export async function listVouchers(siteId: string): Promise<SettingList<Voucher>> {
  return normalizeList(await getAllPages(scoped(`/api/v2/hotspot/sites/${siteId}/vouchers`)));
}
