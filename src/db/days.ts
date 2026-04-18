import type { CheckInRow, Day, DayRow } from "./schema.js";
import { rowToCheckIn } from "./schema.js";
import { assertIsoDate, nowIso } from "../util/date.js";
import { ToolError } from "../util/errors.js";

export interface ListDaysOptions {
  from: string;
  to: string;
}

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

export async function listDays(
  db: D1Database,
  opts: ListDaysOptions,
): Promise<Day[]> {
  assertIsoDate(opts.from, "from");
  assertIsoDate(opts.to, "to");
  if (opts.from > opts.to) {
    throw new ToolError(
      `invalid date range: from (${opts.from}) must be <= to (${opts.to})`,
    );
  }

  const [daysRes, ciRes] = await Promise.all([
    db
      .prepare(`SELECT * FROM days WHERE date >= ?1 AND date <= ?2`)
      .bind(opts.from, opts.to)
      .all<DayRow>(),
    db
      .prepare(
        `SELECT * FROM check_ins
         WHERE date >= ?1 AND date <= ?2
         ORDER BY date ASC, habit_id ASC`,
      )
      .bind(opts.from, opts.to)
      .all<CheckInRow>(),
  ]);

  const byDate = new Map<string, Day>();
  for (const row of daysRes.results ?? []) {
    byDate.set(row.date, { date: row.date, comment: row.comment, checkIns: [] });
  }
  for (const row of ciRes.results ?? []) {
    let day = byDate.get(row.date);
    if (!day) {
      day = { date: row.date, comment: "", checkIns: [] };
      byDate.set(row.date, day);
    }
    day.checkIns.push(rowToCheckIn(row));
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildSetDayCommentStatement(
  db: D1Database,
  date: string,
  comment: string,
): D1PreparedStatement {
  assertIsoDate(date, "date");
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO days (date, comment, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (date) DO UPDATE SET
         comment = excluded.comment,
         updated_at = excluded.updated_at`,
    )
    .bind(date, comment, now);
}

export async function setDayComment(
  db: D1Database,
  date: string,
  comment: string,
): Promise<Day> {
  await buildSetDayCommentStatement(db, date, comment).run();
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
