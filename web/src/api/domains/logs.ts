import { api, scoped, unwrap } from '../client';

// Logs — alerts and events.
//
//   GET sites/{sid}/logs/alerts?filters.timeStart&filters.timeEnd&filters.resolved&currentPage&currentPageSize
//   GET sites/{sid}/logs/events?filters.timeStart&filters.timeEnd&currentPage&currentPageSize
//       → {totalRows, currentPage, currentSize, logStatistic, data:[{id,key,level,module,content,time,
//          deviceNames, clientNames, autoResolve, resolved, resolveType, resolveTime,…}]}
//   GET sites/{sid}/alerts/num  → {alertNum}
//   GET log/nums                → {totalNum, limitNum}        (controller-scoped)
//
// Found 2026-11-15 on the user's 5.15.6.7 NAS controller: the logs page reads
// sites/{sid}/logs/{alerts|events} (vendor registry getAlertSiteLogs /
// getEventSiteLogs, modules/js/useLogTable). The older sites/{sid}/alerts and
// sites/{sid}/events answer too, but came back empty there while the vendor UI
// listed alerts — do not go back to them.
//
// The time window is REQUIRED (epoch ms; -1001 without it). Optional filters,
// as the vendor table sends them:
//   filters.resolved = true | false   (alerts only; the vendor UI opens on unresolved)
//   filters.level    = Critical | Error | Warning | Information
//   filters.module   = Operation | System | Device | Client  (omit for all)
//   searchKey        = free text
// Message text carries placeholders like "[ap:20-36-26-D5-A7-20]" that the
// row's deviceNames / clientNames ({mac: name}) resolve — see logText().

export type LogKind = 'alerts' | 'events';
export const LOG_LEVELS = ['Critical', 'Error', 'Warning', 'Information'] as const;
export const LOG_MODULES = ['Operation', 'System', 'Device', 'Client'] as const;

export interface LogEntry {
  id?: string;
  module?: string;
  key?: string;
  level?: string;
  content?: string;
  time?: number;
  deviceNames?: Record<string, string>;
  clientNames?: Record<string, string>;
  resolved?: boolean;
  autoResolve?: boolean;
  resolveTime?: number;
}

export interface LogQuery {
  /** Window start/end, epoch milliseconds. */
  timeStart: number;
  timeEnd: number;
  level?: string;
  module?: string;
  search?: string;
  /** Alerts only: resolved (true) or unresolved (false). */
  resolved?: boolean;
  page?: number;
  pageSize?: number;
}

export interface LogPage {
  rows: LogEntry[];
  total: number;
}

export async function listLogs(siteId: string, kind: LogKind, q: LogQuery): Promise<LogPage> {
  const params: Record<string, unknown> = {
    'filters.timeStart': q.timeStart,
    'filters.timeEnd': q.timeEnd,
  };
  if (kind === 'alerts') params['filters.resolved'] = q.resolved ?? false;
  if (q.level) params['filters.level'] = q.level;
  if (q.module) params['filters.module'] = q.module;
  if (q.search) params.searchKey = q.search;
  params.currentPage = q.page ?? 1;
  // The controller reads currentPageSize (pageSize is ignored → 10 rows).
  params.currentPageSize = q.pageSize ?? 50;
  const r = await unwrap<{ data?: LogEntry[]; totalRows?: number }>(
    api.get(scoped(`/api/v2/sites/${siteId}/logs/${kind}`), { params }),
  );
  return { rows: r?.data ?? [], total: r?.totalRows ?? 0 };
}

/**
 * Log message with its "[type:id]" placeholders replaced by names, as the
 * vendor table does: "[ap:20-36-26-D5-A7-20] was disconnected." →
 * "Office AP was disconnected." Unknown ids stay as the id.
 */
export function logText(l: LogEntry): string {
  const text = l.content ?? l.key ?? '';
  return text.replace(/\[([a-z_]+):([\w-]+)\]/g, (_m, type: string, id: string) =>
    (type === 'client' ? l.clientNames : l.deviceNames)?.[id] ?? l.deviceNames?.[id] ?? l.clientNames?.[id] ?? id,
  );
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
