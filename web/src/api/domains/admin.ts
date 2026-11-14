import { api, scoped, unwrap } from '../client';
import { normalizeList, type SettingList } from './settings';

// Controller-level administration: accounts, firmware, hotspot vouchers.
// GET verified live against v5.15.6.7 (2026-11-13). Write verbs for these are
// NOT pinned down yet, so the UI is read-only here:
//
//   GET users?currentPage&pageSize          → grid of UserVO
//   GET current/user-detail                 → signed-in account
//   GET upgrade/firmwares?currentPage&pageSize → uploaded firmware files (grid)
//   GET hotspot/sites/{sid}/vouchers?currentPage&pageSize → voucher grid
//   ✗   users/roles → -1005, upgrade/overview|history → -1600

export interface ControllerUser {
  id: string;
  name: string;
  roleName?: string;
  roleId?: string;
  type?: number;
  verified?: boolean;
  email?: string;
  privilege?: { all?: boolean; sites?: { name?: string; key?: string }[] };
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

const page = { currentPage: 1, pageSize: 100 };

export async function listUsers(): Promise<SettingList<ControllerUser>> {
  return normalizeList(await unwrap<unknown>(api.get(scoped('/api/v2/users'), { params: page })));
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return unwrap<CurrentUser>(api.get(scoped('/api/v2/current/user-detail')));
}

export async function listFirmwares(): Promise<SettingList<Firmware>> {
  return normalizeList(await unwrap<unknown>(api.get(scoped('/api/v2/upgrade/firmwares'), { params: page })));
}

export async function listVouchers(siteId: string): Promise<SettingList<Voucher>> {
  return normalizeList(
    await unwrap<unknown>(api.get(scoped(`/api/v2/hotspot/sites/${siteId}/vouchers`), { params: page })),
  );
}
