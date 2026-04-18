import type { CheckInRow, Day, DayRow } from "./schema.js";
import { rowToCheckIn } from "./schema.js";
import { assertIsoDate, nowIso } from "../util/date.js";
import { ToolError } from "../util/errors.js";

export async function getDay(db: D1Database, date: string): Promise<Day> {
  assertIsoDate(date, "date");
  const [dayRow, ciRes] = await Promise.all([
    db
      .prepare(`SELECT * FROM days WHERE date = ?1`)
      .bind(date)
      .first<DayRow>(),
    db
      .prepare(
        `SELECT * FROM check_ins WHERE date = ?1 ORDER BY habit_id ASC`,
      )
      .bind(date)
      .all<CheckInRow>(),
  ]);
  return {
    date,
    comment: dayRow?.comment ?? "",
    checkIns: (ciRes.results ?? []).map(rowToCheckIn),
  };
}

export async function setDayComment(
  db: D1Database,
  date: string,
  comment: string,
): Promise<Day> {
  assertIsoDate(date, "date");
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO days (date, comment, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (date) DO UPDATE SET
         comment = excluded.comment,
         updated_at = excluded.updated_at`,
    )
    .bind(date, comment, now)
    .run();
  return getDay(db, date);
}

export async function deleteDayComment(
  db: D1Database,
  date: string,
): Promise<void> {
  assertIsoDate(date, "date");
  const res = await db
    .prepare(`DELETE FROM days WHERE date = ?1 RETURNING date`)
    .bind(date)
    .first<{ date: string }>();
  if (!res) throw new ToolError(`not found: day ${date}`);
}
