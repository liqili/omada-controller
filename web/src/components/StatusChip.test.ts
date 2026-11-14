import { describe, expect, it } from 'vitest';
import { deviceStatus } from './StatusChip';

// Codes from the vendor UI bundle; the simulator (sim/omada-sim.mjs) walks a
// device through exactly these.
describe('deviceStatus', () => {
  it('labels the adoption path', () => {
    expect(deviceStatus(20, 2).label).toBe('Pending');
    expect(deviceStatus(22, 2)).toMatchObject({ label: 'Adopting', transient: true });
    expect(deviceStatus(10, 1)).toMatchObject({ label: 'Provisioning', transient: true });
    expect(deviceStatus(14, 1)).toMatchObject({ label: 'Connected', color: 'success', transient: false });
  });

  it('marks a failed adoption as an error that is not in progress', () => {
    expect(deviceStatus(24, 2)).toMatchObject({ label: 'Adoption failed', color: 'error', transient: false });
  });

  it('treats configuring and rebooting as in progress', () => {
    expect(deviceStatus(11, 1).transient).toBe(true);
    expect(deviceStatus(13, 1).transient).toBe(true);
  });

  it('falls back to the category for codes it does not know', () => {
    expect(deviceStatus(33).label).toBe('Heartbeat missed');
    expect(deviceStatus(41).label).toBe('Isolated');
    expect(deviceStatus(19, 1).label).toBe('Connected');
    expect(deviceStatus(undefined).label).toBe('Unknown');
  });
});
