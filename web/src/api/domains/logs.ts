import { api, scoped, unwrap } from '../client';

// Logs — alerts and events. GET verified live against v5.15.6.7 (2026-11-13):
//
//   GET sites/{sid}/alerts?currentPage&pageSize&filters.archived&filters.timeStart&filters.timeEnd
//   GET sites/{sid}/events?currentPage&pageSize&filters.timeStart&filters.timeEnd
//       → {totalRows, currentPage, currentSize, data:[{id,module,key,level,content,time,archived,…}]}
//   GET sites/{sid}/alerts/num  → {alertNum}
//   GET log/nums                → {totalNum, limitNum}        (controller-scoped)
//
// The time window is REQUIRED: without filters.timeStart/timeEnd (epoch ms) the
// controller answers -1001 ("Invalid request parameters" / "Failed to init
// query"). Optional filters, as the vendor UI sends them:
//   filters.level  = Error | Warning | Information
//   filters.module = Operation | System | Device | Client
//   searchKey      = free text

export type LogKind = 'alerts' | 'events';
export const LOG_LEVELS = ['Error', 'Warning', 'Information'] as const;
export const LOG_MODULES = ['Operation', 'System', 'Device', 'Client'] as const;

export interface LogEntry {
  id?: string;
  module?: string;
  key?: string;
  level?: string;
  content?: string;
  time?: number;
  archived?: boolean;
}

export interface LogQuery {
  /** Window start/end, epoch milliseconds. */
  timeStart: number;
  timeEnd: number;
  level?: string;
  module?: string;
  search?: string;
  /** Alerts only. */
  archived?: boolean;
  page?: number;
  pageSize?: number;
}

export interface LogPage {
  rows: LogEntry[];
  total: number;
}

export async function listLogs(siteId: string, kind: LogKind, q: LogQuery): Promise<LogPage> {
  const params: Record<string, unknown> = {
    currentPage: q.page ?? 1,
    pageSize: q.pageSize ?? 50,
    'filters.timeStart': q.timeStart,
    'filters.timeEnd': q.timeEnd,
  };
  if (kind === 'alerts') params['filters.archived'] = q.archived ?? false;
  if (q.level) params['filters.level'] = q.level;
  if (q.module) params['filters.module'] = q.module;
  if (q.search) params.searchKey = q.search;
  const r = await unwrap<{ data?: LogEntry[]; totalRows?: number }>(
    api.get(scoped(`/api/v2/sites/${siteId}/${kind}`), { params }),
  );
  return { rows: r?.data ?? [], total: r?.totalRows ?? 0 };
}

/** Unarchived alert count for the site — cheap, used for the nav/dashboard badge. */
export async function getAlertNum(siteId: string): Promise<number> {
  const r = await unwrap<{ alertNum?: number }>(api.get(scoped(`/api/v2/sites/${siteId}/alerts/num`)));
  return r?.alertNum ?? 0;
}

/** Stored log count vs. the controller's retention limit. */
export async function getLogNums(): Promise<{ totalNum: number; limitNum: number }> {
  const r = await unwrap<{ totalNum?: number; limitNum?: number }>(api.get(scoped('/api/v2/log/nums')));
  return { totalNum: r?.totalNum ?? 0, limitNum: r?.limitNum ?? 0 };
}
