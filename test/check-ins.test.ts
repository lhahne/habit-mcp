import { describe, expect, it } from "vitest";
import {
  deleteCheckIn,
  getCheckIn,
  upsertCheckIn,
} from "../src/db/check-ins.js";
import { deleteHabit } from "../src/db/habits.js";
import { listDays } from "../src/db/days.js";
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
    const days = await listDays(db(), { from: "2026-06-01", to: "2026-06-30" });
    expect(days).toEqual([]);
  });

  it("rejects invalid dates", async () => {
    const h = await makeHabit();
    await expect(
      upsertCheckIn(db(), { habitId: h.id, date: "nope" }),
    ).rejects.toThrow(/ISO date/);
  });
});
