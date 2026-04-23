import type { CheckInRow, Day, DayRow } from "./schema.js";
import { rowToCheckIn } from "./schema.js";
import { assertIsoDate, nowIso } from "../util/date.js";
import { ToolError } from "../util/errors.js";

export interface ListDaysOptions {
  from: string;
  to: string;
}

function emptyDay(date: string): Day {
  return { date, comment: "", weight: null, exercise: "", checkIns: [] };
}

function dayFromRow(row: DayRow, checkIns: Day["checkIns"]): Day {
  return {
    date: row.date,
    comment: row.comment,
    weight: row.weight,
    exercise: row.exercise,
    checkIns,
  };
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
  const checkIns = (ciRes.results ?? []).map(rowToCheckIn);
  if (!dayRow) return { ...emptyDay(date), checkIns };
  return dayFromRow(dayRow, checkIns);
}

export async function listAllDaysWithComments(
  db: D1Database,
): Promise<{ date: string; comment: string }[]> {
  const res = await db
    .prepare(
      `SELECT date, comment FROM days
       WHERE TRIM(comment) <> ''
       ORDER BY date ASC`,
    )
    .all<{ date: string; comment: string }>();
  return res.results ?? [];
}

export async function listAllDaysWithExercise(
  db: D1Database,
): Promise<{ date: string; exercise: string }[]> {
  const res = await db
    .prepare(
      `SELECT date, exercise FROM days
       WHERE TRIM(exercise) <> ''
       ORDER BY date ASC`,
    )
    .all<{ date: string; exercise: string }>();
  return res.results ?? [];
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
      .prepare(
        `SELECT * FROM days
         WHERE date >= ?1 AND date <= ?2
           AND (TRIM(comment) <> '' OR weight IS NOT NULL OR TRIM(exercise) <> '')`,
      )
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
    byDate.set(row.date, dayFromRow(row, []));
  }
  for (const row of ciRes.results ?? []) {
    let day = byDate.get(row.date);
    if (!day) {
      day = emptyDay(row.date);
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
    .prepare(
      `UPDATE days SET comment = '', updated_at = ?2
       WHERE date = ?1
       RETURNING date`,
    )
    .bind(date, nowIso())
    .first<{ date: string }>();
  if (!res) throw new ToolError(`not found: day ${date}`);
}

export function buildSetDayWeightStatement(
  db: D1Database,
  date: string,
  weight: number,
): D1PreparedStatement {
  assertIsoDate(date, "date");
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO days (date, weight, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (date) DO UPDATE SET
         weight = excluded.weight,
         updated_at = excluded.updated_at`,
    )
    .bind(date, weight, now);
}

export function buildClearDayWeightStatement(
  db: D1Database,
  date: string,
): D1PreparedStatement {
  assertIsoDate(date, "date");
  return db
    .prepare(
      `UPDATE days SET weight = NULL, updated_at = ?2 WHERE date = ?1`,
    )
    .bind(date, nowIso());
}

export async function setDayWeight(
  db: D1Database,
  date: string,
  weight: number,
): Promise<Day> {
  await buildSetDayWeightStatement(db, date, weight).run();
  return getDay(db, date);
}

export async function deleteDayWeight(
  db: D1Database,
  date: string,
): Promise<void> {
  assertIsoDate(date, "date");
  const res = await db
    .prepare(
      `UPDATE days SET weight = NULL, updated_at = ?2
       WHERE date = ?1
       RETURNING date`,
    )
    .bind(date, nowIso())
    .first<{ date: string }>();
  if (!res) throw new ToolError(`not found: day ${date}`);
}

export function buildSetDayExerciseStatement(
  db: D1Database,
  date: string,
  exercise: string,
): D1PreparedStatement {
  assertIsoDate(date, "date");
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO days (date, exercise, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (date) DO UPDATE SET
         exercise = excluded.exercise,
         updated_at = excluded.updated_at`,
    )
    .bind(date, exercise, now);
}

export async function setDayExercise(
  db: D1Database,
  date: string,
  exercise: string,
): Promise<Day> {
  await buildSetDayExerciseStatement(db, date, exercise).run();
  return getDay(db, date);
}

export async function deleteDayExercise(
  db: D1Database,
  date: string,
): Promise<void> {
  assertIsoDate(date, "date");
  const res = await db
    .prepare(
      `UPDATE days SET exercise = '', updated_at = ?2
       WHERE date = ?1
       RETURNING date`,
    )
    .bind(date, nowIso())
    .first<{ date: string }>();
  if (!res) throw new ToolError(`not found: day ${date}`);
}
