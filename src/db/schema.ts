export interface HabitRow {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckInRow {
  habit_id: number;
  date: string;
  done: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DayRow {
  date: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface Habit {
  id: number;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckIn {
  habitId: number;
  date: string;
  done: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Day {
  date: string;
  comment: string;
  checkIns: CheckIn[];
}

export const rowToHabit = (row: HabitRow): Habit => ({
  id: row.id,
  name: row.name,
  description: row.description,
  startDate: row.start_date,
  endDate: row.end_date,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const rowToCheckIn = (row: CheckInRow): CheckIn => ({
  habitId: row.habit_id,
  date: row.date,
  done: row.done === 1,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
