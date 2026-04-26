import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  deleteCheckIn,
  upsertCheckIn,
} from "../src/db/check-ins.js";
import {
  deleteDayComment,
  setDayComment,
  setDayExercise,
} from "../src/db/days.js";
import { deleteHabit, updateHabit } from "../src/db/habits.js";
import { buildMcpServer } from "../src/tools.js";
import { db, makeHabit, testContext } from "./helpers.js";

interface HabitsHistoryRow {
  history_id: number;
  habit_id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string;
  operation: string;
}

interface DaysHistoryRow {
  history_id: number;
  date: string;
  comment: string;
  weight: number | null;
  exercise: string;
  created_at: string;
  updated_at: string;
  archived_at: string;
  operation: string;
}

interface CheckInsHistoryRow {
  history_id: number;
  habit_id: number;
  date: string;
  done: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string;
  operation: string;
}

async function habitsHistory(): Promise<HabitsHistoryRow[]> {
  const res = await db()
    .prepare(`SELECT * FROM habits_history ORDER BY history_id ASC`)
    .all<HabitsHistoryRow>();
  return res.results ?? [];
}

async function daysHistory(): Promise<DaysHistoryRow[]> {
  const res = await db()
    .prepare(`SELECT * FROM days_history ORDER BY history_id ASC`)
    .all<DaysHistoryRow>();
  return res.results ?? [];
}

async function checkInsHistory(): Promise<CheckInsHistoryRow[]> {
  const res = await db()
    .prepare(`SELECT * FROM check_ins_history ORDER BY history_id ASC`)
    .all<CheckInsHistoryRow>();
  return res.results ?? [];
}

describe("row version history", () => {
  it("captures the previous habit row on update", async () => {
    const h = await makeHabit({
      name: "Meditate",
      description: "10 min",
      startDate: "2026-01-01",
    });

    expect(await habitsHistory()).toEqual([]);

    await updateHabit(db(), h.id, { name: "Meditate AM", description: "20 min" });

    const history = await habitsHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      habit_id: h.id,
      name: "Meditate",
      description: "10 min",
      start_date: "2026-01-01",
      operation: "UPDATE",
    });
  });

  it("captures the deleted habit and cascaded check-ins", async () => {
    const h = await makeHabit({ name: "Run" });
    await upsertCheckIn(db(), {
      habitId: h.id,
      date: "2026-01-02",
      note: "easy",
    });

    await deleteHabit(db(), h.id);

    const habits = await habitsHistory();
    expect(habits).toHaveLength(1);
    expect(habits[0]).toMatchObject({
      habit_id: h.id,
      name: "Run",
      operation: "DELETE",
    });

    const checkIns = await checkInsHistory();
    expect(checkIns).toHaveLength(1);
    expect(checkIns[0]).toMatchObject({
      habit_id: h.id,
      date: "2026-01-02",
      note: "easy",
      done: 1,
      operation: "DELETE",
    });
  });

  it("archives the prior day comment only on overwrite, not on first insert", async () => {
    await setDayComment(db(), "2026-04-23", "v1");
    expect(await daysHistory()).toEqual([]);

    await setDayComment(db(), "2026-04-23", "v2");
    const history = await daysHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      date: "2026-04-23",
      comment: "v1",
      operation: "UPDATE",
    });
  });

  it("archives the cleared day comment as an UPDATE, preserving the prior text", async () => {
    await setDayComment(db(), "2026-04-23", "morning run");
    await deleteDayComment(db(), "2026-04-23");

    const history = await daysHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      date: "2026-04-23",
      comment: "morning run",
      operation: "UPDATE",
    });
  });

  it("archives the previous check-in note on upsert overwrite", async () => {
    const h = await makeHabit();
    await upsertCheckIn(db(), { habitId: h.id, date: "2026-02-01", note: "a" });
    expect(await checkInsHistory()).toEqual([]);

    await upsertCheckIn(db(), { habitId: h.id, date: "2026-02-01", note: "b" });
    const history = await checkInsHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      habit_id: h.id,
      date: "2026-02-01",
      note: "a",
      operation: "UPDATE",
    });
  });

  it("archives directly-deleted check-ins", async () => {
    const h = await makeHabit();
    await upsertCheckIn(db(), {
      habitId: h.id,
      date: "2026-02-02",
      note: "keep",
    });

    await deleteCheckIn(db(), h.id, "2026-02-02");
    const history = await checkInsHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      habit_id: h.id,
      date: "2026-02-02",
      note: "keep",
      operation: "DELETE",
    });
  });

  it("does not archive anything when a new row is inserted with no prior state", async () => {
    await makeHabit();
    await setDayExercise(db(), "2026-03-01", "bike 30min");
    expect(await habitsHistory()).toEqual([]);
    expect(await daysHistory()).toEqual([]);
    expect(await checkInsHistory()).toEqual([]);
  });

  it("record_day batch archives all overwritten source rows", async () => {
    const h = await makeHabit();
    await setDayComment(db(), "2026-05-10", "initial comment");
    await setDayExercise(db(), "2026-05-10", "initial exercise");
    await upsertCheckIn(db(), {
      habitId: h.id,
      date: "2026-05-10",
      note: "initial note",
    });

    const daysBefore = await daysHistory();
    const checkInsBefore = await checkInsHistory();

    const server = buildMcpServer(testContext());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      await client.callTool({
        name: "record_day",
        arguments: {
          date: "2026-05-10",
          comment: "updated comment",
          exercise: "updated exercise",
          check_ins: [
            { habit_id: h.id, note: "updated note" },
          ],
        },
      });
    } finally {
      await client.close();
      await server.close();
    }

    const daysAfter = await daysHistory();
    const checkInsAfter = await checkInsHistory();

    expect(daysAfter.length).toBe(daysBefore.length + 2);
    const newDayRows = daysAfter.slice(daysBefore.length);
    expect(newDayRows.every((r) => r.operation === "UPDATE")).toBe(true);
    expect(newDayRows.some((r) => r.comment === "initial comment")).toBe(true);
    expect(newDayRows.some((r) => r.exercise === "initial exercise")).toBe(
      true,
    );

    expect(checkInsAfter.length).toBe(checkInsBefore.length + 1);
    const newCheckIn = checkInsAfter[checkInsAfter.length - 1]!;
    expect(newCheckIn).toMatchObject({
      habit_id: h.id,
      date: "2026-05-10",
      note: "initial note",
      operation: "UPDATE",
    });
  });
});
