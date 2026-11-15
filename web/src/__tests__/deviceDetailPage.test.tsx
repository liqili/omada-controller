// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { theme } from '../theme';
import type { Device } from '../api/types';

const ap: Device = {
  mac: 'B0-19-21-19-80-4A',
  name: 'Hall AP',
  type: 'ap',
  status: 14,
  statusCategory: 1,
  ip: '10.0.0.201',
  wp5g: { actualChannel: '36 / 5180MHz', rdMode: 'a/n/ac/ax mixed', rxUtil: 0, txUtil: 0, interUtil: 1 },
};

vi.mock('../hooks/queries', () => ({
  useDevice: () => ({ data: ap, isLoading: false, error: null }),
  useDeviceCmd: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useForgetDevice: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('../hooks/useSiteContext', () => ({ useSite: () => ({ siteId: 'S1' }) }));
vi.mock('../pages/device/FirmwarePanel', () => ({ default: () => <div>Firmware panel</div> }));
vi.mock('../pages/device/ApConfigPanel', () => ({ default: () => <div>Config panel</div> }));
vi.mock('../pages/device/TerminalPanel', () => ({ default: () => <div>Terminal panel</div> }));

import DeviceDetailPage from '../pages/DeviceDetailPage';

const mountAt = (url: string) =>
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/devices/:mac" element={<DeviceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );

describe('device detail page layout', () => {
  it('shows channel utilization in the header and no actions on Details', () => {
    mountAt('/devices/B0-19-21-19-80-4A');
    expect(screen.getByTestId('util-5g')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Advanced' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Firmware' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Force provision' })).toBeNull();
  });

  it('puts force provision and forget on the Advanced tab with firmware; locate and reboot live in the devices list', async () => {
    mountAt('/devices/B0-19-21-19-80-4A?tab=advanced');
    for (const name of ['Force provision', 'Forget']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    for (const name of ['Locate', 'Reboot']) expect(screen.queryByRole('button', { name })).toBeNull();
    await waitFor(() => expect(screen.getByText('Firmware panel')).toBeTruthy());
    expect(within(screen.getByRole('tab', { selected: true })).getByText('Advanced')).toBeTruthy();
  });

  it('still opens Advanced from an old ?tab=firmware link', () => {
    mountAt('/devices/B0-19-21-19-80-4A?tab=firmware');
    expect(screen.getByRole('button', { name: 'Force provision' })).toBeTruthy();
  });
});
