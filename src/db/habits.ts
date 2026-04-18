import type { Habit, HabitRow } from "./schema.js";
import { rowToHabit } from "./schema.js";
import { assertIsoDate, nowIso } from "../util/date.js";
import { ToolError } from "../util/errors.js";

export interface CreateHabitInput {
  name: string;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
}

export interface UpdateHabitInput {
  name?: string;
  description?: string | null;
  startDate?: string;
  endDate?: string | null;
}

function validateDates(startDate: string, endDate: string | null | undefined): void {
  assertIsoDate(startDate, "start_date");
  if (endDate != null) {
    assertIsoDate(endDate, "end_date");
    if (endDate < startDate) {
      throw new ToolError("end_date must be on or after start_date");
    }
  }
}

export async function listHabits(
  db: D1Database,
  opts: { activeOn?: string } = {},
): Promise<Habit[]> {
  let stmt: D1PreparedStatement;
  if (opts.activeOn !== undefined) {
    assertIsoDate(opts.activeOn, "active_on");
    stmt = db
      .prepare(
        `SELECT * FROM habits
         WHERE start_date <= ?1
           AND (end_date IS NULL OR end_date >= ?1)
         ORDER BY id ASC`,
      )
      .bind(opts.activeOn);
  } else {
    stmt = db.prepare(`SELECT * FROM habits ORDER BY id ASC`);
  }
  const res = await stmt.all<HabitRow>();
  return (res.results ?? []).map(rowToHabit);
}

export async function getHabit(db: D1Database, id: number): Promise<Habit> {
  const row = await db
    .prepare(`SELECT * FROM habits WHERE id = ?1`)
    .bind(id)
    .first<HabitRow>();
  if (!row) throw new ToolError(`not found: habit ${id}`);
  return rowToHabit(row);
}

export async function createHabit(
  db: D1Database,
  input: CreateHabitInput,
): Promise<Habit> {
  if (!input.name || input.name.trim() === "") {
    throw new ToolError("name must be a non-empty string");
  }
  validateDates(input.startDate, input.endDate ?? null);

  const now = nowIso();
  const res = await db
    .prepare(
      `INSERT INTO habits (name, description, start_date, end_date, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       RETURNING *`,
    )
    .bind(
      input.name.trim(),
      input.description ?? null,
      input.startDate,
      input.endDate ?? null,
      now,
    )
    .first<HabitRow>();
  if (!res) throw new ToolError("failed to insert habit");
  return rowToHabit(res);
}

export async function updateHabit(
  db: D1Database,
  id: number,
  input: UpdateHabitInput,
): Promise<Habit> {
  const existing = await getHabit(db, id);

  const name = input.name ?? existing.name;
  if (!name || name.trim() === "") {
    throw new ToolError("name must be a non-empty string");
  }
  const description =
    input.description === undefined ? existing.description : input.description;
  const startDate = input.startDate ?? existing.startDate;
  const endDate =
    input.endDate === undefined ? existing.endDate : input.endDate;
  validateDates(startDate, endDate);

  const now = nowIso();
  const res = await db
    .prepare(
      `UPDATE habits
         SET name = ?1,
             description = ?2,
             start_date = ?3,
             end_date = ?4,
             updated_at = ?5
       WHERE id = ?6
       RETURNING *`,
    )
    .bind(name.trim(), description, startDate, endDate, now, id)
    .first<HabitRow>();
  if (!res) throw new ToolError(`not found: habit ${id}`);
  return rowToHabit(res);
}

export async function deleteHabit(db: D1Database, id: number): Promise<void> {
  const res = await db
    .prepare(`DELETE FROM habits WHERE id = ?1 RETURNING id`)
    .bind(id)
    .first<{ id: number }>();
  if (!res) throw new ToolError(`not found: habit ${id}`);
}
