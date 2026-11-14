import { describe, expect, it } from 'vitest';
import type { Ssid } from './wlan';
import {
  ENC,
  PMF,
  SEC,
  WPA,
  applyChange,
  formFromSsid,
  mloBlocker,
  pmfRule,
  serializeSsid,
  validateSsidForm,
  wpaOptions,
  type SsidFormContext,
} from './ssidForm';

const W = '6af42f0f8db02539a489b574';
const RL = '6af42f488db02539a489b585';
const add: SsidFormContext = { mode: 'add', wlanId: W, defaultRateLimitId: RL };

// What the legacy editor sends for "name + password, everything else default"
// on a site without 6 GHz APs — derived from the vendor serializers and
// accepted by controller 5.15.6.7 (stored row below).
const LEGACY_ADD = {
  name: 'Office',
  band: 3,
  guestNetEnable: false,
  security: 3,
  broadcast: true,
  vlanSetting: { mode: 0 },
  pskSetting: { securityKey: 'testpass123', encryptionPsk: 3, versionPsk: 2, gikRekeyPskEnable: false },
  rateLimit: { rateLimitId: RL },
  ssidRateLimit: { rateLimitId: RL },
  wlanScheduleEnable: false,
  rateAndBeaconCtrl: { rate2gCtrlEnable: false, rate5gCtrlEnable: false, rate6gCtrlEnable: false },
  macFilterEnable: false,
  wlanId: W,
  enable11r: false,
  pmfMode: 3,
  multiCastSetting: { multiCastEnable: true, arpCastEnable: true, filterEnable: false, ipv6CastEnable: true, channelUtil: 100 },
  deviceType: 1,
  mloEnable: false,
};

// The row the controller returned for LEGACY_ADD.
const STORED_ROW = {
  id: '6af783754e8870128d895c4f',
  idInt: 1908094680,
  index: 1,
  name: 'Office',
  site: '6af42f0d8db02539a489b55d',
  wlanId: W,
  band: 3,
  guestNetEnable: false,
  security: 3,
  broadcast: true,
  vlanEnable: false,
  portalEnable: false,
  accessEnable: false,
  rateLimit: { rateLimitId: RL, downLimitEnable: false, upLimitEnable: false },
  ssidRateLimit: { rateLimitId: RL, downLimitEnable: false, upLimitEnable: false },
  pskSetting: { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false, securityKey: 'testpass123' },
  wlanScheduleEnable: false,
  macFilterEnable: false,
  rateAndBeaconCtrl: { rate2gCtrlEnable: false, rate5gCtrlEnable: false, rate6gCtrlEnable: false },
  enable11r: false,
  pmfMode: 3,
  multiCastSetting: { multiCastEnable: true, channelUtil: 100, arpCastEnable: true, ipv6CastEnable: true, filterEnable: false },
  mloEnable: false,
  deviceType: 1,
  resource: 0,
  vlanSetting: { mode: 0, customConfig: {} },
} as unknown as Ssid;

const newForm = (ctx = add) => {
  const f = formFromSsid(ctx);
  f.name = 'Office';
  f.securityKey = 'testpass123';
  return f;
};

