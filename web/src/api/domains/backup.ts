import { api, scoped, unwrap } from '../client';
import type { IoResponse } from '../types';

// Controller backup export — the vendor Maintenance → Backup page
// (modules/js/backup-restore chunk), controller view, "Local file":
//   1. POST /{omadacId}/api/v2/maintenance/backup/prepare          (no body)
//   2. GET  /{omadacId}/api/v2/files/backup?retention&retainUser
//             &retainAuthRecord&retainFirmwareLog                  → the .cfg file
//      (vendor download timeout: 5 h)
//   3. meanwhile GET /{omadacId}/api/v2/maintenance/backup/result every 5 s:
//      status 1 running (percent), 0 done, 2 failed
//   Cancel: GET /{omadacId}/api/v2/maintenance/backup/cancel
// A settings-only file (retention -1) is what a fresh controller imports in
// its setup wizard (pages/setup/RestoreBackup).

/** "Retained data" choices; -1 = settings only, 0 = all time. */
export const BACKUP_RETENTION = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '365 days' },
  { value: 0, label: 'All time' },
] as const;
export const SETTINGS_ONLY = -1;

export interface BackupOptions {
  /** Local and cloud users except the main admin. */
  retainUser: boolean;
  /** Authenticated (portal) clients. */
  retainAuthRecord: boolean;
  retainFirmwareLog: boolean;
  /** Days of retained data; only sent when some data is retained. */
  retention: number;
}

/**
 * The vendor query: settings always; `retention` is forced to settings-only
 * unless authenticated clients or firmware logs are included (user info is
 * part of the settings file, so it doesn't count as data).
 */
export function backupParams(o: BackupOptions): Record<string, string | number | boolean> {
  const keepsData = o.retainAuthRecord || o.retainFirmwareLog;
  return {
    retention: keepsData ? o.retention : SETTINGS_ONLY,
    retainUser: o.retainUser,
    retainAuthRecord: o.retainAuthRecord,
    retainFirmwareLog: o.retainFirmwareLog,
  };
}

export async function prepareBackup(): Promise<void> {
  await unwrap(api.post(scoped('/api/v2/maintenance/backup/prepare')));
}

export interface BackupStatus {
  /** 0 done, 1 running, 2 failed. */
  status: number;
  percent?: number;
}

export async function getBackupStatus(): Promise<BackupStatus> {
  return unwrap<BackupStatus>(api.get(scoped('/api/v2/maintenance/backup/result')));
}

export async function cancelBackup(): Promise<void> {
  await unwrap(api.get(scoped('/api/v2/maintenance/backup/cancel')));
}

/** "attachment; filename=\"x.cfg\"" / filename*=UTF-8''x.cfg → x.cfg */
export function filenameFrom(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback;
  const star = disposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain ? plain[1].trim() : fallback;
}

const defaultName = (now = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `omada-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.cfg`;
};

/**
 * Prepares and downloads the backup file. The controller answers a refused
 * backup with its JSON envelope instead of a file; that becomes an error.
 */
export async function downloadBackup(o: BackupOptions, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  await prepareBackup();
  const res = await api.get<Blob>(scoped('/api/v2/files/backup'), {
    params: backupParams(o),
    responseType: 'blob',
    timeout: 5 * 60 * 60 * 1000,
    signal,
  });
  const blob = res.data;
  if (res.status === 302 || /json/i.test(blob?.type ?? '')) {
    const text = res.status === 302 ? '' : await blob.text();
    const body = (text ? JSON.parse(text) : undefined) as IoResponse | undefined;
    // Same handling as every other call (errors, sign-out on a dead session).
    await unwrap(Promise.resolve({ status: res.status, data: body ?? ({ errorCode: -1, msg: 'Backup failed.' } as IoResponse) }));
    throw new Error('The controller did not return a backup file.');
  }
  const disposition = (res.headers?.['content-disposition'] as string | undefined) ?? undefined;
  return { blob, filename: filenameFrom(disposition, defaultName()) };
}

/** Hands a downloaded file to the browser's Save dialog. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
