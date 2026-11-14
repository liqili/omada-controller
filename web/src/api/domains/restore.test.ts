import { describe, expect, it } from 'vitest';
import { interpretRestoreResult, validateBackupFile, MAX_BACKUP_BYTES } from './restore';

const ok = (result: object) => ({ errorCode: 0, msg: 'Success.', result: result as never });

describe('interpretRestoreResult (vendor pollingStatus)', () => {
  it('reports progress for preparing and restoring', () => {
    expect(interpretRestoreResult(ok({ status: 1 }))).toEqual({ kind: 'progress', percent: 0 });
    expect(interpretRestoreResult(ok({ status: 2, percent: 42 }))).toEqual({ kind: 'progress', percent: 42 });
  });

  it('finishes on status 0 without findings', () => {
    expect(interpretRestoreResult(ok({ status: 0, percent: 100, resErrorCode: 'OK' }))).toEqual({ kind: 'done' });
    expect(interpretRestoreResult(ok({ status: 0, needReboot: -1 }))).toEqual({ kind: 'done' });
  });

  it('fails on status 3 and on an error envelope', () => {
    expect(interpretRestoreResult(ok({ status: 3 })).kind).toBe('failed');
    const invalid = interpretRestoreResult({ errorCode: -30317, msg: 'x' });
    expect(invalid).toMatchObject({ kind: 'failed', title: 'Invalid controller data file.' });
    expect(interpretRestoreResult({ errorCode: -30306 })).toMatchObject({ kind: 'failed', message: 'Invalid files.' });
    expect(interpretRestoreResult({ errorCode: -99999, msg: 'Boom' })).toMatchObject({ message: 'Boom' });
  });

  it('asks to confirm compatibility findings', () => {
    const r = interpretRestoreResult(
      ok({
        status: 0,
        restoreCompatibleResult: {
          needConfirm: true,
          misMathDevice: ['EAP110'],
          fileScale: 600,
          controllerScale: 500,
          misMathSetting: ['Portal'],
        },
      }),
    );
    expect(r).toEqual({
      kind: 'confirm',
      needConfirm: true,
      unsupportedModels: ['EAP110'],
      deviceLimit: { file: 600, max: 500 },
      incompatibleSettings: ['Portal'],
    });
    // needConfirm false: already imported, the dialog only informs.
    expect(interpretRestoreResult(ok({ status: 0, compatibleFailed: true, restoreCompatibleResult: { needConfirm: false } })))
      .toMatchObject({ kind: 'confirm', needConfirm: false, deviceLimit: undefined });
  });

  it('blocks on management VLAN and version mismatches', () => {
    expect(interpretRestoreResult(ok({ status: 0, compatibleFailed: true, mvlanOutOfRange: true }))).toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('Management VLAN'),
    });
    expect(interpretRestoreResult(ok({ status: 0, compatibleFailed: true, version: { level: 1 } }))).toMatchObject({
      message: expect.stringContaining('higher version'),
    });
    expect(
      interpretRestoreResult(ok({ status: 0, compatibleFailed: true, version: { level: 0, supportVersion: '5.9.0' } })),
    ).toMatchObject({ message: expect.stringContaining('5.9.0 or above') });
  });

  it('reports a changed address and a needed restart', () => {
    expect(interpretRestoreResult(ok({ status: 0, jumpIp: '10.0.0.5:8043' }))).toEqual({ kind: 'jumpIp', address: '10.0.0.5:8043' });
    expect(interpretRestoreResult(ok({ status: 0, needReboot: 0 }))).toEqual({ kind: 'needReboot' });
  });
});

describe('validateBackupFile', () => {
  const file = (name: string, size: number) => ({ name, size }) as File;
  it('accepts .cfg files up to 500 MB', () => {
    expect(validateBackupFile(file('omada.cfg', 1024))).toBeNull();
    expect(validateBackupFile(file('OMADA.CFG', MAX_BACKUP_BYTES))).toBeNull();
  });
  it('rejects other files', () => {
    expect(validateBackupFile(null)).toMatch(/select/i);
    expect(validateBackupFile(file('omada.zip', 10))).toMatch(/\.cfg/);
    expect(validateBackupFile(file('big.cfg', MAX_BACKUP_BYTES + 1))).toMatch(/500 MB/);
    expect(validateBackupFile(file('empty.cfg', 0))).toMatch(/empty/);
  });
});
