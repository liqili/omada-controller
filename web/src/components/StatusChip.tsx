import { Chip } from '@mui/material';

// Omada device status — taken from the vendor UI bundle (access_points/
// device_index): `statusCategory` is the coarse state and `status` the detail.
//   statusCategory 0 disconnected · 1 connected · 2 pending · 3 heartbeat missed · 4 isolated
//   status  0 DISCONNECTED        1 DISCONNECTED_MIGRATING
//          10 PROVISIONING       11 CONFIGURING   12 UPGRADING   13 REBOOTING
//          14 CONNECTED          15 CONNECTED_WIRELESS (16/17 = migrating variants)
//          20 PENDING            21 PENDING_WIRELESS
//          22 ADOPTING           23 ADOPTING_WIRELESS
//          24 ADOPT_FAILED       25 ADOPT_FAILED_WIRELESS
//          26 MANAGED_BY_OTHERS  27 MANAGED_BY_OTHERS_WIRELESS
//          30+ heartbeat missed  40+ isolated

type Color = 'success' | 'warning' | 'error' | 'info' | 'default';

export interface DeviceStatusInfo {
  label: string;
  color: Color;
  /** A short-lived state (adopting, provisioning, …) — worth polling quickly. */
  transient: boolean;
}

const DETAIL: Record<number, DeviceStatusInfo> = {
  0: { label: 'Disconnected', color: 'error', transient: false },
  1: { label: 'Disconnected', color: 'error', transient: false },
  10: { label: 'Provisioning', color: 'info', transient: true },
  11: { label: 'Configuring', color: 'info', transient: true },
  12: { label: 'Upgrading', color: 'info', transient: true },
  13: { label: 'Rebooting', color: 'warning', transient: true },
  14: { label: 'Connected', color: 'success', transient: false },
  15: { label: 'Connected (wireless)', color: 'success', transient: false },
  16: { label: 'Connected', color: 'success', transient: false },
  17: { label: 'Connected (wireless)', color: 'success', transient: false },
  20: { label: 'Pending', color: 'default', transient: false },
  21: { label: 'Pending (wireless)', color: 'default', transient: false },
  22: { label: 'Adopting', color: 'info', transient: true },
  23: { label: 'Adopting (wireless)', color: 'info', transient: true },
  24: { label: 'Adoption failed', color: 'error', transient: false },
  25: { label: 'Adoption failed', color: 'error', transient: false },
  26: { label: 'Managed by others', color: 'warning', transient: false },
  27: { label: 'Managed by others', color: 'warning', transient: false },
};

const CATEGORY: Record<number, DeviceStatusInfo> = {
  0: { label: 'Disconnected', color: 'error', transient: false },
  1: { label: 'Connected', color: 'success', transient: false },
  2: { label: 'Pending', color: 'default', transient: false },
  3: { label: 'Heartbeat missed', color: 'warning', transient: false },
  4: { label: 'Isolated', color: 'warning', transient: false },
};

export function deviceStatus(status?: number, statusCategory?: number): DeviceStatusInfo {
  if (status !== undefined && DETAIL[status]) return DETAIL[status];
  if (status !== undefined && status >= 30 && status < 40) return CATEGORY[3];
  if (status !== undefined && status >= 40 && status < 50) return CATEGORY[4];
  if (statusCategory !== undefined && CATEGORY[statusCategory]) return CATEGORY[statusCategory];
  return { label: status === undefined ? 'Unknown' : `Status ${status}`, color: 'default', transient: false };
}

/**
 * Whether a device takes commands (locate, reboot, force provision): up and not
 * mid-transition (rebooting / provisioning / configuring count as "connected" upstream).
 */
export function deviceCommandable(d: { status: number; statusCategory?: number }): boolean {
  return !deviceStatus(d.status, d.statusCategory).transient && (d.statusCategory === 1 || (d.status >= 14 && d.status <= 17));
}

export function DeviceStatusChip({ status, statusCategory }: { status?: number; statusCategory?: number }) {
  const s = deviceStatus(status, statusCategory);
  return <Chip label={s.label} color={s.color} size="small" variant="outlined" />;
}
