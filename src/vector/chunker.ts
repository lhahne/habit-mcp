export const CHUNK_MAX_CHARS = 1500;
export const CHUNK_OVERLAP_CHARS = 200;

const BREAK_CANDIDATES: { needle: string; consume: number }[] = [
  { needle: "\n\n", consume: 2 },
  { needle: "\n", consume: 1 },
  { needle: ". ", consume: 1 },
  { needle: "! ", consume: 1 },
  { needle: "? ", consume: 1 },
];

export function chunkText(
  text: string,
  maxChars: number = CHUNK_MAX_CHARS,
  overlap: number = CHUNK_OVERLAP_CHARS,
): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + maxChars, trimmed.length);
    if (end < trimmed.length) {
      const slice = trimmed.slice(start, end);
      let bestBreak = -1;
      let bestConsume = 0;
      for (const { needle, consume } of BREAK_CANDIDATES) {
        const idx = slice.lastIndexOf(needle);
        if (idx > bestBreak && idx > maxChars / 2) {
          bestBreak = idx;
          bestConsume = consume;
        }
      }
      if (bestBreak > 0) {
        end = start + bestBreak + bestConsume;
      }
    }
    const piece = trimmed.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= trimmed.length) break;
    const nextStart = end - overlap;
    start = nextStart > start ? nextStart : end;
  }
  return chunks;
}
