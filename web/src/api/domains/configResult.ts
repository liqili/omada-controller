import { api, scoped, unwrap } from '../client';

// Configuration results ("Devices → Configuration Results" in the vendor UI),
// read from its Vue chunk (index-BRDpk7sC.js) and endpoint registry, v5.15.6.7:
//   GET  sites/{sid}/config-result/devices
//          ?currentPage&currentPageSize&status[&filters.deviceType][&name][&mac]
//        → {currentPage, currentSize, totalRows, statistic, onlyNotificationData, data:[device]}
//   GET  sites/{sid}/config-result/device/{mac}/feature?status&deviceType
//        → {deviceFunctionList:[feature]}
//   GET  sites/{sid}/config-result/devices/{mac}/feature/grid
//          ?currentPage&currentPageSize&feature&status
//        → grid of the feature's components (expandable features only)
//   POST sites/{sid}/devices/{mac}/config/fullSync — "Apply Again"
//        (offered when the row has needFullSync && supportConfigSync)
// The vendor page only loads in site view, not in Lite mode.

/** The vendor `status` values. The user's controller asks for 3 to list incompatible provisioning. */
export const CONFIG_STATUS = { FAIL: 2, ALERT: 3, CONFIGURING: 4, PRECONFIG: 5 } as const;
export type ConfigStatus = (typeof CONFIG_STATUS)[keyof typeof CONFIG_STATUS];

/** `filters.deviceType` values; "All" sends nothing. */
export const CONFIG_DEVICE_TYPES = { all: undefined, gatewaySwitch: '1,2', ap: '3' } as const;
export type ConfigDeviceType = keyof typeof CONFIG_DEVICE_TYPES;

export interface ConfigResultStatistic {
  all?: number;
  osgAndOsw?: number;
  ap?: number;
  fail?: number;
  alert?: number;
  configuring?: number;
  preConfig?: number;
}

export interface ConfigResultDevice {
  mac: string;
  name?: string;
  type?: string;
  model?: string;
  modelVersion?: string;
  stackId?: string;
  stackName?: string;
  masterMac?: string;
  needFullSync?: boolean;
  supportConfigSync?: boolean;
  supportRunningConfig?: boolean;
}

export interface ConfigResultQuery {
  status: ConfigStatus;
  deviceType?: ConfigDeviceType;
  name?: string;
  mac?: string;
  page?: number;
  pageSize?: number;
}

export interface ConfigResultPage {
  rows: ConfigResultDevice[];
  total: number;
  statistic: ConfigResultStatistic;
  onlyNotificationData: boolean;
}

export async function listConfigResultDevices(siteId: string, q: ConfigResultQuery): Promise<ConfigResultPage> {
  const params: Record<string, unknown> = {
    currentPage: q.page ?? 1,
    // The controller reads currentPageSize, as everywhere else.
    currentPageSize: q.pageSize ?? 10,
    status: q.status,
  };
  const type = q.deviceType ? CONFIG_DEVICE_TYPES[q.deviceType] : undefined;
  if (type) params['filters.deviceType'] = type;
  if (q.name) params.name = q.name;
  if (q.mac) params.mac = q.mac;
  const r = await unwrap<{
    data?: ConfigResultDevice[];
    totalRows?: number;
    statistic?: ConfigResultStatistic;
    onlyNotificationData?: boolean;
  }>(api.get(scoped(`/api/v2/sites/${siteId}/config-result/devices`), { params }));
  return {
    rows: r?.data ?? [],
    total: r?.totalRows ?? 0,
    statistic: r?.statistic ?? {},
    onlyNotificationData: Boolean(r?.onlyNotificationData),
  };
}

/** One feature row of a device's UI configuration result. */
export interface ConfigFeature {
  feature: string;
  /** Vendor i18n key(s), joined by "+". */
  languageKey?: string;
  /** Where the setting lives in the vendor UI, e.g. "WLAN;DEVICES-AP_SETTINGS". */
  uiPosition?: string;
  expandable?: boolean;
  featureItemSum?: number;
  operationList?: number[] | number;
  timeList?: number[] | number;
  uiErrorCodeList?: (string | number)[] | string | number;
  uiErrorMsgList?: string[] | string;
  unsupportCaps?: string[];
  errCode?: number;
  entryLimit?: number;
  subEntryLimit?: number;
  component?: string;
}

export async function getConfigFeatures(
  siteId: string,
  mac: string,
  q: { status: ConfigStatus; deviceType?: string },
): Promise<ConfigFeature[]> {
  const r = await unwrap<{ deviceFunctionList?: ConfigFeature[] }>(
    api.get(scoped(`/api/v2/sites/${siteId}/config-result/device/${mac}/feature`), {
      params: { status: q.status, deviceType: q.deviceType },
    }),
  );
  return r?.deviceFunctionList ?? [];
}

/** One component (item) inside an expandable feature. */
export interface ConfigComponent {
  component?: string;
  name?: string;
  operation?: number;
  time?: number;
  uiErrorCode?: string | number;
  uiErrorMsg?: string | string[];
  notSupportInfo?: string;
  errCode?: number;
  entryLimit?: number;
  subEntryLimit?: number;
}

export async function listConfigComponents(
  siteId: string,
  mac: string,
  q: { feature: string; status: ConfigStatus; page?: number; pageSize?: number },
): Promise<{ rows: ConfigComponent[]; total: number }> {
  const r = await unwrap<{ data?: ConfigComponent[]; totalRows?: number }>(
    api.get(scoped(`/api/v2/sites/${siteId}/config-result/devices/${mac}/feature/grid`), {
      params: { currentPage: q.page ?? 1, currentPageSize: q.pageSize ?? 10, feature: q.feature, status: q.status },
    }),
  );
  return { rows: r?.data ?? [], total: r?.totalRows ?? 0 };
}

/** "Apply Again": the controller regenerates the device's full configuration and sends it. */
export async function reapplyDeviceConfig(siteId: string, mac: string): Promise<void> {
  await unwrap(api.post(scoped(`/api/v2/sites/${siteId}/devices/${mac}/config/fullSync`)));
}
