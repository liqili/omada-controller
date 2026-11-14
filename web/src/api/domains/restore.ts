import { api, unwrap, OmadaApiError } from '../client';
import type { IoResponse } from '../types';

// First-run "Restore from backup file" — the same calls the vendor setup
// wizard makes before any account exists (restore.vue, mode "qs"):
//   1. GET  /{omadacId}/api/v2/anon/restore/prepare        → errorCode 0
//   2. POST /{omadacId}/api/v2/anon/files/restore          multipart:
//        file = <backup .cfg>, data = {"skipConfirm":"false","skipDevice":"false"}
//      (skipDevice = !"Retain Device Info"; 20 min timeout, ≤ 500 MB)
//   3. GET  /{omadacId}/api/v2/anon/restore/result  every 5 s, starting 7 s
//      after the upload returns: status 1 preparing, 2 restoring (percent),
//      0 finished, 3 failed. A finished result can still carry compatibility
//      findings; when needConfirm is true the upload is sent again with
//      skipConfirm "true" to import anyway.
// The omadacId comes from the anonymous GET /api/info.

export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;
export const BACKUP_EXTENSION = '.cfg';

export interface RestoreCompatibleResult {
  needConfirm?: boolean;
  misMathDevice?: string[];
  fileScale?: number;
  controllerScale?: number;
  misMathSetting?: string[];
}

export interface RestoreResult {
  status: number;
  percent?: number;
  resErrorCode?: string;
  compatibleFailed?: boolean;
  restoreCompatibleResult?: RestoreCompatibleResult;
  mvlanOutOfRange?: boolean;
  version?: { level?: number; supportVersion?: string };
  jumpIp?: string;
  needReboot?: number;
}

export interface RestoreOptions {
  /** "Retain Device Info" (vendor default: on). Sent as skipDevice = !retain. */
  retainDevices: boolean;
  /** Import anyway after the controller reported compatibility findings. */
  skipConfirm?: boolean;
}

// Controller messages for the codes a restore can return (vendor err.js,
// {CONTROLLER_LOWER} → "controller").
const RESTORE_ERRORS: Record<number, string> = {
  [-1003]: 'Failed to load configuration.',
  [-1200]: 'The file size exceeds the limit.',
  [-1700]: 'The file does not exist in the system and needs to be uploaded.',
  [-30300]: 'Importing... Please wait.',
  [-30303]: 'Failed to restore because the file is incompatible.',
  [-30304]: 'Restoring...',
  [-30305]: 'Failed to restore because of unexpected errors. Please try again later.',
  [-30306]: 'Invalid files.',
  [-30307]: 'Invalid configuration file. Please select the configuration file of the same integrated router model.',
  [-30316]: 'Failed to import some devices because they are already managed by this controller.',
  [-30317]: 'Invalid controller data file. Note: a site data file is imported from the site list instead.',
  [-30318]: 'Invalid site data file.',
  [-30319]: 'Failed to restore due to database anomaly, please try again later.',
  [-30323]: 'Import failed. This controller does not support importing the backup file of Omada Controller Pro.',
  [-30324]: 'Cannot import an MSP-level configuration file here. Please use a controller-level configuration file.',
  [-30326]: 'The devices in the customer configuration file are duplicate with the adopted devices and cannot be imported.',
  [-30327]: 'Import failed. Omada Pro Controller does not support importing the backup file of an Omada Controller.',
};

export const RESTORE_FAILED_NOTE = 'Unexpected error occurred while processing. Please try again later.';

export function restoreErrorMessage(errorCode?: number, msg?: string): string {
  if (errorCode !== undefined && RESTORE_ERRORS[errorCode]) return RESTORE_ERRORS[errorCode];
  return msg || RESTORE_FAILED_NOTE;
}

/** Rejects files the vendor uploader would not accept. */
export function validateBackupFile(file: File | null | undefined): string | null {
  if (!file) return 'Select a backup file.';
  if (!file.name.toLowerCase().endsWith(BACKUP_EXTENSION)) return 'Select a controller backup file (.cfg).';
  if (file.size > MAX_BACKUP_BYTES) return 'The file size exceeds the limit (500 MB).';
  if (file.size === 0) return 'The file is empty.';
  return null;
}

export interface ControllerIdentity {
  omadacId: string;
  controllerVer?: string;
  configured?: boolean;
  /** A Local Main Administrator exists (created by anon/register). */
  registeredRoot?: boolean;
}

