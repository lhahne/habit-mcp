import { describe, expect, it } from "vitest";
import { upsertCheckIn } from "../src/db/check-ins.js";
import { deleteDayComment, getDay, setDayComment } from "../src/db/days.js";
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
});
