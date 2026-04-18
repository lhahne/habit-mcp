import { describe, expect, it } from "vitest";
import { upsertCheckIn } from "../src/db/check-ins.js";
import {
  deleteDayComment,
  getDay,
  listDays,
  setDayComment,
} from "../src/db/days.js";
import { db, makeHabit } from "./helpers.js";

describe("days", () => {
  it("returns empty comment and empty check-ins for unknown date", async () => {
    const day = await getDay(db(), "2026-07-04");
    expect(day).toEqual({
      date: "2026-07-04",
      comment: "",
      checkIns: [],
    });
  });

  it("setDayComment upserts and returns joined check-ins for that date", async () => {
    const h = await makeHabit();
    await upsertCheckIn(db(), {
      habitId: h.id,
      date: "2026-07-04",
      note: "morning",
    });

    const d1 = await setDayComment(db(), "2026-07-04", "great day");
    expect(d1.comment).toBe("great day");
    expect(d1.checkIns).toHaveLength(1);
    expect(d1.checkIns[0]!.note).toBe("morning");

    const d2 = await setDayComment(db(), "2026-07-04", "even better");
    expect(d2.comment).toBe("even better");
  });

  it("deleteDayComment removes and throws if missing", async () => {
    await setDayComment(db(), "2026-07-05", "note");
    await deleteDayComment(db(), "2026-07-05");
    const d = await getDay(db(), "2026-07-05");
    expect(d.comment).toBe("");
    await expect(deleteDayComment(db(), "2026-07-05")).rejects.toThrow(
      /not found/,
    );
  });

  it("rejects invalid dates", async () => {
    await expect(getDay(db(), "bogus")).rejects.toThrow(/ISO date/);
    await expect(setDayComment(db(), "2026-13-01", "x")).rejects.toThrow(
      /ISO date/,
    );
  });

  it("listDays returns comments and check-ins grouped by date", async () => {
    const h1 = await makeHabit({ name: "h1" });
    const h2 = await makeHabit({ name: "h2" });

    await setDayComment(db(), "2026-03-01", "first");
    await upsertCheckIn(db(), { habitId: h1.id, date: "2026-03-01" });
    await upsertCheckIn(db(), { habitId: h2.id, date: "2026-03-02", note: "x" });
    await setDayComment(db(), "2026-03-05", "later");
    await upsertCheckIn(db(), { habitId: h1.id, date: "2026-04-10" });

    const days = await listDays(db(), { from: "2026-03-01", to: "2026-03-31" });
    expect(days.map((d) => d.date)).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-05",
    ]);
    expect(days[0]!.comment).toBe("first");
    expect(days[0]!.checkIns).toHaveLength(1);
    expect(days[1]!.comment).toBe("");
    expect(days[1]!.checkIns[0]!.note).toBe("x");
    expect(days[2]!.checkIns).toEqual([]);
  });

  it("listDays rejects invalid dates", async () => {
    await expect(
      listDays(db(), { from: "bogus", to: "2026-01-01" }),
    ).rejects.toThrow(/ISO date/);
  });
});
