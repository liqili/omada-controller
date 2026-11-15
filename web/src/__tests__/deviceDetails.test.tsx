// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { theme } from '../theme';
import { DetailSections, RadioUtilization } from '../pages/device/DetailSections';
import type { Device } from '../api/types';
import festa from './fixtures/festa-f76-detail.json';

// Shaped like ApDetailVO for the EAP655-Wall in the legacy screenshot.
const ap: Device = {
  mac: 'B0-19-21-19-80-4A',
  type: 'ap',
  status: 14,
  statusCategory: 1,
  ip: '10.0.0.201',
  publicIp: '10.0.0.201',
  ipv6List: [],
  showModel: 'EAP655-Wall(EU) v1.0',
  firmwareVersion: '1.3.1 Build 20240929 Rel. 44742',
  cpuUtil: 2,
  memUtil: 38,
  uptime: '249day(s) 22h 17m 46s',
  uptimeLong: 249 * 86400 + 22 * 3600 + 17 * 60 + 46,
  radioSetting5g: { radioEnable: true, channel: '0' },
  wp5g: { actualChannel: '36 / 5180MHz', rdMode: 'a/n/ac/ax mixed', bandWidth: '80MHz', txPower: 20, rxUtil: 0, txUtil: 0, interUtil: 0 },
  radioTraffic5g: { rxPkts: 1000, rx: 2048, txPkts: 900, tx: 5 * 1048576, rxDropPkts: 0, txDropPkts: 0 },
  lanTraffic: { rxPkts: 10, rx: 1536, txPkts: 20, tx: 4096 },
  wiredUplink: { name: 'Core Switch', duplex: 2, rate: 1000, downPackets: 5, downBytes: 3072, upPackets: 6, upBytes: 2048, activity: 1450 },
  // speed is a LINK_SPEED code (2 = 100 Mbps), not Mbps.
  downlinkList: [{ port: 'ETH1', deviceName: 'Printer', ip: '10.0.0.50', mac: 'AA-BB-CC-00-11-22', link: true, speed: 2, duplex: 2 }],
};

const mount = (ui: React.ReactElement) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('device Details tab (legacy drawer parity)', () => {
  it('shows the channel utilization header from wp5g', () => {
    mount(<RadioUtilization device={ap} />);
    const card = screen.getByTestId('util-5g');
    expect(within(card).getByText('36')).toBeTruthy();
    expect(within(card).getByText('a/n/ac/ax mixed')).toBeTruthy();
    expect(within(card).getByText('5 GHz')).toBeTruthy();
    expect(within(card).getByText('(0% Utilized)')).toBeTruthy();
    expect(within(card).getByText('Good')).toBeTruthy();
    expect(within(card).getByText(/Rx Frames/)).toBeTruthy();
  });

  it('shows "--", not "N", for a radio whose channel is N/A', () => {
    mount(<RadioUtilization device={{ ...ap, wp2g: { actualChannel: 'N/A', rdMode: 'b/g/n/ax mixed', rxUtil: 0, txUtil: 0, interUtil: 0 } }} bare />);
    const card = screen.getByTestId('util-2g');
    expect(within(card).getByText('--')).toBeTruthy();
    expect(within(card).queryByText('N')).toBeNull();
  });

  it('fills Overview with the legacy fields', () => {
    mount(<DetailSections device={ap} connected />);
    for (const [label, value] of [
      ['MAC Address', 'B0-19-21-19-80-4A'],
      ['Public IP Address', '10.0.0.201'],
      ['IPv6 Address', '--'],
      ['Model', 'EAP655-Wall(EU) v1.0'],
      ['Firmware Version', '1.3.1 Build 20240929 Rel. 44742'],
      ['Uptime', '249day(s) 22h 17m 46s'],
    ]) {
      const field = screen.getByText(label).parentElement!;
      expect(within(field).getByText(value)).toBeTruthy();
    }
    expect(screen.getByText('2%')).toBeTruthy();
    expect(screen.getByText('38%')).toBeTruthy();
  });

  it('has LAN, Uplink (Wired), Downlink and Radios sections with their data', () => {
    mount(<DetailSections device={ap} connected />);
    for (const t of ['LAN', 'Uplink (Wired)', 'Downlink', 'Radios']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText('Core Switch')).toBeTruthy();
    expect(within(screen.getByText('Negotiated Speed').parentElement!).getByText('1000 Mbps')).toBeTruthy();
    expect(screen.getByText('Printer')).toBeTruthy();
    expect(screen.getByText('100 Mbps Full Duplex')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('36 / 5180MHz')).toBeTruthy();
    expect(screen.getByText('802.11a/n/ac/ax mixed')).toBeTruthy();
    expect(screen.getByText('5.00 MB')).toBeTruthy();
    expect(screen.queryByText('Uplink (Wireless)')).toBeNull();
  });

  it('falls back to the device row for uplink speed, device and port', () => {
    const { wiredUplink: _omit, ...rest } = ap;
    mount(<DetailSections device={{ ...rest, linkSpeed: 4, duplex: 2, uplinkDeviceName: 'SG2008P', uplinkDevicePort: '5' }} connected />);
    expect(within(screen.getByText('Negotiated Speed').parentElement!).getByText('2.5 Gbps')).toBeTruthy();
    expect(screen.getByText('SG2008P (port 5)')).toBeTruthy();
    expect(within(screen.getAllByText('Duplex')[0].parentElement!).getByText('Full Duplex')).toBeTruthy();
  });

  it('hides live sections while the device is disconnected', () => {
    mount(<DetailSections device={{ ...ap, statusCategory: 0, lastSeen: Date.UTC(2026, 10, 14) }} connected={false} />);
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.getByText('Last Seen')).toBeTruthy();
    for (const t of ['LAN', 'Uplink (Wired)', 'Radios', 'CPU Utilization']) expect(screen.queryByText(t)).toBeNull();
  });
});

// The user's real controller response (trimmed), not a hand-made shape.
describe('Details tab with a real Festa F76 response', () => {
  const real = festa as unknown as Device;

  it('shows the negotiated speed from the string rate "2500"', () => {
    mount(<DetailSections device={real} connected />);
    expect(within(screen.getByText('Negotiated Speed').parentElement!).getByText('2500 Mbps')).toBeTruthy();
    expect(within(screen.getAllByText('Duplex')[0].parentElement!).getByText('Full Duplex')).toBeTruthy();
    expect(within(screen.getByText('Activity Speed').parentElement!).getByText('235.08 KB/s')).toBeTruthy();
    // "40  / 5200MHz" from the firmware, shown with one space.
    expect(screen.getByText('40 / 5200MHz')).toBeTruthy();
  });

  it('puts only the switched-on 5 GHz radio, on channel 40, in the header', () => {
    mount(<RadioUtilization device={real} bare />);
    expect(within(screen.getByTestId('util-5g')).getByText('40')).toBeTruthy();
    expect(screen.queryByTestId('util-2g')).toBeNull();
    expect(screen.queryByTestId('util-6g')).toBeNull();
  });
});