describe('serializeSsid — add', () => {
  it('matches the legacy body for the default form', () => {
    expect(serializeSsid(newForm(), add)).toEqual(LEGACY_ADD);
  });

  it('pre-ticks 6 GHz only when the site has a 6 GHz AP, and skips full bands', () => {
    expect(formFromSsid({ ...add, has6g: true }).bands).toEqual(['2g', '5g', '6g']);
    expect(formFromSsid({ ...add, bandFull: { '2g': true } }).bands).toEqual(['5g']);
  });

  it('includes gateways in deviceType only when ticked', () => {
    const f = newForm();
    f.deviceType = ['eap', 'gateway'];
    expect(serializeSsid(f, add).deviceType).toBe(3);
  });

  it('open network: no PSK block, no pmfMode, OWE flag sent', () => {
    const f = applyChange(newForm(), { security: SEC.NONE }, add);
    const body = serializeSsid(f, add) as Record<string, unknown>;
    expect(body.pskSetting).toBeUndefined();
    expect(body.wpaSetting).toBeUndefined();
    expect(body.ppskSetting).toBeUndefined();
    expect('pmfMode' in body).toBe(false);
    expect(body.oweEnable).toBe(false);
    expect(body.enable11r).toBe(false);
  });

  it('custom client limit sends the limits and no profile id', () => {
    const f = newForm();
    Object.assign(f, { clientRateLimitId: 'custom', clientDownLimitEnable: true, clientDownLimit: 5, clientDownLimitType: 1 });
    expect(serializeSsid(f, add).rateLimit).toEqual({ downLimitEnable: true, downLimit: 5, downLimitType: 1, upLimitEnable: false });
  });

  it('group key rekey, VLAN, schedule, rate control, MAC filter and multicast filter', () => {
    const f = newForm();
    Object.assign(f, {
      gikRekeyEnable: true,
      rekeyInterval: 30,
      rekeyUnit: 1,
      vlanMode: 1,
      customMode: 1,
      vlanId: 20,
      wlanScheduleEnable: true,
      scheduleAction: 0,
      scheduleId: 'sched',
      rate2gCtrlEnable: true,
      lowerDensity2g: 12,
      cckRatesDisable: true,
      macFilterEnable: true,
      policy: 1,
      macFilterId: 'grp',
      filterEnable: true,
      filterMode: ['igmp', 'nd'],
      macGroupId: 'mg',
    });
    const b = serializeSsid(f, add) as Record<string, any>;
    expect(b.pskSetting).toEqual({
      securityKey: 'testpass123',
      encryptionPsk: 3,
      versionPsk: 2,
      gikRekeyPskEnable: true,
      rekeyPskInterval: 30,
      intervalPskType: 1,
    });
    expect(b.vlanSetting).toEqual({ mode: 1, customConfig: { customMode: 1, vlanId: 20 } });
    expect([b.wlanScheduleEnable, b.action, b.scheduleId]).toEqual([true, 0, 'sched']);
    expect(b.rateAndBeaconCtrl).toEqual({
      rate2gCtrlEnable: true,
      rate5gCtrlEnable: false,
      rate6gCtrlEnable: false,
      higherDensity2g: 54,
      lowerDensity2g: 12,
      cckRatesDisable: true,
      clientRatesRequire2g: false,
      sendBeacons2g: true,
    });
    expect([b.macFilterEnable, b.policy, b.macFilterId, b.macFilterType]).toEqual([true, 1, 'grp', 1]);
    // igmp = bit index 3, nd = index 0 of a 4-char MSB-first string → "1001"
    expect(b.multiCastSetting).toEqual({
      multiCastEnable: true,
      arpCastEnable: true,
      filterEnable: true,
      ipv6CastEnable: true,
      channelUtil: 100,
      filterMode: 9,
      macGroupId: 'mg',
    });
  });

  it('LAN-network VLAN splits "id_bridge" like the vendor select', () => {
    const f = newForm();
    Object.assign(f, { vlanMode: 1, customMode: 0, lanNetworkId: 'net1_30' });
    expect(serializeSsid(f, add).vlanSetting).toEqual({ mode: 1, customConfig: { customMode: 0, lanNetworkId: 'net1', bridgeVlan: 30 } });
  });
});

describe('serializeSsid — edit', () => {
  const edit: SsidFormContext = { mode: 'edit', wlanId: W, row: STORED_ROW, defaultRateLimitId: RL };

  it('an unchanged edit re-sends the legacy body without deviceType', () => {
    const { deviceType: _ignored, ...rest } = LEGACY_ADD;
    expect(serializeSsid(formFromSsid(edit), edit)).toEqual(rest);
  });

  it('keeps a hidden password out of the body', () => {
    const row = { ...STORED_ROW, hidePwd: true, pskSetting: { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false } } as Ssid;
    const ctx = { ...edit, row };
    const b = serializeSsid(formFromSsid(ctx), ctx) as Record<string, any>;
    expect(b.hidePwd).toBe(true);
    expect(b.pskSetting.securityKey).toBeUndefined();
  });

  it('reads custom limits, multicast filter bits and VLAN back', () => {
    const row = {
      ...STORED_ROW,
      rateLimit: { downLimitEnable: true, downLimit: 2, downLimitType: 1, upLimitEnable: false },
      multiCastSetting: { multiCastEnable: false, ipv6CastEnable: false, arpCastEnable: false, filterEnable: true, filterMode: 3 },
      vlanSetting: { mode: 1, customConfig: { customMode: 1, vlanId: 7 }, currentVlanId: 7 },
    } as unknown as Ssid;
    const ctx = { ...edit, row };
    const f = formFromSsid(ctx);
    expect(f.clientRateLimitId).toBe('custom');
    expect(f.filterMode.sort()).toEqual(['igmp', 'mdns']);
    const b = serializeSsid(f, ctx) as Record<string, any>;
    expect(b.rateLimit).toEqual({ downLimitEnable: true, downLimit: 2, downLimitType: 1, upLimitEnable: false });
    expect(b.multiCastSetting).toEqual({ multiCastEnable: false, arpCastEnable: false, filterEnable: true, ipv6CastEnable: false, filterMode: 3 });
    expect(b.vlanSetting).toEqual({ mode: 1, customConfig: { customMode: 1, vlanId: 7 } });
  });
});

