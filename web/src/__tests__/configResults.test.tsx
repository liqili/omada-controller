// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { theme } from '../theme';

// Fake controller behind the real hooks: only the API module is replaced.
const api = vi.hoisted(() => ({
  listConfigResultDevices: vi.fn(),
  getConfigFeatures: vi.fn(),
  listConfigComponents: vi.fn(),
  reapplyDeviceConfig: vi.fn(),
}));
vi.mock('../api/domains/configResult', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/domains/configResult')>()),
  ...api,
}));

import { ConfigResultsPanel } from '../pages/ConfigResultsPanel';

const statistic = { fail: 1, preConfig: 0, alert: 1, osgAndOsw: 1, ap: 1 };
const garden = { mac: 'AA-00-00-00-00-01', name: 'Garden AP', type: 'ap', model: 'EAP225' };
const rack = { mac: 'AA-00-00-00-00-02', name: 'Rack switch', type: 'switch', needFullSync: true, supportConfigSync: true };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listConfigResultDevices.mockImplementation(async (_s: string, q: { status: number }) => ({
    rows: q.status === 3 ? [garden] : q.status === 2 ? [rack] : [],
    total: q.status === 5 ? 0 : 1,
    statistic,
    onlyNotificationData: false,
  }));
  api.getConfigFeatures.mockImplementation(async (_s: string, mac: string, q: { status: number }) =>
    mac === garden.mac && q.status === 3
      ? [
          { feature: 'ap_ssid', languageKey: 'MENU.WLAN', expandable: true, featureItemSum: 1 },
          { feature: 'ap_led', languageKey: 'SITE.LED_SCHEDULE', unsupportCaps: ['LED schedule'] },
        ]
      : mac === rack.mac && q.status === 2
        ? [{ feature: 'osw_vlan', languageKey: 'X.VLAN', operationList: [3], timeList: [1000], uiErrorCodeList: ['osw_-6'] }]
        : [],
  );
  api.listConfigComponents.mockResolvedValue({ rows: [{ component: 'ap_ssid_5G', name: 'Guests', subEntryLimit: 16 }], total: 1 });
  api.reapplyDeviceConfig.mockResolvedValue(undefined);
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <ConfigResultsPanel siteId="S1" />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );

describe('Configuration results panel', () => {
  it('starts on Failed, like the vendor page, with counts on the status buttons', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'Rack switch' })).toBeTruthy();
    expect(api.listConfigResultDevices).toHaveBeenCalledWith('S1', expect.objectContaining({ status: 2, page: 1, pageSize: 10 }));
    expect(screen.getByRole('button', { name: /Failed \(1\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Incompatible \(1\)/ })).toBeTruthy();
    // First device is selected and its failed feature explained.
    expect(await screen.findByText('Device response timed out.')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('lists incompatible settings with their capability text and expandable items', async () => {
    mount();
    await screen.findByRole('link', { name: 'Rack switch' });
    fireEvent.click(screen.getByRole('button', { name: /Incompatible/ }));
    expect(await screen.findByRole('link', { name: 'Garden AP' })).toBeTruthy();
    expect(api.listConfigResultDevices).toHaveBeenLastCalledWith('S1', expect.objectContaining({ status: 3 }));
    expect(await screen.findByText('The device does not support LED schedule.')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Capability description' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Failure cause' })).toBeNull();

    const ssidRow = screen.getByText('WLAN (1)').closest('tr')!;
    fireEvent.click(within(ssidRow).getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('The device supports up to 16 PPSKs.')).toBeTruthy();
    expect(api.listConfigComponents).toHaveBeenCalledWith('S1', garden.mac, { feature: 'ap_ssid', status: 3, page: 1, pageSize: 10 });
  });

  it('filters by device type', async () => {
    mount();
    await screen.findByRole('link', { name: 'Rack switch' });
    fireEvent.click(screen.getByRole('button', { name: /APs/ }));
    await waitFor(() =>
      expect(api.listConfigResultDevices).toHaveBeenLastCalledWith('S1', expect.objectContaining({ deviceType: 'ap', page: 1 })),
    );
  });

  it('applies the configuration again only after confirming', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply again' }));
    expect(api.reapplyDeviceConfig).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply again' }));
    await waitFor(() => expect(api.reapplyDeviceConfig).toHaveBeenCalledWith('S1', rack.mac));
    expect(await screen.findByText('Configuration sent to the device again.')).toBeTruthy();
  });
});
