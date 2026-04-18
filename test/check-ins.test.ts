import { describe, expect, it } from "vitest";
import {
  deleteCheckIn,
  getCheckIn,
  listCheckIns,
  upsertCheckIn,
} from "../src/db/check-ins.js";
import { deleteHabit } from "../src/db/habits.js";
import { db, makeHabit } from "./helpers.js";

describe("check-ins CRUD", () => {
  it("creates a check-in with defaults (done=true, note=null)", async () => {
    const h = await makeHabit();
    const ci = await upsertCheckIn(db(), { habitId: h.id, date: "2026-04-01" });
    expect(ci).toMatchObject({
      habitId: h.id,
      date: "2026-04-01",
      done: true,
      note: null,
    });
  });

  it("upsert updates done + note for the same (habit, date) pair", async () => {
    const h = await makeHabit();
    await upsertCheckIn(db(), {
      habitId: h.id,
      date: "2026-04-01",
      done: true,
      note: "easy",
    });
    const updated = await upsertCheckIn(db(), {
      habitId: h.id,
      date: "2026-04-01",
      done: false,
      note: "skipped",
    });
    expect(updated.done).toBe(false);
    expect(updated.note).toBe("skipped");

    const rows = await listCheckIns(db(), { habitId: h.id });
    expect(rows).toHaveLength(1);
  });

  it("allows done=false with a note", async () => {
    const h = await makeHabit();
    const ci = await upsertCheckIn(db(), {
      habitId: h.id,
      date: "2026-04-02",
      done: false,
      note: "rest day",
    });
    expect(ci.done).toBe(false);
    expect(ci.note).toBe("rest day");
  });

  it("filters by habit_id and by date range", async () => {
    const h1 = await makeHabit({ name: "h1" });
    const h2 = await makeHabit({ name: "h2" });
    await upsertCheckIn(db(), { habitId: h1.id, date: "2026-04-01" });
    await upsertCheckIn(db(), { habitId: h1.id, date: "2026-04-02" });
    await upsertCheckIn(db(), { habitId: h1.id, date: "2026-04-03" });
    await upsertCheckIn(db(), { habitId: h2.id, date: "2026-04-02" });

    const byHabit = await listCheckIns(db(), { habitId: h1.id });
    expect(byHabit.map((c) => c.date)).toEqual([
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
    ]);

    const range = await listCheckIns(db(), {
      from: "2026-04-02",
      to: "2026-04-02",
    });
    expect(range).toHaveLength(2);

    const combined = await listCheckIns(db(), {
      habitId: h2.id,
      from: "2026-04-01",
      to: "2026-04-02",
    });
    expect(combined).toHaveLength(1);
    expect(combined[0]!.habitId).toBe(h2.id);
  });

  it("get returns null for missing check-in", async () => {
    const h = await makeHabit();
    expect(await getCheckIn(db(), h.id, "2099-01-01")).toBeNull();
  });

  it("delete removes and throws when missing", async () => {
    const h = await makeHabit();
    await upsertCheckIn(db(), { habitId: h.id, date: "2026-05-01" });
    await deleteCheckIn(db(), h.id, "2026-05-01");
    expect(await getCheckIn(db(), h.id, "2026-05-01")).toBeNull();
    await expect(deleteCheckIn(db(), h.id, "2026-05-01")).rejects.toThrow(
      /not found/,
    );
  });

  it("cascades when habit is deleted", async () => {
    const h = await makeHabit();
    await upsertCheckIn(db(), { habitId: h.id, date: "2026-06-01" });
    await upsertCheckIn(db(), { habitId: h.id, date: "2026-06-02" });
    await deleteHabit(db(), h.id);
    const rows = await listCheckIns(db());
    expect(rows).toHaveLength(0);
  });

  it("rejects invalid dates", async () => {
    const h = await makeHabit();
    await expect(
      upsertCheckIn(db(), { habitId: h.id, date: "nope" }),
    ).rejects.toThrow(/ISO date/);
  });
});