/** Anonymous GET /api/info — the omadacId every restore call is scoped to. */
export async function getControllerIdentity(): Promise<ControllerIdentity> {
  const info = await unwrap<Partial<ControllerIdentity>>(api.get('/api/info'));
  if (!info?.omadacId) throw new OmadaApiError('Could not identify the controller.');
  return {
    omadacId: info.omadacId,
    controllerVer: info.controllerVer,
    configured: info.configured,
    registeredRoot: info.registeredRoot,
  };
}

/** Delays of the vendor wizard's restore polling. Tests shorten them. */
export const RESTORE_TIMING = { firstPollMs: 7000, pollMs: 5000, maxFailures: 4 };

export async function prepareRestore(omadacId: string): Promise<void> {
  try {
    await unwrap<unknown>(api.get(`/${omadacId}/api/v2/anon/restore/prepare`));
  } catch (e) {
    const err = e as OmadaApiError;
    throw new OmadaApiError(restoreErrorMessage(err.errorCode, err.message), err.errorCode, err.status);
  }
}

export async function uploadRestore(
  omadacId: string,
  file: File,
  { retainDevices, skipConfirm = false }: RestoreOptions,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  form.append('data', JSON.stringify({ skipConfirm: String(skipConfirm), skipDevice: String(!retainDevices) }));
  try {
    await unwrap<unknown>(
      api.post(`/${omadacId}/api/v2/anon/files/restore`, form, {
        timeout: 20 * 60 * 1000,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      }),
    );
  } catch (e) {
    const err = e as OmadaApiError;
    throw new OmadaApiError(restoreErrorMessage(err.errorCode, err.message), err.errorCode, err.status);
  }
}

/** Raw envelope: the result's errorCode decides the outcome, so don't throw. */
export async function getRestoreResult(omadacId: string): Promise<IoResponse<RestoreResult>> {
  const res = await api.get<IoResponse<RestoreResult>>(`/${omadacId}/api/v2/anon/restore/result`, { timeout: 15000 });
  return res.data;
}

export type RestoreOutcome =
  | { kind: 'progress'; percent: number }
  | { kind: 'failed'; title: string; message: string }
  | {
      kind: 'confirm';
      /** true: nothing imported yet, re-upload with skipConfirm to continue. */
      needConfirm: boolean;
      unsupportedModels: string[];
      deviceLimit?: { file: number; max: number };
      incompatibleSettings: string[];
    }
  | { kind: 'jumpIp'; address: string }
  | { kind: 'needReboot' }
  | { kind: 'done' };

/** The vendor wizard's reading of one restore/result poll (pollingStatus). */
export function interpretRestoreResult(env: IoResponse<RestoreResult> | undefined): RestoreOutcome {
  const code = env?.errorCode;
  const r = env?.result;
  if (code !== 0 || !r) {
    return {
      kind: 'failed',
      title: code === -30317 ? 'Invalid controller data file.' : 'Operation failed',
      message: restoreErrorMessage(code, env?.msg),
    };
  }
  switch (r.status) {
    case 1:
      return { kind: 'progress', percent: 0 };
    case 2:
      return { kind: 'progress', percent: Math.max(0, Math.min(100, r.percent ?? 0)) };
    case 0:
      break;
    default:
      return { kind: 'failed', title: 'Operation failed', message: RESTORE_FAILED_NOTE };
  }

  const compat = r.restoreCompatibleResult;
  if (r.compatibleFailed || (compat && compat.needConfirm !== undefined)) {
    if (r.mvlanOutOfRange) {
      return {
        kind: 'failed',
        title: 'Import Failed!',
        message:
          'Failed to import this controller because the Management VLAN ID is out of range. Omada Controller supports the Management VLAN only with VLAN ID between 1 and 4090.',
      };
    }
    if (r.version) {
      const higher = r.version.level === 1;
      return {
        kind: 'failed',
        title: 'Import Failed!',
        message: higher
          ? 'The imported file comes from the Omada Controller with a higher version, which is incompatible with the current controller.'
          : `The controller does not support the imported file. Please import the configuration file from Omada Controller with version ${r.version.supportVersion ?? 'shown in the release notes'} or above.`,
      };
    }
    const fileScale = compat?.fileScale;
    const max = compat?.controllerScale;
    return {
      kind: 'confirm',
      needConfirm: Boolean(compat?.needConfirm),
      unsupportedModels: compat?.misMathDevice ?? [],
      deviceLimit: fileScale && max && fileScale > max ? { file: fileScale, max } : undefined,
      incompatibleSettings: compat?.misMathSetting ?? [],
    };
  }
  if (r.jumpIp) return { kind: 'jumpIp', address: r.jumpIp };
  if (typeof r.needReboot === 'number' && r.needReboot !== -1) return { kind: 'needReboot' };
  return { kind: 'done' };
}
