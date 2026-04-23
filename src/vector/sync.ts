import type { Habit } from "../db/schema.js";
import {
  deleteChunkCount,
  getChunkCount,
  getChunkCounts,
  listAllChunkSources,
  setChunkCount,
} from "../db/text-chunks.js";
import { listHabits } from "../db/habits.js";
import {
  listAllDaysWithComments,
  listAllDaysWithExercise,
} from "../db/days.js";
import { listAllCheckInsWithNotes } from "../db/check-ins.js";
import { chunkText } from "./chunker.js";
import type {
  EmbeddingProvider,
  Kind,
  VectorMetadata,
  VectorStore,
  VectorUpsert,
} from "./types.js";

export function sourceIdForHabitName(id: number): string {
  return `habit:${id}:name`;
}

export function sourceIdForHabitDescription(id: number): string {
  return `habit:${id}:description`;
}

export function sourceIdForDayComment(date: string): string {
  return `day:${date}:comment`;
}

export function sourceIdForDayExercise(date: string): string {
  return `day:${date}:exercise`;
}

export function sourceIdForCheckInNote(habitId: number, date: string): string {
  return `checkin:${habitId}:${date}:note`;
}

export function chunkVectorId(sourceId: string, chunkIndex: number): string {
  return `${sourceId}:${chunkIndex}`;
}

export interface ParsedVectorId {
  sourceId: string;
  kind: Kind;
  chunkIndex: number;
  habitId?: number;
  date?: string;
}

export function parseVectorId(id: string): ParsedVectorId | null {
  const habitName = /^(habit:(\d+):name):(\d+)$/.exec(id);
  if (habitName?.[1] && habitName[2] && habitName[3] !== undefined) {
    return {
      sourceId: habitName[1],
      kind: "habit_name",
      habitId: Number(habitName[2]),
      chunkIndex: Number(habitName[3]),
    };
  }
  const habitDesc = /^(habit:(\d+):description):(\d+)$/.exec(id);
  if (habitDesc?.[1] && habitDesc[2] && habitDesc[3] !== undefined) {
    return {
      sourceId: habitDesc[1],
      kind: "habit_description",
      habitId: Number(habitDesc[2]),
      chunkIndex: Number(habitDesc[3]),
    };
  }
  const dayComment = /^(day:(\d{4}-\d{2}-\d{2}):comment):(\d+)$/.exec(id);
  if (dayComment?.[1] && dayComment[2] && dayComment[3] !== undefined) {
    return {
      sourceId: dayComment[1],
      kind: "day_comment",
      date: dayComment[2],
      chunkIndex: Number(dayComment[3]),
    };
  }
  const dayExercise = /^(day:(\d{4}-\d{2}-\d{2}):exercise):(\d+)$/.exec(id);
  if (dayExercise?.[1] && dayExercise[2] && dayExercise[3] !== undefined) {
    return {
      sourceId: dayExercise[1],
      kind: "day_exercise",
      date: dayExercise[2],
      chunkIndex: Number(dayExercise[3]),
    };
  }
  const checkIn = /^(checkin:(\d+):(\d{4}-\d{2}-\d{2}):note):(\d+)$/.exec(id);
  if (
    checkIn?.[1] &&
    checkIn[2] &&
    checkIn[3] &&
    checkIn[4] !== undefined
  ) {
    return {
      sourceId: checkIn[1],
      kind: "check_in_note",
      habitId: Number(checkIn[2]),
      date: checkIn[3],
      chunkIndex: Number(checkIn[4]),
    };
  }
  return null;
}

