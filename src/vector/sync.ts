import type { Habit } from "../db/schema.js";
import {
  deleteChunkCount,
  getChunkCount,
  getChunkCounts,
  setChunkCount,
} from "../db/text-chunks.js";
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

export async function reindexSource(
  ctx: SyncCtx,
  sourceId: string,
  text: string | null | undefined,
  metaForChunk: (chunkIndex: number) => VectorMetadata,
): Promise<number> {
  await syncSource(ctx, sourceId, text, metaForChunk);
  return chunkText(text ?? "").length;
}
