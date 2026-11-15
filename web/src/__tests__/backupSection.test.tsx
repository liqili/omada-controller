// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { theme } from '../theme';

const api = vi.hoisted(() => ({
  downloadBackup: vi.fn(),
  getBackupStatus: vi.fn(),
  cancelBackup: vi.fn(),
  saveFile: vi.fn(),
}));
vi.mock('../api/domains/backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/domains/backup')>()),
  ...api,
}));

import { BackupSection } from '../pages/BackupSection';
import { OmadaApiError } from '../api/client';

const mount = () =>
  render(
    <ThemeProvider theme={theme}>
      <BackupSection />
    </ThemeProvider>,
  );

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('Backup section', () => {
  it('downloads a settings backup and hands it to the browser', async () => {
    const blob = new Blob(['x']);
    api.downloadBackup.mockResolvedValue({ blob, filename: 'omada.cfg' });
    mount();
    fireEvent.click(screen.getByLabelText('User info'));
    fireEvent.click(screen.getByRole('button', { name: 'Back up' }));
    expect(await screen.findByText('Saved omada.cfg.')).toBeTruthy();
    expect(api.downloadBackup).toHaveBeenCalledWith(
      { retainUser: true, retainAuthRecord: false, retainFirmwareLog: false, retention: 7 },
      expect.any(AbortSignal),
    );
    expect(api.saveFile).toHaveBeenCalledWith(blob, 'omada.cfg');
  });

  it('asks how much data to keep only when data is included', () => {
    mount();
    expect(screen.queryByLabelText('Retained data')).toBeNull();
    fireEvent.click(screen.getByLabelText('Firmware update logs'));
    expect(screen.getByLabelText('Retained data')).toBeTruthy();
  });

  it('shows the controller’s reason when it refuses', async () => {
    api.downloadBackup.mockRejectedValue(new OmadaApiError('Importing... Please wait.', -30300));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Back up' }));
    expect(await screen.findByText(/Backup failed: Importing/)).toBeTruthy();
    expect(api.saveFile).not.toHaveBeenCalled();
  });
});
