import { addDaysIso } from "./date.js";
import type {
  ByHabitDate,
  CheckInLite,
  Streaks,
  UiDay,
  UiHabit,
} from "./types.js";

export function buildByHabitDate(days: UiDay[]): ByHabitDate {
  const out: ByHabitDate = new Map();
  for (const d of days) {
    for (const c of d.checkIns) {
      let inner = out.get(c.habitId);
      if (!inner) {
        inner = new Map();
        out.set(c.habitId, inner);
      }
      inner.set(d.date, { done: c.done, note: c.note });
    }
  }
  return out;
}

// Clamp a habit's active window to the slice of the timeline for which the
// server actually sent us data. `[viewStart, viewEnd]` is `[data.from,
// min(data.to, realToday)]` — outside that range we have no check_ins, so
// treating it as "missed" would silently inflate totals and drop rates.
export function habitWindow(
  habit: UiHabit,
  viewStart: string,
  viewEnd: string,
): { start: string; end: string } | null {
  const start = habit.startDate > viewStart ? habit.startDate : viewStart;
  const end =
    habit.endDate && habit.endDate < viewEnd ? habit.endDate : viewEnd;
  if (start > end) return null;
  return { start, end };
}

export function computeStreaks(
  habit: UiHabit,
  byHabitDate: ByHabitDate,
  viewStart: string,
  viewEnd: string,
): Streaks {
  const win = habitWindow(habit, viewStart, viewEnd);
  if (!win) return { current: 0, longest: 0, total: 0, done: 0, rate: 0 };
  const ci = byHabitDate.get(habit.id) ?? new Map<string, CheckInLite>();
  let total = 0;
  let done = 0;
  let longest = 0;
  let run = 0;
  for (let d = win.start; d <= win.end; d = addDaysIso(d, 1)) {
    total++;
    const c = ci.get(d);
    if (c && c.done) {
      done++;
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  let current = 0;
  for (let d = win.end; d >= win.start; d = addDaysIso(d, -1)) {
    const c = ci.get(d);
    if (c && c.done) current++;
    else break;
  }
  return { current, longest, total, done, rate: total ? done / total : 0 };
}
