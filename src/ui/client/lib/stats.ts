import { ONE_DAY, addDaysIso, parseIso, toIso } from "./date.js";
import { habitWindow } from "./habits.js";
import type {
  ByHabitDate,
  CheckInLite,
  DowEntry,
  HeatCell,
  UiHabit,
  WeekRate,
} from "./types.js";

export function computeWeeklyRates(
  habit: UiHabit,
  byHabitDate: ByHabitDate,
  viewStart: string,
  viewEnd: string,
  nWeeks: number,
): WeekRate[] {
  const win = habitWindow(habit, viewStart, viewEnd);
  const ci = byHabitDate.get(habit.id) ?? new Map<string, CheckInLite>();
  const end = parseIso(viewEnd);
  const endDow = end.getUTCDay();
  const lastWeekEnd = toIso(new Date(end.getTime() + (6 - endDow) * ONE_DAY));
  const out: WeekRate[] = [];
  for (let w = 0; w < nWeeks; w++) {
    const wkEnd = addDaysIso(lastWeekEnd, -w * 7);
    const wkStart = addDaysIso(wkEnd, -6);
    let done = 0;
    let total = 0;
    if (win) {
      for (let i = 0; i < 7; i++) {
        const d = addDaysIso(wkStart, i);
        if (d < win.start || d > win.end) continue;
        total++;
        const c = ci.get(d);
        if (c && c.done) done++;
      }
    }
    out.push({
      weekStart: wkStart,
      weekEnd: wkEnd,
      done,
      total,
      rate: total ? done / total : null,
    });
  }
  return out.reverse();
}

export function computeDowProfile(
  habit: UiHabit,
  byHabitDate: ByHabitDate,
  viewStart: string,
  viewEnd: string,
): DowEntry[] {
  const buckets = Array.from({ length: 7 }, () => ({ done: 0, total: 0 }));
  const win = habitWindow(habit, viewStart, viewEnd);
  if (!win) {
    return buckets.map((_, i) => ({ dow: i, rate: 0, done: 0, total: 0 }));
  }
  const ci = byHabitDate.get(habit.id) ?? new Map<string, CheckInLite>();
  for (let d = win.start; d <= win.end; d = addDaysIso(d, 1)) {
    const dow = parseIso(d).getUTCDay();
    const b = buckets[dow]!;
    b.total++;
    const c = ci.get(d);
    if (c && c.done) b.done++;
  }
  return buckets.map((b, i) => ({
    dow: i,
    rate: b.total ? b.done / b.total : 0,
    done: b.done,
    total: b.total,
  }));
}

export function computeHeatCells(
  habits: UiHabit[],
  byHabitDate: ByHabitDate,
  commentSet: Set<string>,
  gridStart: string,
  viewStart: string,
  viewEnd: string,
): HeatCell[][] {
  const cols: HeatCell[][] = [];
  for (let w = 0; w < 53; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDaysIso(gridStart, w * 7 + d);
      const noData = date < viewStart || date > viewEnd;
      let doneCount = 0;
      let activeHabits = 0;
      if (!noData) {
        for (const h of habits) {
          if (date < h.startDate) continue;
          if (h.endDate && date > h.endDate) continue;
          activeHabits++;
          const c = byHabitDate.get(h.id)?.get(date);
          if (c && c.done) doneCount++;
        }
      }
      col.push({
        date,
        doneCount,
        activeHabits,
        noData,
        hasComment: !noData && commentSet.has(date),
      });
    }
    cols.push(col);
  }
  return cols;
}
