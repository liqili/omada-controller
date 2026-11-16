import { describe, expect, it } from 'vitest';
import {
  channelsForWidth,
  overrideProblems,
  overridesForGroup,
  serializeOverride,
  supportedRadios,
  widthOptions,
  WIDTH_LABEL,
  type ChannelOption,
  type SsidOverride,
  type WlanSsidGroup,
} from './ap';

// widthFlag bits: 20 MHz, 40 MHz, base+80 MHz, base+160 MHz.
const W20 = 65536;
const W40 = 131072;
const W80 = 256 | 8388608;
const W160 = 256 | 16777216;
const ch = (value: number, channelValue: number, widthFlag: number): ChannelOption => ({ value, channelValue, widthFlag });
const fiveG = [ch(1, 36, W20 | W40 | W80 | W160), ch(2, 52, W20 | W40 | W80 | W160), ch(3, 140, W20 | W40 | W80), ch(4, 165, W20)];

describe('supportedRadios', () => {
  it('follows deviceMisc band flags', () => {
    expect(
      supportedRadios({ mac: 'x', deviceMisc: { support2g: true, support5g: true, support5g2: false, support6g: false } }),
    ).toEqual(['radioSetting2g', 'radioSetting5g']);
    expect(supportedRadios({ mac: 'x', deviceMisc: { support2g: false, support5g: true, support6g: true } })).toEqual([
      'radioSetting5g',
      'radioSetting6g',
    ]);
  });

  it('falls back to the radio blocks present when deviceMisc is missing', () => {
    expect(supportedRadios({ mac: 'x', radioSetting2g: {}, radioSetting5g: {} })).toEqual(['radioSetting2g', 'radioSetting5g']);
  });
});

describe('widthOptions', () => {
  it('starts with the band-specific auto value and has a label for every option', () => {
    expect(widthOptions('radioSetting2g')[0]).toBe('4');
    expect(widthOptions('radioSetting5g')[0]).toBe('6');
    expect(widthOptions('radioSetting6g')[0]).toBe('8');
    for (const r of ['radioSetting2g', 'radioSetting5g', 'radioSetting5g2', 'radioSetting6g'] as const) {
      for (const w of widthOptions(r)) expect(WIDTH_LABEL[w]).toBeTruthy();
    }
  });

  it('offers 160 MHz on 5 GHz when the AP’s channels support it, as the vendor UI does', () => {
    expect(widthOptions('radioSetting5g', fiveG, { support11ac: true })).toEqual(['6', '2', '3', '5', '7']);
    expect(widthOptions('radioSetting5g', fiveG.slice(2))).toEqual(['6', '2', '3', '5']);
    expect(widthOptions('radioSetting5g', [ch(1, 36, W20)])).toEqual(['2']);
    expect(widthOptions('radioSetting5g', fiveG, { support11ac: false })).toEqual(['6', '2', '3']);
    for (const w of widthOptions('radioSetting5g', fiveG)) expect(WIDTH_LABEL[w]).toBeTruthy();
  });

  it('narrows by a fixed wireless mode only', () => {
    expect(widthOptions('radioSetting5g', fiveG, { wirelessMode: -2 })).toContain('7');
    // 802.11a/n (7): no 80 or 160 MHz; a/n/ac (10) and later keep them.
    expect(widthOptions('radioSetting5g', fiveG, { wirelessMode: 7 })).toEqual(['6', '2', '3']);
    expect(widthOptions('radioSetting5g', fiveG, { wirelessMode: 10 })).toEqual(['6', '2', '3', '5', '7']);
  });

  it('keeps the fixed lists when channels carry no widthFlag', () => {
    expect(widthOptions('radioSetting5g', [{ value: 1, channelValue: 36 }])).toEqual(['6', '2', '3', '5']);
  });
});

describe('channelsForWidth', () => {
  const values = (l: ChannelOption[]) => l.map((c) => c.channelValue);
  it('keeps the channels that can run at the chosen width', () => {
    expect(values(channelsForWidth('radioSetting5g', fiveG, '7'))).toEqual([36, 52]);
    expect(values(channelsForWidth('radioSetting5g', fiveG, '5'))).toEqual([36, 52, 140]);
    expect(values(channelsForWidth('radioSetting5g', fiveG, '2'))).toEqual([36, 52, 140, 165]);
    // Auto on 5 GHz picks up to 80 MHz.
    expect(values(channelsForWidth('radioSetting5g', fiveG, '6'))).toEqual([36, 52, 140]);
    expect(values(channelsForWidth('radioSetting2g', [ch(1, 1, W20)], '3'))).toEqual([1]);
  });
});

describe('per-AP SSID overrides', () => {
  const saved: SsidOverride = {
    index: 11, globalSsid: 'Office', supportBands: [1], security: 3, enable: true, ssid: 'Office-Lobby',
    psk: 'secret123', vlanEnable: true, vlanId: 20, ssidEnable: false,
  };
  const ap = {
    mac: 'x', wlanId: 'g1', ssidOverrides: [saved],
    deviceMisc: { support2g: true, support5g: true, support6g: false },
  };
  const groups: WlanSsidGroup[] = [
    { wlanId: 'g1', wlanName: 'Default', ssids: [{ idInt: 11, name: 'Office', bandInfo: 2, securityMode: 3 }] },
    {
      wlanId: 'g2',
      wlanName: 'Guest',
      ssids: [
        { idInt: 21, name: 'Guest', bandInfo: 3, securityMode: 0, vlanId: 30 },
        { idInt: 22, name: 'Guest-6', bandInfo: 4, securityMode: 3 },
      ],
    },
  ];

  it('keeps the saved overrides for the AP’s own group', () => {
    expect(overridesForGroup(ap, 'g1', groups)).toEqual([saved]);
  });

  it('starts another group from its SSIDs, nothing overridden, on the bands the AP has', () => {
    expect(overridesForGroup(ap, 'g2', groups)).toEqual([
      {
        index: 21, globalSsid: 'Guest', ssid: 'Guest', supportBands: [0, 1], security: 0, psk: undefined, hidePwd: undefined,
        enable: false, vlanEnable: false, vlanId: 30, ssidEnable: true,
      },
    ]);
  });

  it('checks an override like the vendor form', () => {
    const rows = overridesForGroup(ap, 'g2', groups).concat([saved]);
    expect(overrideProblems({ ...rows[0], enable: false, ssid: '' }, rows)).toEqual({});
    expect(Object.keys(overrideProblems({ ...rows[0], enable: true, ssid: 'Office' }, rows))).toEqual(['ssid']);
    expect(Object.keys(overrideProblems({ ...rows[0], enable: true, ssid: 'Office-Lobby' }, rows))).toEqual(['ssid']);
    expect(Object.keys(overrideProblems({ ...saved, psk: ' leading', vlanId: 0 }, rows)).sort()).toEqual(['psk', 'vlanId']);
    expect(overrideProblems({ ...saved, psk: undefined, hidePwd: true }, rows)).toEqual({});
  });

  it('trims the name and leaves a hidden password out of the body', () => {
    expect(serializeOverride({ ...saved, ssid: ' Lobby ', hidePwd: true })).toEqual({ ...saved, ssid: 'Lobby', hidePwd: true, psk: undefined });
    expect('psk' in serializeOverride({ ...saved, hidePwd: true })).toBe(false);
  });
});
