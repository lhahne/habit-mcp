export interface UiHabit {
  id: number;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
}

export interface UiCheckIn {
  habitId: number;
  done: boolean;
  note: string | null;
}

export interface UiDay {
  date: string;
  comment: string;
  checkIns: UiCheckIn[];
}

export interface UiData {
  habits: UiHabit[];
  days: UiDay[];
  from: string;
  to: string;
}

export type CheckInLite = { done: boolean; note: string | null };
export type ByHabitDate = Map<number, Map<string, CheckInLite>>;

export interface Streaks {
  current: number;
  longest: number;
  total: number;
  done: number;
  rate: number;
}

export interface WeekRate {
  weekStart: string;
  weekEnd: string;
  done: number;
  total: number;
  rate: number | null;
}

export interface DowEntry {
  dow: number;
  rate: number;
  done: number;
  total: number;
}

export interface HeatCell {
  date: string;
  doneCount: number;
  activeHabits: number;
  // True when we have no check-in data for this cell — either past the
  // view window (`data.to` or real today, whichever is earlier) or before
  // `data.from`. Visually rendered the same as "future".
  noData: boolean;
  hasComment: boolean;
}

export interface Totals {
  done: number;
  total: number;
}

export interface HabitPanel {
  habit: UiHabit;
  streaks: Streaks;
  weekly: WeekRate[];
  dow: DowEntry[];
}

export interface JournalGroup {
  key: string;
  label: string;
  days: UiDay[];
  done: number;
  total: number;
}
