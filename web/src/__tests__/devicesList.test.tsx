// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { theme } from '../theme';
import type { Client, Device } from '../api/types';
import { clientUplink } from '../pages/clientFormat';

const mutate = vi.fn();
const devices: Device[] = [
  { mac: 'AA-AA-AA-00-00-01', name: 'Hall AP', type: 'ap', status: 14, statusCategory: 1, ip: '10.0.0.2' },
  { mac: 'AA-AA-AA-00-00-02', name: 'Attic AP', type: 'ap', status: 0, statusCategory: 0 },
];
const clients: Client[] = [
  { mac: 'C1', name: 'Phone', type: 1, wireless: true, ssid: 'Home', apName: 'Hall AP', apMac: 'AA-AA-AA-00-00-01' },
  { mac: 'C2', name: 'NAS', type: 0, wireless: false, connectDevType: 'switch', switchName: 'SG2008P', switchMac: 'SW-1', port: 5 },
];

vi.mock('../hooks/queries', () => ({
  useDevices: () => ({ data: devices, isLoading: false, error: null }),
  usePendingDevices: () => ({ data: { data: [] } }),
  useAdoptMany: () => ({ mutate: vi.fn(), isPending: false }),
  useDeviceCmd: () => ({ mutate, isPending: false }),
  useClients: () => ({ data: clients, isLoading: false, error: null }),
  useConfigResultDevices: () => ({ data: undefined }),
}));
vi.mock('../hooks/useSiteContext', () => ({ useSite: () => ({ siteId: 'S1' }) }));
vi.mock('../components/AddDevicesDialog', () => ({ AddDevicesDialog: () => null }));

import DevicesPage from '../pages/DevicesPage';
import ClientsPage from '../pages/ClientsPage';

const mount = (ui: React.ReactElement) =>
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/devices/:mac" element={<div>device page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

describe('devices list Action column', () => {
  beforeEach(() => mutate.mockReset());

  it('locates a connected device without opening it', () => {
    mount(<DevicesPage />);
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeTruthy();
    fireEvent.click(within(rowOf('Hall AP')).getByRole('button', { name: 'Locate' }));
    expect(mutate).toHaveBeenCalledWith({ mac: 'AA-AA-AA-00-00-01', cmd: 'locate', enable: true }, expect.anything());
    expect(screen.queryByText('device page')).toBeNull();
  });

  it('offers "Stop locating" on a device whose LED is flashing', () => {
    devices[0] = { ...devices[0], locateEnable: true };
    try {
      mount(<DevicesPage />);
      fireEvent.click(within(rowOf('Hall AP')).getByRole('button', { name: 'Stop locating' }));
      expect(mutate).toHaveBeenCalledWith({ mac: 'AA-AA-AA-00-00-01', cmd: 'locate', enable: false }, expect.anything());
    } finally {
      devices[0] = { ...devices[0], locateEnable: false };
    }
  });

  it('asks before rebooting', () => {
    mount(<DevicesPage />);
    fireEvent.click(within(rowOf('Hall AP')).getByRole('button', { name: 'Reboot' }));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reboot' }));
    expect(mutate).toHaveBeenCalledWith({ mac: 'AA-AA-AA-00-00-01', cmd: 'reboot' }, expect.anything());
  });

  it('disables actions on a disconnected device', () => {
    mount(<DevicesPage />);
    const row = rowOf('Attic AP');
    expect((within(row).getByRole('button', { name: 'Locate' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(row).getByRole('button', { name: 'Reboot' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('clients AP/Port column', () => {
  it('shows the AP for wireless clients and switch + port for wired ones', () => {
    mount(<ClientsPage />);
    expect(screen.getByRole('columnheader', { name: 'AP/Port' })).toBeTruthy();
    expect(within(rowOf('Phone')).getByRole('link', { name: 'Hall AP' }).getAttribute('href')).toBe('/devices/AA-AA-AA-00-00-01');
    expect(within(rowOf('NAS')).getByText('SG2008P Port 5')).toBeTruthy();
  });

  it('formats like the legacy grid', () => {
    expect(clientUplink({ mac: 'x', type: 0, connectDevType: 'switch', switchName: 'Core', lagId: 2, port: 9 }).text).toBe('Core LAG 2');
    expect(clientUplink({ mac: 'x', type: 0, connectDevType: 'ap', apName: 'Wall AP', port: 1 }).text).toBe('Wall AP Port 1');
    expect(clientUplink({ mac: 'x', type: 0, connectDevType: 'gateway', gatewayName: 'ER605' }).text).toBe('ER605');
    expect(
      clientUplink({ mac: 'x', type: 0, connectDevType: 'switch', stackableSwitch: true, switchName: 'S1', stackName: 'Stack', port: 3 }).text,
    ).toBe('S1[Stack] Port 3');
    expect(clientUplink({ mac: 'x', type: 1 }).text).toBe('--');
  });
});