describe('WPA / PMF / 802.11r / MLO rules', () => {
  it('versionPsk 4 on 2.4/5 GHz is WPA2-PSK/WPA3-SAE with PMF capable', () => {
    const opts = wpaOptions(['2g', '5g'], SEC.PERSONAL, false);
    expect(opts.find((o) => o.version === WPA.WPA3)?.label).toBe('WPA2-PSK/WPA3-SAE');
    const f = applyChange(newForm(), { wpaVersion: WPA.WPA3, wpaEncryption: ENC.AES }, add);
    expect(f.pmfMode).toBe(PMF.CAPABLE);
    expect(pmfRule(WPA.WPA3, ['2g', '5g']).allowed).toEqual([PMF.MANDATORY, PMF.CAPABLE]);
    expect(serializeSsid(f, add).enable11r).toBe(false);
  });

  it('6 GHz only forces WPA3-SAE and mandatory PMF', () => {
    const f = applyChange(newForm(), { bands: ['6g'] }, add);
    expect([f.wpaVersion, f.wpaEncryption, f.pmfMode]).toEqual([WPA.WPA3, ENC.AES, PMF.MANDATORY]);
    expect(wpaOptions(['6g'], SEC.PERSONAL, false)[0].label).toBe('WPA3-SAE');
  });

  it('6 GHz only enterprise defaults to AES-GCM 256', () => {
    const f = applyChange(newForm(), { bands: ['6g'], security: SEC.ENTERPRISE }, add);
    expect([f.wpaVersion, f.wpaEncryption]).toEqual([WPA.WPA3, ENC.AES_GCM_256]);
  });

  it('PPSK is not offered with 6 GHz and falls back to WPA-Personal', () => {
    let f = applyChange(newForm(), { security: SEC.PPSK }, add);
    f = applyChange(f, { bands: ['2g', '6g'] }, add);
    expect(f.security).toBe(SEC.PERSONAL);
  });

  it('WPA-PSK (v1) only allows PMF disabled and hides 802.11r', () => {
    let f = applyChange(newForm(), { pmfMode: PMF.CAPABLE }, add);
    f = applyChange(f, { wpaVersion: WPA.WPA, wpaEncryption: ENC.AUTO, enable11r: true }, add);
    expect(f.pmfMode).toBe(PMF.DISABLED);
    expect(serializeSsid(f, add).enable11r).toBe(false);
  });

  it('switching back from WPA3 resets PMF to the band default', () => {
    let f = applyChange(newForm(), { wpaVersion: WPA.WPA3, wpaEncryption: ENC.AES }, add);
    f = applyChange(f, { pmfMode: PMF.MANDATORY }, add);
    f = applyChange(f, { wpaVersion: WPA.WPA2, wpaEncryption: ENC.AES }, add);
    expect(f.pmfMode).toBe(PMF.DISABLED);
  });

  it('MLO needs WPA3, two bands and security; enabling it clears 802.11r', () => {
    const base = newForm();
    expect(mloBlocker(base, add)).toMatch(/WPA3/);
    let f = applyChange(base, { wpaVersion: WPA.WPA3, wpaEncryption: ENC.AES, enable11r: true }, add);
    f = applyChange(f, { mloEnable: true }, add);
    expect([f.mloEnable, f.enable11r]).toEqual([true, false]);
    f = applyChange(f, { bands: ['5g'] }, add);
    expect(f.mloEnable).toBe(false);
  });
});

describe('validateSsidForm', () => {
  it('accepts the default form with a name and password', () => {
    expect(validateSsidForm(newForm(), add)).toEqual({});
  });
  it('flags the vendor form rules', () => {
    const f = formFromSsid(add);
    Object.assign(f, { name: 'x'.repeat(33), securityKey: 'short', gikRekeyEnable: true, rekeyInterval: 10, vlanMode: 1, customMode: 1, vlanId: 5000 });
    expect(Object.keys(validateSsidForm(f, add)).sort()).toEqual(['name', 'rekeyInterval', 'securityKey', 'vlanId']);
  });
});
