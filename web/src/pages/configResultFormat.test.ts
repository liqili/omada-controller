import { describe, expect, it } from 'vitest';
import { CONFIG_STATUS } from '../api/domains/configResult';
import {
  capabilityText,
  configDeviceName,
  configSearch,
  failReason,
  featureColumns,
  featureLocation,
  featureName,
  humanizeKey,
  operationText,
  timeText,
} from './configResultFormat';

describe('configuration result text', () => {
  it('turns vendor i18n keys into words', () => {
    expect(humanizeKey('MENU.WIFI_NETWORKS')).toBe('Wifi networks');
    expect(humanizeKey('SWITCH_SETTINGS.VLAN_INTERFACE')).toBe('VLAN interface');
    expect(featureName({ feature: 'x', languageKey: 'MENU.WLAN+SITE.LED_SCHEDULE' })).toBe('WLAN - LED schedule');
    expect(featureName({ feature: 'ap_raw' })).toBe('ap_raw');
    expect(featureLocation('WIRED_NETWORKS-LAN;WLAN')).toBe('Wired networks > LAN, WLAN');
  });

  it('names actions and times', () => {
    expect(operationText([1, 3])).toBe('Add, Edit');
    expect(operationText(undefined)).toBe('—');
    expect(timeText(undefined)).toBe('—');
    expect(timeText([1000, 1000])).toBe(new Date(1000).toLocaleString());
    expect(timeText([2000, 1000])).toBe(`${new Date(1000).toLocaleString()} – ${new Date(2000).toLocaleString()}`);
  });

  it('explains failures: controller messages first, then known codes, then the code itself', () => {
    expect(failReason(['osw_-6'], ['Timed out talking to switch'], CONFIG_STATUS.FAIL)).toBe('Timed out talking to switch');
    expect(failReason(['osw_-6', 'ap_-7'], undefined, CONFIG_STATUS.FAIL)).toBe(
      'Device response timed out., The device does not support this feature.',
    );
    expect(failReason('ap_4097', undefined, CONFIG_STATUS.FAIL)).toBe('Device failed to apply configurations (code ap_4097).');
    expect(failReason(['osw_-6'], undefined, CONFIG_STATUS.CONFIGURING)).toBe('—');
  });

  it('describes incompatible settings', () => {
    expect(capabilityText({ unsupportCaps: ['LED schedule'] })).toBe('The device does not support LED schedule.');
    expect(capabilityText({ component: 'ap_ssid_5G', subEntryLimit: 16 })).toBe('The device supports up to 16 PPSKs.');
    expect(capabilityText({ component: 'ap_macFilterList', entryLimit: 4, subEntryLimit: 32 })).toBe(
      'MAC Group supports 4 profiles. Each profile supports 32 items.',
    );
    expect(capabilityText({ errCode: -7 })).toBe('The device does not support this feature.');
    expect(capabilityText({ notSupportInfo: 'from controller' })).toBe('from controller');
    expect(capabilityText({})).toBe('—');
  });

  it('shows the vendor columns per status', () => {
    expect(featureColumns(CONFIG_STATUS.ALERT)).toEqual({ operation: false, time: false, capability: true, reason: false });
    expect(featureColumns(CONFIG_STATUS.FAIL)).toEqual({ operation: true, time: true, capability: false, reason: true });
  });

  it('labels stack masters and sorts a search into name or MAC', () => {
    expect(configDeviceName({ mac: 'M1', name: 'S1', stackId: 'k', masterMac: 'M1', stackName: 'Core' })).toBe('S1 [Core]');
    expect(configDeviceName({ mac: 'M2' })).toBe('M2');
    expect(configSearch('aa:bb:cc')).toEqual({ mac: 'AA-BB-CC' });
    expect(configSearch(' Garden ')).toEqual({ name: 'Garden' });
    expect(configSearch('')).toEqual({});
  });
});
