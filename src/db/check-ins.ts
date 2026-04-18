import type { CheckIn, CheckInRow } from "./schema.js";
import { rowToCheckIn } from "./schema.js";
import { assertIsoDate, nowIso } from "../util/date.js";
import { ToolError } from "../util/errors.js";

export interface UpsertCheckInInput {
  habitId: number;
  date: string;
  done?: boolean;
  note?: string | null;
}

export async function getCheckIn(
  db: D1Database,
  habitId: number,
  date: string,
): Promise<CheckIn | null> {
  assertIsoDate(date, "date");
  const row = await db
    .prepare(`SELECT * FROM check_ins WHERE habit_id = ?1 AND date = ?2`)
    .bind(habitId, date)
    .first<CheckInRow>();
  return row ? rowToCheckIn(row) : null;
}

export async function upsertCheckIn(
  db: D1Database,
  input: UpsertCheckInInput,
): Promise<CheckIn> {
  assertIsoDate(input.date, "date");
  const done = input.done === undefined ? true : input.done;
  const note = input.note === undefined ? null : input.note;
  const now = nowIso();

  const res = await db
    .prepare(
      `INSERT INTO check_ins (habit_id, date, done, note, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (habit_id, date) DO UPDATE SET
         done = excluded.done,
         note = excluded.note,
         updated_at = excluded.updated_at
       RETURNING *`,
    )
    .bind(input.habitId, input.date, done ? 1 : 0, note, now)
    .first<CheckInRow>();
  if (!res) {
    throw new ToolError(
      `failed to upsert check-in; habit ${input.habitId} may not exist`,
    );
  }
  return rowToCheckIn(res);
}

export async function deleteCheckIn(
  db: D1Database,
  habitId: number,
  date: string,
): Promise<void> {
  assertIsoDate(date, "date");
  const res = await db
    .prepare(
      `DELETE FROM check_ins WHERE habit_id = ?1 AND date = ?2 RETURNING habit_id`,
    )
    .bind(habitId, date)
    .first<{ habit_id: number }>();
  if (!res) {
    throw new ToolError(`not found: check-in ${habitId}@${date}`);
  }
}
