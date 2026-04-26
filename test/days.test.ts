import { describe, expect, it } from "vitest";
import { upsertCheckIn } from "../src/db/check-ins.js";
import {
  deleteDayComment,
  deleteDayExercise,
  deleteDayWeeklyComment,
  deleteDayWeight,
  getDay,
  listAllDaysWithComments,
  listAllDaysWithExercise,
  listAllDaysWithWeeklyComment,
  listDays,
  setDayComment,
  setDayExercise,
  setDayWeeklyComment,
  setDayWeight,
} from "../src/db/days.js";
import { db, makeHabit } from "./helpers.js";

describe("days", () => {
  it("returns empty comment and empty check-ins for unknown date", async () => {
    const day = await getDay(db(), "2026-07-04");
    expect(day).toEqual({
      date: "2026-07-04",
      comment: "",
      weight: null,
      exercise: "",
      weeklyComment: "",
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

  it("deleteDayComment clears the comment but preserves the row", async () => {
    await setDayComment(db(), "2026-07-05", "note");
    await setDayWeight(db(), "2026-07-05", 80.5);
    await deleteDayComment(db(), "2026-07-05");
    const d = await getDay(db(), "2026-07-05");
    expect(d.comment).toBe("");
    expect(d.weight).toBe(80.5);
    // Second clear on an existing row is idempotent (the row still exists).
    await expect(deleteDayComment(db(), "2026-07-05")).resolves.toBeUndefined();
    // But deleting for a date that never had a row throws "not found".
    await expect(deleteDayComment(db(), "2026-07-06")).rejects.toThrow(
      /not found/,
    );
  });

  it("setDayWeight upserts and deleteDayWeight clears to null", async () => {
    const d1 = await setDayWeight(db(), "2026-08-01", 82.3);
    expect(d1.weight).toBe(82.3);
    expect(d1.comment).toBe("");
    expect(d1.exercise).toBe("");

    const d2 = await setDayWeight(db(), "2026-08-01", 82.1);
    expect(d2.weight).toBe(82.1);

    await deleteDayWeight(db(), "2026-08-01");
    const d3 = await getDay(db(), "2026-08-01");
    expect(d3.weight).toBeNull();
    // Row still exists; another delete is idempotent.
    await expect(deleteDayWeight(db(), "2026-08-01")).resolves.toBeUndefined();
    // No row at all → throws.
    await expect(deleteDayWeight(db(), "2026-08-02")).rejects.toThrow(
      /not found/,
    );
  });

  it("setDayExercise upserts and deleteDayExercise clears to empty string", async () => {
    const d1 = await setDayExercise(db(), "2026-08-03", "30 min run");
    expect(d1.exercise).toBe("30 min run");
    expect(d1.comment).toBe("");
    expect(d1.weight).toBeNull();

    const d2 = await setDayExercise(db(), "2026-08-03", "45 min cycling");
    expect(d2.exercise).toBe("45 min cycling");

    await deleteDayExercise(db(), "2026-08-03");
    const d3 = await getDay(db(), "2026-08-03");
    expect(d3.exercise).toBe("");
    await expect(deleteDayExercise(db(), "2026-08-03")).resolves.toBeUndefined();
    await expect(deleteDayExercise(db(), "2026-08-04")).rejects.toThrow(
      /not found/,
    );
  });

  it("setDayWeeklyComment upserts and deleteDayWeeklyComment clears to empty string", async () => {
    const d1 = await setDayWeeklyComment(
      db(),
      "2026-08-05",
      "monday: aim for 3 gym sessions",
    );
    expect(d1.weeklyComment).toBe("monday: aim for 3 gym sessions");
    expect(d1.comment).toBe("");
    expect(d1.exercise).toBe("");
    expect(d1.weight).toBeNull();

    const d2 = await setDayWeeklyComment(db(), "2026-08-05", "updated goals");
    expect(d2.weeklyComment).toBe("updated goals");

    await deleteDayWeeklyComment(db(), "2026-08-05");
    const d3 = await getDay(db(), "2026-08-05");
    expect(d3.weeklyComment).toBe("");
    await expect(
      deleteDayWeeklyComment(db(), "2026-08-05"),
    ).resolves.toBeUndefined();
    await expect(deleteDayWeeklyComment(db(), "2026-08-06")).rejects.toThrow(
      /not found/,
    );
  });

  it("rejects invalid dates on weight and exercise setters", async () => {
    await expect(setDayWeight(db(), "bogus", 70)).rejects.toThrow(/ISO date/);
    await expect(setDayExercise(db(), "bogus", "run")).rejects.toThrow(
      /ISO date/,
    );
    await expect(setDayWeeklyComment(db(), "bogus", "x")).rejects.toThrow(
      /ISO date/,
    );
    await expect(deleteDayWeight(db(), "bogus")).rejects.toThrow(/ISO date/);
    await expect(deleteDayExercise(db(), "bogus")).rejects.toThrow(/ISO date/);
    await expect(deleteDayWeeklyComment(db(), "bogus")).rejects.toThrow(
      /ISO date/,
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

  it("listDays omits days whose only field has been cleared and have no check-ins", async () => {
    // Set then clear: the row physically lingers, but listDays must not surface it.
    await setDayComment(db(), "2026-09-01", "draft");
    await deleteDayComment(db(), "2026-09-01");

    await setDayWeight(db(), "2026-09-02", 80);
    await deleteDayWeight(db(), "2026-09-02");

    await setDayExercise(db(), "2026-09-03", "run");
    await deleteDayExercise(db(), "2026-09-03");

    await setDayWeeklyComment(db(), "2026-09-05", "weekly draft");
    await deleteDayWeeklyComment(db(), "2026-09-05");

    // A date with weight still set must remain visible.
    await setDayWeight(db(), "2026-09-04", 81);
    // A date with only weekly_comment set must remain visible.
    await setDayWeeklyComment(db(), "2026-09-06", "review the week");

    const days = await listDays(db(), { from: "2026-09-01", to: "2026-09-30" });
    expect(days.map((d) => d.date)).toEqual(["2026-09-04", "2026-09-06"]);
    expect(days[1]!.weeklyComment).toBe("review the week");
  });

  it("listAllDaysWithComments / listAllDaysWithExercise / listAllDaysWithWeeklyComment filter empty rows and sort by date", async () => {
    await setDayComment(db(), "2026-10-02", "second");
    await setDayComment(db(), "2026-10-01", "first");
    await setDayExercise(db(), "2026-10-01", "run");
    await setDayExercise(db(), "2026-10-03", "swim");
    await setDayWeeklyComment(db(), "2026-10-02", "week of focus");
    await setDayWeeklyComment(db(), "2026-10-06", "deload week");
    // A row with only weight set must NOT appear in any text listing.
    await setDayWeight(db(), "2026-10-04", 80);
    // A whitespace-only field is treated as empty (TRIM filter).
    await setDayComment(db(), "2026-10-05", "   ");
    await setDayWeeklyComment(db(), "2026-10-07", "   ");

    const comments = await listAllDaysWithComments(db());
    expect(comments).toEqual([
      { date: "2026-10-01", comment: "first" },
      { date: "2026-10-02", comment: "second" },
    ]);

    const exercises = await listAllDaysWithExercise(db());
    expect(exercises).toEqual([
      { date: "2026-10-01", exercise: "run" },
      { date: "2026-10-03", exercise: "swim" },
    ]);

    const weeklyComments = await listAllDaysWithWeeklyComment(db());
    expect(weeklyComments).toEqual([
      { date: "2026-10-02", weekly_comment: "week of focus" },
      { date: "2026-10-06", weekly_comment: "deload week" },
    ]);
  });

  it("listDays rejects invalid dates", async () => {
    await expect(
      listDays(db(), { from: "bogus", to: "2026-01-01" }),
    ).rejects.toThrow(/ISO date/);
  });
});
