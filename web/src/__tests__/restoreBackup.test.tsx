// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const calls: string[] = [];
let results: object[] = [];

vi.mock('../api/domains/restore', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/domains/restore')>();
  return {
    ...mod,
    getControllerIdentity: vi.fn(async () => ({ omadacId: 'cid', controllerVer: '5.15.6.7', configured: false })),
    prepareRestore: vi.fn(async (id: string) => void calls.push(`prepare ${id}`)),
    uploadRestore: vi.fn(async (id: string, file: File, opts: { retainDevices: boolean; skipConfirm?: boolean }) => {
      calls.push(`upload ${id} ${file.name} retain=${opts.retainDevices} skipConfirm=${Boolean(opts.skipConfirm)}`);
    }),
    getRestoreResult: vi.fn(async () => {
      const next = results.shift();
      if (!next) throw new Error('unreachable');
      return next;
    }),
  };
});

import { RestoreBackup } from '../pages/setup/RestoreBackup';

const FAST = { firstPollMs: 1, pollMs: 1, maxFailures: 1 };
const ok = (result: object) => ({ errorCode: 0, result });

function chooseFile(name = 'omada.cfg') {
  const input = screen.getByTestId('backup-file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], name)] } });
}

beforeEach(() => {
  calls.length = 0;
  results = [];
});

describe('RestoreBackup', () => {
  it('restores, polls progress and finishes', async () => {
    const onFinished = vi.fn();
    results = [ok({ status: 1 }), ok({ status: 2, percent: 50 }), ok({ status: 0, percent: 100 })];
    render(<RestoreBackup onBack={() => undefined} timing={FAST} onFinished={onFinished} />);
    const restore = screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    chooseFile();
    expect(restore.disabled).toBe(false);
    fireEvent.click(restore);
    await waitFor(() => expect(screen.getByText('Restore complete')).toBeTruthy());
    expect(calls).toEqual(['prepare cid', 'upload cid omada.cfg retain=true skipConfirm=false']);
    await waitFor(() => expect(onFinished).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('sends skipDevice when Retain Device Info is off', async () => {
    results = [ok({ status: 0 })];
    render(<RestoreBackup onBack={() => undefined} timing={FAST} onFinished={() => undefined} />);
    chooseFile();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByText('Restore complete')).toBeTruthy());
    expect(calls[1]).toBe('upload cid omada.cfg retain=false skipConfirm=false');
  });

  it('re-uploads with skipConfirm after the user accepts findings', async () => {
    results = [
      ok({ status: 0, restoreCompatibleResult: { needConfirm: true, misMathDevice: ['EAP110'] } }),
      ok({ status: 0 }),
    ];
    render(<RestoreBackup onBack={() => undefined} timing={FAST} onFinished={() => undefined} />);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByText('Review before importing')).toBeTruthy());
    expect(screen.getByText('EAP110')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getByText('Restore complete')).toBeTruthy());
    expect(calls).toEqual([
      'prepare cid',
      'upload cid omada.cfg retain=true skipConfirm=false',
      'prepare cid',
      'upload cid omada.cfg retain=true skipConfirm=true',
    ]);
  });

  it('cancelling the findings imports nothing', async () => {
    results = [ok({ status: 0, restoreCompatibleResult: { needConfirm: true, misMathSetting: ['Portal'] } })];
    render(<RestoreBackup onBack={() => undefined} timing={FAST} onFinished={() => undefined} />);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByText('Portal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText(/Nothing was imported/)).toBeTruthy());
    expect(calls).toHaveLength(2);
  });

  it('shows the controller error for an invalid file', async () => {
    results = [{ errorCode: -30317, msg: 'Invalid' }];
    render(<RestoreBackup onBack={() => undefined} timing={FAST} onFinished={() => undefined} />);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByText('Invalid controller data file.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('gives up after repeated unreachable polls', async () => {
    results = [];
    render(<RestoreBackup onBack={() => undefined} timing={FAST} onFinished={() => undefined} />);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByText(/Request timed out/)).toBeTruthy());
  });

  it('rejects files that are not .cfg backups', () => {
    render(<RestoreBackup onBack={() => undefined} timing={FAST} onFinished={() => undefined} />);
    chooseFile('photo.png');
    expect(screen.getByText('Select a controller backup file (.cfg).')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