export async function bestEffort<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[vector:${label}] ${message}`);
    return null;
  }
}

export interface SyncCtx {
  db: D1Database;
  store: VectorStore;
  embed: EmbeddingProvider;
}

/**
 * Sync the chunks for a single source. Order is chosen to be self-healing
 * under partial failure: we delete orphans first, then upsert new chunks,
 * and only then update the chunk_count. If anything fails partway, the next
 * sync re-runs idempotently. Reindex recomputes everything from scratch.
 */
async function syncSource(
  ctx: SyncCtx,
  sourceId: string,
  text: string | null | undefined,
  metaForChunk: (chunkIndex: number) => VectorMetadata,
): Promise<void> {
  const { db, store, embed } = ctx;
  const chunks = chunkText(text ?? "");
  const priorCount = await getChunkCount(db, sourceId);

  if (chunks.length === 0) {
    if (priorCount > 0) {
      const toDelete = Array.from({ length: priorCount }, (_, i) =>
        chunkVectorId(sourceId, i),
      );
      await store.deleteByIds(toDelete);
    }
    await deleteChunkCount(db, sourceId);
    return;
  }

  if (priorCount > chunks.length) {
    const orphans: string[] = [];
    for (let i = chunks.length; i < priorCount; i++) {
      orphans.push(chunkVectorId(sourceId, i));
    }
    await store.deleteByIds(orphans);
  }

  const vectors = await embed.embed(chunks);
  const upserts: VectorUpsert[] = chunks.map((_, i) => {
    const values = vectors[i];
    if (!values) throw new Error(`missing embedding for ${sourceId}:${i}`);
    return {
      id: chunkVectorId(sourceId, i),
      values,
      metadata: { ...metaForChunk(i), chunk_index: i },
    };
  });
  await store.upsert(upserts);

  await setChunkCount(db, sourceId, chunks.length);
}

export async function purgeSource(
  ctx: SyncCtx,
  sourceId: string,
): Promise<void> {
  const { db, store } = ctx;
  const priorCount = await getChunkCount(db, sourceId);
  if (priorCount > 0) {
    const ids = Array.from({ length: priorCount }, (_, i) =>
      chunkVectorId(sourceId, i),
    );
    await store.deleteByIds(ids);
  }
  await deleteChunkCount(db, sourceId);
}

export async function syncHabit(ctx: SyncCtx, habit: Habit): Promise<void> {
  await syncSource(
    ctx,
    sourceIdForHabitName(habit.id),
    habit.name,
    () => ({ kind: "habit_name", habit_id: habit.id }),
  );
  await syncSource(
    ctx,
    sourceIdForHabitDescription(habit.id),
    habit.description,
    () => ({ kind: "habit_description", habit_id: habit.id }),
  );
}

export async function syncDayComment(
  ctx: SyncCtx,
  date: string,
  comment: string | null | undefined,
): Promise<void> {
  await syncSource(
    ctx,
    sourceIdForDayComment(date),
    comment,
    () => ({ kind: "day_comment", date }),
  );
}

export async function syncDayExercise(
  ctx: SyncCtx,
  date: string,
  exercise: string | null | undefined,
): Promise<void> {
  await syncSource(
    ctx,
    sourceIdForDayExercise(date),
    exercise,
    () => ({ kind: "day_exercise", date }),
  );
}

export async function syncCheckInNote(
  ctx: SyncCtx,
  habitId: number,
  date: string,
  note: string | null | undefined,
): Promise<void> {
  await syncSource(
    ctx,
    sourceIdForCheckInNote(habitId, date),
    note,
    () => ({ kind: "check_in_note", habit_id: habitId, date }),
  );
}

export async function purgeHabit(
  ctx: SyncCtx,
  habitId: number,
  checkInDates: string[],
): Promise<void> {
  const sources = [
    sourceIdForHabitName(habitId),
    sourceIdForHabitDescription(habitId),
    ...checkInDates.map((d) => sourceIdForCheckInNote(habitId, d)),
  ];
  const counts = await getChunkCounts(ctx.db, sources);
  const ids: string[] = [];
  for (const source of sources) {
    const n = counts.get(source) ?? 0;
    for (let i = 0; i < n; i++) ids.push(chunkVectorId(source, i));
  }
  if (ids.length > 0) await ctx.store.deleteByIds(ids);
  for (const source of sources) {
    if ((counts.get(source) ?? 0) > 0) await deleteChunkCount(ctx.db, source);
  }
}

export async function purgeCheckIn(
  ctx: SyncCtx,
  habitId: number,
  date: string,
): Promise<void> {
  await purgeSource(ctx, sourceIdForCheckInNote(habitId, date));
}

export async function purgeDayComment(
  ctx: SyncCtx,
  date: string,
): Promise<void> {
  await purgeSource(ctx, sourceIdForDayComment(date));
}

export async function purgeDayExercise(
  ctx: SyncCtx,
  date: string,
): Promise<void> {
  await purgeSource(ctx, sourceIdForDayExercise(date));
}

export async function reindexSource(
  ctx: SyncCtx,
  sourceId: string,
  text: string | null | undefined,
  metaForChunk: (chunkIndex: number) => VectorMetadata,
): Promise<number> {
  await syncSource(ctx, sourceId, text, metaForChunk);
  return chunkText(text ?? "").length;
}

export const REINDEX_PHASES = [
  "habits",
  "days",
  "check_ins",
  "orphans",
  "done",
] as const;
export type ReindexPhase = (typeof REINDEX_PHASES)[number];

export interface ReindexTotals {
  habit_names: number;
  habit_descriptions: number;
  day_comments: number;
  day_exercises: number;
  check_in_notes: number;
  chunks_upserted: number;
  orphans_removed: number;
}

export interface ReindexCursor {
  v: 1;
  phase: ReindexPhase;
  offset: number;
  totals: ReindexTotals;
}

export interface ReindexStepResult {
  next: ReindexCursor;
  processed: ReindexTotals;
  phase: ReindexPhase;
}

function zeroTotals(): ReindexTotals {
  return {
    habit_names: 0,
    habit_descriptions: 0,
    day_comments: 0,
    day_exercises: 0,
    check_in_notes: 0,
    chunks_upserted: 0,
    orphans_removed: 0,
  };
}

export function freshCursor(): ReindexCursor {
  return { v: 1, phase: "habits", offset: 0, totals: zeroTotals() };
}

function addTotals(a: ReindexTotals, b: ReindexTotals): ReindexTotals {
  return {
    habit_names: a.habit_names + b.habit_names,
    habit_descriptions: a.habit_descriptions + b.habit_descriptions,
    day_comments: a.day_comments + b.day_comments,
    day_exercises: a.day_exercises + b.day_exercises,
    check_in_notes: a.check_in_notes + b.check_in_notes,
    chunks_upserted: a.chunks_upserted + b.chunks_upserted,
    orphans_removed: a.orphans_removed + b.orphans_removed,
  };
}

function nextPhase(p: ReindexPhase): ReindexPhase {
  const i = REINDEX_PHASES.indexOf(p);
  return REINDEX_PHASES[i + 1] ?? "done";
}

function base64UrlEncode(bytes: string): string {
  const b64 = btoa(bytes);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  return atob(b64 + "=".repeat(pad));
}

export function encodeCursor(c: ReindexCursor): string {
  return base64UrlEncode(JSON.stringify(c));
}

export function decodeCursor(s: string): ReindexCursor {
  let json: string;
  try {
    json = base64UrlDecode(s);
  } catch {
    throw new Error("invalid cursor");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("invalid cursor");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid cursor");
  }
  const obj = parsed as Partial<ReindexCursor>;
  if (obj.v !== 1) throw new Error("invalid cursor: unsupported version");
  if (typeof obj.phase !== "string" || !REINDEX_PHASES.includes(obj.phase)) {
    throw new Error("invalid cursor");
  }
  if (typeof obj.offset !== "number" || !Number.isInteger(obj.offset) || obj.offset < 0) {
    throw new Error("invalid cursor");
  }
  if (!obj.totals || typeof obj.totals !== "object") {
    throw new Error("invalid cursor");
  }
  const t = obj.totals as Partial<ReindexTotals>;
  for (const key of [
    "habit_names",
    "habit_descriptions",
    "day_comments",
    "day_exercises",
    "check_in_notes",
    "chunks_upserted",
    "orphans_removed",
  ] as const) {
    if (typeof t[key] !== "number") throw new Error("invalid cursor");
  }
  return {
    v: 1,
    phase: obj.phase,
    offset: obj.offset,
    totals: t as ReindexTotals,
  };
}

async function computeTouchedSet(db: D1Database): Promise<Set<string>> {
  const [habits, dayComments, dayExercises, notes] = await Promise.all([
    listHabits(db),
    listAllDaysWithComments(db),
    listAllDaysWithExercise(db),
    listAllCheckInsWithNotes(db),
  ]);
  const s = new Set<string>();
  for (const h of habits) {
    s.add(sourceIdForHabitName(h.id));
    s.add(sourceIdForHabitDescription(h.id));
  }
  for (const d of dayComments) s.add(sourceIdForDayComment(d.date));
  for (const d of dayExercises) s.add(sourceIdForDayExercise(d.date));
  for (const ci of notes) s.add(sourceIdForCheckInNote(ci.habitId, ci.date));
  return s;
}

async function listOrphanSources(db: D1Database): Promise<string[]> {
  const [all, touched] = await Promise.all([
    listAllChunkSources(db),
    computeTouchedSet(db),
  ]);
  return all
    .map((r) => r.source_id)
    .filter((id) => !touched.has(id))
    .sort();
}

export async function reindexStep(
  ctx: SyncCtx,
  cursor: ReindexCursor,
  limit: number,
): Promise<ReindexStepResult> {
  const processed = zeroTotals();
  const phase = cursor.phase;

  if (phase === "done" || limit <= 0) {
    return { next: cursor, processed, phase };
  }

  const advance = (reachedEnd: boolean, newOffset: number): ReindexCursor => ({
    v: 1,
    phase: reachedEnd ? nextPhase(phase) : phase,
    offset: reachedEnd ? 0 : newOffset,
    totals: addTotals(cursor.totals, processed),
  });

  if (phase === "habits") {
    const habits = await listHabits(ctx.db);
    if (cursor.offset >= habits.length) {
      return { next: advance(true, 0), processed, phase };
    }
    const slice = habits.slice(cursor.offset, cursor.offset + limit);
    for (const h of slice) {
      const nameId = sourceIdForHabitName(h.id);
      const nameChunks = await reindexSource(ctx, nameId, h.name, () => ({
        kind: "habit_name",
        habit_id: h.id,
      }));
      if (nameChunks > 0) {
        processed.habit_names++;
        processed.chunks_upserted += nameChunks;
      }
      const descId = sourceIdForHabitDescription(h.id);
      const descChunks = await reindexSource(ctx, descId, h.description, () => ({
        kind: "habit_description",
        habit_id: h.id,
      }));
      if (descChunks > 0) {
        processed.habit_descriptions++;
        processed.chunks_upserted += descChunks;
      }
    }
    const newOffset = cursor.offset + slice.length;
    return {
      next: advance(newOffset >= habits.length, newOffset),
      processed,
      phase,
    };
  }

  if (phase === "days") {
    const [comments, exercises] = await Promise.all([
      listAllDaysWithComments(ctx.db),
      listAllDaysWithExercise(ctx.db),
    ]);
    const byDate = new Map<
      string,
      { date: string; comment?: string; exercise?: string }
    >();
    for (const c of comments) {
      byDate.set(c.date, { date: c.date, comment: c.comment });
    }
    for (const e of exercises) {
      const existing = byDate.get(e.date);
      if (existing) existing.exercise = e.exercise;
      else byDate.set(e.date, { date: e.date, exercise: e.exercise });
    }
    const days = [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    if (cursor.offset >= days.length) {
      return { next: advance(true, 0), processed, phase };
    }
    const slice = days.slice(cursor.offset, cursor.offset + limit);
    for (const d of slice) {
      if (d.comment) {
        const id = sourceIdForDayComment(d.date);
        const n = await reindexSource(ctx, id, d.comment, () => ({
          kind: "day_comment",
          date: d.date,
        }));
        if (n > 0) {
          processed.day_comments++;
          processed.chunks_upserted += n;
        }
      }
      if (d.exercise) {
        const id = sourceIdForDayExercise(d.date);
        const n = await reindexSource(ctx, id, d.exercise, () => ({
          kind: "day_exercise",
          date: d.date,
        }));
        if (n > 0) {
          processed.day_exercises++;
          processed.chunks_upserted += n;
        }
      }
    }
    const newOffset = cursor.offset + slice.length;
    return {
      next: advance(newOffset >= days.length, newOffset),
      processed,
      phase,
    };
  }

  if (phase === "check_ins") {
    const notes = await listAllCheckInsWithNotes(ctx.db);
    if (cursor.offset >= notes.length) {
      return { next: advance(true, 0), processed, phase };
    }
    const slice = notes.slice(cursor.offset, cursor.offset + limit);
    for (const ci of slice) {
      const id = sourceIdForCheckInNote(ci.habitId, ci.date);
      const n = await reindexSource(ctx, id, ci.note, () => ({
        kind: "check_in_note",
        habit_id: ci.habitId,
        date: ci.date,
      }));
      if (n > 0) {
        processed.check_in_notes++;
        processed.chunks_upserted += n;
      }
    }
    const newOffset = cursor.offset + slice.length;
    return {
      next: advance(newOffset >= notes.length, newOffset),
      processed,
      phase,
    };
  }

  // orphans: the list drains as we purge, so each call reads from the top
  // of the current list. `cursor.offset` is unused here; the phase advances
  // once `listOrphanSources` returns an empty or fully-consumed slice.
  const orphans = await listOrphanSources(ctx.db);
  if (orphans.length === 0) {
    return { next: advance(true, 0), processed, phase };
  }
  const slice = orphans.slice(0, limit);
  for (const sid of slice) {
    await purgeSource(ctx, sid);
    processed.orphans_removed++;
  }
  return {
    next: advance(orphans.length <= limit, 0),
    processed,
    phase,
  };
}
