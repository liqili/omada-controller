import { describe, expect, it } from 'vitest';
import { DAY_MODE, emptyTimeRangeForm, overlapping, timeRangeBody, timeRangeProblem, type TimeRangeForm } from './timeRange';

const form = (p: Partial<TimeRangeForm>): TimeRangeForm => ({ ...emptyTimeRangeForm(), name: 'Office hours', ...p });
const days = (on: boolean[]) => Object.fromEntries(['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'].map((k, i) => [k, on[i]]));

describe('time range body (vendor time-form)', () => {
  it('weekdays: one dayType -1 entry per slot, Mon–Fri on', () => {
    expect(timeRangeBody(form({ dayMode: DAY_MODE.WEEKDAY, slots: [{ start: 510, end: 1440 }] }))).toEqual({
      name: 'Office hours',
      dayMode: 1,
      timeList: [{ dayType: -1, startTimeH: 8, startTimeM: 30, endTimeH: 24, endTimeM: 0 }],
      ...days([true, true, true, true, true, false, false]),
    });
  });

  it('every day and weekend use dayType 0 and -2', () => {
    expect(timeRangeBody(form({})).timeList).toEqual([{ dayType: 0, startTimeH: 8, startTimeM: 0, endTimeH: 18, endTimeM: 0 }]);
    const weekend = timeRangeBody(form({ dayMode: DAY_MODE.WEEKEND }));
    expect(weekend).toMatchObject({ ...days([false, false, false, false, false, true, true]) });
    expect((weekend.timeList as { dayType: number }[])[0].dayType).toBe(-2);
  });

  it('custom: dayType 1–7 per chosen day, days without slots off', () => {
    const d = emptyTimeRangeForm().days.map(() => [] as { start: number; end: number }[]);
    d[0] = [{ start: 60, end: 120 }];
    d[6] = [{ start: 0, end: 15 }];
    const body = timeRangeBody(form({ dayMode: DAY_MODE.CUSTOM, days: d }));
    expect(body.timeList).toEqual([
      { dayType: 1, startTimeH: 1, startTimeM: 0, endTimeH: 2, endTimeM: 0 },
      { dayType: 7, startTimeH: 0, startTimeM: 0, endTimeH: 0, endTimeM: 15 },
    ]);
    expect(body).toMatchObject(days([true, false, false, false, false, false, true]));
  });
});

describe('time range rules', () => {
  it('flags slots that overlap or touch an earlier one', () => {
    expect([...overlapping([{ start: 60, end: 120 }, { start: 120, end: 180 }, { start: 200, end: 300 }])]).toEqual([1]);
  });

  it('needs a name, a day, ≤7 slots, and each slot ending after it starts', () => {
    expect(timeRangeProblem(form({}))).toBeNull();
    expect(timeRangeProblem(form({ name: ' ' }))).toMatch(/name/);
    expect(timeRangeProblem(form({ slots: [{ start: 600, end: 600 }] }))).toMatch(/end after/);
    expect(timeRangeProblem(form({ dayMode: DAY_MODE.CUSTOM, days: Array.from({ length: 7 }, () => []) }))).toMatch(/day/);
    const eight = Array.from({ length: 8 }, (_, i) => ({ start: i * 120, end: i * 120 + 60 }));
    expect(timeRangeProblem(form({ slots: eight }))).toMatch(/at most 7/);
  });
});
