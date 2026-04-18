import { describe, expect, it } from "vitest";
import {
  createHabit,
  deleteHabit,
  getHabit,
  listHabits,
  updateHabit,
} from "../src/db/habits.js";
import { ToolError } from "../src/util/errors.js";
import { db, makeHabit } from "./helpers.js";

describe("habits CRUD", () => {
  it("creates a habit with the given fields", async () => {
    const habit = await createHabit(db(), {
      name: "Run",
      description: "30 min",
      startDate: "2026-01-15",
      endDate: "2026-12-31",
    });
    expect(habit).toMatchObject({
      name: "Run",
      description: "30 min",
      startDate: "2026-01-15",
      endDate: "2026-12-31",
    });
    expect(habit.id).toBeGreaterThan(0);
    expect(habit.createdAt).toBe(habit.updatedAt);
  });

  it("trims the name and rejects empty names", async () => {
    const habit = await createHabit(db(), {
      name: "  Read  ",
      startDate: "2026-01-01",
    });
    expect(habit.name).toBe("Read");

    await expect(
      createHabit(db(), { name: "   ", startDate: "2026-01-01" }),
    ).rejects.toThrow(ToolError);
  });

  it("rejects invalid or inverted dates", async () => {
    await expect(
      createHabit(db(), { name: "x", startDate: "not-a-date" }),
    ).rejects.toThrow(/start_date/);
    await expect(
      createHabit(db(), { name: "x", startDate: "2026-02-30" }),
    ).rejects.toThrow(/start_date/);
    await expect(
      createHabit(db(), {
        name: "x",
        startDate: "2026-02-01",
        endDate: "2026-01-15",
      }),
    ).rejects.toThrow(/end_date must be on or after start_date/);
  });

  it("lists habits in insertion order", async () => {
    const a = await makeHabit({ name: "A" });
    const b = await makeHabit({ name: "B" });
    const habits = await listHabits(db());
    expect(habits.map((h) => h.id)).toEqual([a.id, b.id]);
  });

  it("filters by active_on covering start and end boundaries", async () => {
    await makeHabit({
      name: "windowed",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
    await makeHabit({
      name: "open-ended",
      startDate: "2026-04-15",
      endDate: null,
    });

    const onStart = await listHabits(db(), { activeOn: "2026-03-01" });
    expect(onStart.map((h) => h.name)).toEqual(["windowed"]);

    const onEnd = await listHabits(db(), { activeOn: "2026-03-31" });
    expect(onEnd.map((h) => h.name)).toEqual(["windowed"]);

    const afterEnd = await listHabits(db(), { activeOn: "2026-04-01" });
    expect(afterEnd.map((h) => h.name)).toEqual([]);

    const openEnded = await listHabits(db(), { activeOn: "2029-09-09" });
    expect(openEnded.map((h) => h.name)).toEqual(["open-ended"]);
  });

  it("getHabit throws on missing id", async () => {
    await expect(getHabit(db(), 9999)).rejects.toThrow(/not found/);
  });

  it("updates partial fields and clears end_date when null", async () => {
    const h = await makeHabit({
      name: "Water",
      startDate: "2026-01-01",
      endDate: "2026-06-30",
    });

    const r1 = await updateHabit(db(), h.id, { description: "8 glasses" });
    expect(r1.description).toBe("8 glasses");
    expect(r1.endDate).toBe("2026-06-30");
    expect(r1.updatedAt >= r1.createdAt).toBe(true);

    const r2 = await updateHabit(db(), h.id, { endDate: null });
    expect(r2.endDate).toBeNull();
  });

  it("delete removes the habit and cascades check-ins", async () => {
    const h = await makeHabit();
    await db()
      .prepare(
        `INSERT INTO check_ins (habit_id, date, done) VALUES (?1, '2026-01-02', 1)`,
      )
      .bind(h.id)
      .run();

    await deleteHabit(db(), h.id);
    await expect(getHabit(db(), h.id)).rejects.toThrow(/not found/);

    const remaining = await db()
      .prepare(`SELECT COUNT(*) AS n FROM check_ins`)
      .first<{ n: number }>();
    expect(remaining?.n).toBe(0);
  });

  it("deleting a missing habit throws", async () => {
    await expect(deleteHabit(db(), 42)).rejects.toThrow(/not found/);
  });
});
