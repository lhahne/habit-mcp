import { nowIso } from "../util/date.js";

export async function getChunkCount(
  db: D1Database,
  sourceId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT chunk_count FROM text_chunks WHERE source_id = ?1`)
    .bind(sourceId)
    .first<{ chunk_count: number }>();
  return row?.chunk_count ?? 0;
}

export async function getChunkCounts(
  db: D1Database,
  sourceIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (sourceIds.length === 0) return out;
  const placeholders = sourceIds.map((_, i) => `?${i + 1}`).join(",");
  const res = await db
    .prepare(
      `SELECT source_id, chunk_count FROM text_chunks WHERE source_id IN (${placeholders})`,
    )
    .bind(...sourceIds)
    .all<{ source_id: string; chunk_count: number }>();
  for (const row of res.results ?? []) out.set(row.source_id, row.chunk_count);
  return out;
}

export async function setChunkCount(
  db: D1Database,
  sourceId: string,
  count: number,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO text_chunks (source_id, chunk_count, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT (source_id) DO UPDATE SET
         chunk_count = excluded.chunk_count,
         updated_at = excluded.updated_at`,
    )
    .bind(sourceId, count, now)
    .run();
}

export async function deleteChunkCount(
  db: D1Database,
  sourceId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM text_chunks WHERE source_id = ?1`)
    .bind(sourceId)
    .run();
}
