import { describe, expect, it } from 'vitest';
import {
  actualChannelNumber,
  bandLabel,
  downlinkSpeed,
  liveChannelText,
  negotiatedSpeed,
  rateText,
  trafficText,
  uptimeText,
  utilization,
} from './detailFormat';
import { channelOptionValue } from '../../api/domains/ap';

describe('device detail formatting (legacy parity)', () => {
  it('formats traffic 1024-based like getTrafficData', () => {
    expect(trafficText(0)).toBe('0');
    expect(trafficText(512)).toBe('512 B');
    expect(trafficText(1536)).toBe('1.50 KB');
    expect(trafficText(5 * 1048576)).toBe('5.00 MB');
    expect(trafficText(3 * 1073741824 + 1)).toBe('3.00 GB');
    expect(trafficText(undefined)).toBe('--');
  });

  it('formats rates and uptime', () => {
    expect(rateText(866)).toBe('866Mbps');
    expect(rateText(1201)).toBe('1.20Gbps');
    expect(uptimeText(249 * 86400 + 22 * 3600 + 17 * 60 + 46)).toBe('249day(s) 22h 17m 46s');
    expect(uptimeText(65)).toBe('1m 5s');
    expect(uptimeText(undefined, '3h 2m 1s')).toBe('3h 2m 1s');
  });

  it('reads the live channel from actualChannel, Auto(n) when set to auto', () => {
    const wp = { actualChannel: '36 / 5180MHz' };
    expect(actualChannelNumber(wp)).toBe('36');
    expect(actualChannelNumber({ actualChannel: 'N/A' })).toBeUndefined();
    expect(liveChannelText('0', wp, true)).toBe('Auto(36)');
    expect(liveChannelText('7', wp, true)).toBe('36');
    expect(liveChannelText('0', wp, false)).toBe('Auto(-)');
  });

  it('sums utilization and rates it like the legacy header', () => {
    expect(utilization({ rxUtil: 0, txUtil: 0, interUtil: 0 })).toMatchObject({ total: 0, rating: 'Good' });
    expect(utilization({ rxUtil: 10, txUtil: 5, interUtil: 10 })).toMatchObject({ total: 25, rating: 'Acceptable' });
    expect(utilization({ busyUtil: 55 })).toMatchObject({ total: 55, busy: 55, rating: 'High' });
    expect(utilization({ actualChannel: '36 / 5180MHz' })).toBeUndefined();
  });

  it('shows the negotiated uplink speed from rate, else the row linkSpeed code', () => {
    expect(negotiatedSpeed({ wiredUplink: { rate: 1000 } })).toBe('1000 Mbps');
    expect(negotiatedSpeed({ wiredUplink: {}, linkSpeed: 4 })).toBe('2.5 Gbps');
    expect(negotiatedSpeed({ linkSpeed: 3 })).toBe('1000 Mbps');
    expect(negotiatedSpeed({ wiredUplink: { rate: 0 }, linkSpeed: 0 })).toBe('--');
    // Real controllers send rate as a string.
    expect(negotiatedSpeed({ wiredUplink: { rate: '2500' } })).toBe('2500 Mbps');
    expect(negotiatedSpeed({ wiredUplink: { rate: '' }, linkSpeed: 3 })).toBe('1000 Mbps');
    expect(trafficText('1536')).toBe('1.50 KB');
  });

  it('writes downlink speed from the LINK_SPEED code plus duplex, like the legacy grid', () => {
    expect(downlinkSpeed({ speed: 3, duplex: 2 })).toBe('1000 Mbps Full Duplex');
    expect(downlinkSpeed({ speed: 2, duplex: 1 })).toBe('100 Mbps Half Duplex');
    expect(downlinkSpeed({ speed: 4, duplex: 2 })).toBe('2.5 Gbps Full Duplex');
    expect(downlinkSpeed({ speed: 3 })).toBe('--');
    expect(downlinkSpeed({ speed: 1000, duplex: 2 })).toBe('--');
  });

  it('labels bands like legacy', () => {
    expect(bandLabel('5g', {})).toBe('5 GHz');
    expect(bandLabel('5g', { deviceMisc: { support5g2: true } })).toBe('5 GHz-1');
  });

  it('uses the channel list entry value, not the channel number, as the setting', () => {
    expect(channelOptionValue({ value: 3, channelValue: 44, channelName: '44 / 5220MHz' })).toBe('3');
  });
});
