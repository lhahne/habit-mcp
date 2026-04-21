import type { Habit } from "../db/schema.js";
import type {
  EmbeddingProvider,
  Kind,
  VectorMetadata,
  VectorStore,
  VectorUpsert,
} from "./types.js";

export function vectorIdForHabitName(id: number): string {
  return `habit:${id}:name`;
}

export function vectorIdForHabitDescription(id: number): string {
  return `habit:${id}:description`;
}

export function vectorIdForDayComment(date: string): string {
  return `day:${date}:comment`;
}

export function vectorIdForCheckInNote(habitId: number, date: string): string {
  return `checkin:${habitId}:${date}:note`;
}

export function parseVectorId(
  id: string,
): { kind: Kind; habitId?: number; date?: string } | null {
  const habitName = /^habit:(\d+):name$/.exec(id);
  if (habitName?.[1]) return { kind: "habit_name", habitId: Number(habitName[1]) };
  const habitDesc = /^habit:(\d+):description$/.exec(id);
  if (habitDesc?.[1])
    return { kind: "habit_description", habitId: Number(habitDesc[1]) };
  const dayComment = /^day:(\d{4}-\d{2}-\d{2}):comment$/.exec(id);
  if (dayComment?.[1]) return { kind: "day_comment", date: dayComment[1] };
  const checkIn = /^checkin:(\d+):(\d{4}-\d{2}-\d{2}):note$/.exec(id);
  if (checkIn?.[1] && checkIn[2])
    return {
      kind: "check_in_note",
      habitId: Number(checkIn[1]),
      date: checkIn[2],
    };
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

interface UpsertJob {
  id: string;
  text: string;
  metadata: VectorMetadata;
}

async function upsertJobs(
  store: VectorStore,
  embed: EmbeddingProvider,
  jobs: UpsertJob[],
): Promise<void> {
  if (jobs.length === 0) return;
  const vectors = await embed.embed(jobs.map((j) => j.text));
  const upserts: VectorUpsert[] = jobs.map((job, i) => {
    const values = vectors[i];
    if (!values) {
      throw new Error(`missing embedding for id ${job.id}`);
    }
    return { id: job.id, values, metadata: job.metadata };
  });
  await store.upsert(upserts);
}

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

export async function syncHabit(
  store: VectorStore,
  embed: EmbeddingProvider,
  habit: Habit,
): Promise<void> {
  const jobs: UpsertJob[] = [];
  const deletes: string[] = [];

  if (nonEmpty(habit.name)) {
    jobs.push({
      id: vectorIdForHabitName(habit.id),
      text: habit.name,
      metadata: { kind: "habit_name", habit_id: habit.id },
    });
  } else {
    deletes.push(vectorIdForHabitName(habit.id));
  }

  if (nonEmpty(habit.description)) {
    jobs.push({
      id: vectorIdForHabitDescription(habit.id),
      text: habit.description,
      metadata: { kind: "habit_description", habit_id: habit.id },
    });
  } else {
    deletes.push(vectorIdForHabitDescription(habit.id));
  }

  await upsertJobs(store, embed, jobs);
  await store.deleteByIds(deletes);
}

export async function syncDayComment(
  store: VectorStore,
  embed: EmbeddingProvider,
  date: string,
  comment: string,
): Promise<void> {
  const id = vectorIdForDayComment(date);
  if (nonEmpty(comment)) {
    await upsertJobs(store, embed, [
      { id, text: comment, metadata: { kind: "day_comment", date } },
    ]);
  } else {
    await store.deleteByIds([id]);
  }
}

export async function syncCheckInNote(
  store: VectorStore,
  embed: EmbeddingProvider,
  habitId: number,
  date: string,
  note: string | null | undefined,
): Promise<void> {
  const id = vectorIdForCheckInNote(habitId, date);
  if (nonEmpty(note)) {
    await upsertJobs(store, embed, [
      {
        id,
        text: note,
        metadata: { kind: "check_in_note", habit_id: habitId, date },
      },
    ]);
  } else {
    await store.deleteByIds([id]);
  }
}

export async function purgeHabit(
  store: VectorStore,
  habitId: number,
  checkInDates: string[],
): Promise<void> {
  const ids = [
    vectorIdForHabitName(habitId),
    vectorIdForHabitDescription(habitId),
    ...checkInDates.map((d) => vectorIdForCheckInNote(habitId, d)),
  ];
  await store.deleteByIds(ids);
}

export async function purgeCheckIn(
  store: VectorStore,
  habitId: number,
  date: string,
): Promise<void> {
  await store.deleteByIds([vectorIdForCheckInNote(habitId, date)]);
}

export async function purgeDayComment(
  store: VectorStore,
  date: string,
): Promise<void> {
  await store.deleteByIds([vectorIdForDayComment(date)]);
}
