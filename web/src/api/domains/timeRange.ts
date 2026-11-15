import { api, scoped, unwrap } from '../client';

// Site time ranges (vendor Profiles → Time Range, and the "create time range
// entry" shortcut in its SSID editor; modules time-range + time-form):
//   GET    sites/{sid}/setting/profiles/timeranges        → {data:[…]}
//   POST   sites/{sid}/setting/profiles/timeranges        body below → {profileId}
//   PATCH  …/timeranges/{id}   DELETE …/timeranges/{id}
// Body: {name, dayMode, timeList:[{dayType, startTimeH, startTimeM, endTimeH,
// endTimeM}], dayMon…daySun}. dayType is 0 every day, -1 weekdays, -2 weekend,
// 1–7 Monday–Sunday in custom mode. The vendor form allows up to 7 slots in
// all, in 15-minute steps from 00:00 to 24:00, none overlapping or touching.

export const DAY_MODE = { EVERYDAY: 0, WEEKDAY: 1, WEEKEND: 2, CUSTOM: 3 } as const;
export const DAY_KEYS = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'] as const;
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MAX_SLOTS = 7;
export const STEP_MINUTES = 15;

/** dayType of the slots in the non-custom modes. */
const MODE_DAY_TYPE = [0, -1, -2];

/** Minutes from midnight, end may be 1440 (24:00). */
export interface Slot {
  start: number;
  end: number;
}

export interface TimeRangeForm {
  name: string;
  dayMode: number;
  /** Slots for every day / weekdays / weekend. */
  slots: Slot[];
  /** Custom mode: slots per day, Monday first; a day with none is off. */
  days: Slot[][];
}

export const DEFAULT_SLOT: Slot = { start: 8 * 60, end: 18 * 60 };

export function emptyTimeRangeForm(): TimeRangeForm {
  return { name: '', dayMode: DAY_MODE.EVERYDAY, slots: [{ ...DEFAULT_SLOT }], days: DAY_NAMES.map(() => [{ ...DEFAULT_SLOT }]) };
}

export const slotCount = (f: TimeRangeForm) => (f.dayMode === DAY_MODE.CUSTOM ? f.days.flat().length : f.slots.length);

/** Indexes of slots that overlap (or touch) an earlier one, as the vendor checks. */
export function overlapping(slots: Slot[]): Set<number> {
  const bad = new Set<number>();
  slots.forEach((s, i) => {
    for (let j = 0; j < i; j++) {
      const o = slots[j];
      if (!((s.start < o.start && s.end < o.start) || (s.start > o.end && s.end > o.end))) {
        bad.add(i);
        break;
      }
    }
  });
  return bad;
}

export function timeRangeProblem(f: TimeRangeForm): string | null {
  if (!f.name.trim()) return 'Enter a name.';
  if (f.name.trim().length > 64) return 'Use up to 64 characters for the name.';
  const groups = f.dayMode === DAY_MODE.CUSTOM ? f.days : [f.slots];
  if (!groups.some((g) => g.length)) return 'Choose at least one day.';
  if (slotCount(f) > MAX_SLOTS) return `Use at most ${MAX_SLOTS} time slots in all.`;
  if (groups.some((g) => g.some((s) => s.end <= s.start))) return 'Each slot must end after it starts.';
  if (groups.some((g) => overlapping(g).size)) return 'Time slots on the same day must not overlap.';
  return null;
}

const entry = (dayType: number, s: Slot) => ({
  dayType,
  startTimeH: Math.floor(s.start / 60),
  startTimeM: s.start % 60,
  endTimeH: Math.floor(s.end / 60),
  endTimeM: s.end % 60,
});

/** The body the vendor form sends. */
export function timeRangeBody(f: TimeRangeForm): Record<string, unknown> {
  const custom = f.dayMode === DAY_MODE.CUSTOM;
  const timeList = custom
    ? f.days.flatMap((slots, d) => slots.map((s) => entry(d + 1, s)))
    : f.slots.map((s) => entry(MODE_DAY_TYPE[f.dayMode], s));
  const on = (d: number) =>
    custom ? f.days[d].length > 0 : f.dayMode === DAY_MODE.WEEKDAY ? d < 5 : f.dayMode === DAY_MODE.WEEKEND ? d >= 5 : true;
  return {
    name: f.name.trim(),
    dayMode: f.dayMode,
    timeList,
    ...Object.fromEntries(DAY_KEYS.map((k, d) => [k, on(d)])),
  };
}

const path = (siteId: string) => scoped(`/api/v2/sites/${siteId}/setting/profiles/timeranges`);

/** Creates the range and returns its id (looked up by name if the controller doesn't return it). */
export async function createTimeRange(siteId: string, f: TimeRangeForm): Promise<string | undefined> {
  const body = timeRangeBody(f);
  // v5.15 answers {profileId} (checked live 2026-11-16).
  const r = await unwrap<{ profileId?: string; id?: string } | null>(api.post(path(siteId), body));
  const id = r?.profileId ?? r?.id;
  if (id) return id;
  const list = await unwrap<{ data?: { id: string; name: string }[] }>(api.get(path(siteId)));
  return list?.data?.find((t) => t.name === body.name)?.id;
}

export const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
