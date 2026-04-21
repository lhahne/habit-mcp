import { describe, expect, it } from "vitest";

import {
  chunkText,
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
} from "../src/vector/chunker.js";

describe("chunkText", () => {
  it("returns an empty array for empty / whitespace text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("returns a single trimmed chunk for short text", () => {
    expect(chunkText("  hello world  ")).toEqual(["hello world"]);
  });

  it("does not chunk text exactly at the limit", () => {
    const text = "a".repeat(CHUNK_MAX_CHARS);
    expect(chunkText(text)).toEqual([text]);
  });

  it("splits long text into multiple chunks under the limit", () => {
    const para = "Sentence one is here. Sentence two follows next. ".repeat(80);
    const chunks = chunkText(para);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });

  it("prefers paragraph breaks when available", () => {
    const para = "alpha ".repeat(200);
    const para2 = "beta ".repeat(200);
    const text = `${para}\n\n${para2}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.endsWith("alpha")).toBe(true);
    expect(chunks[1]!.startsWith("alpha") || chunks[1]!.startsWith("beta")).toBe(true);
  });

  it("provides overlap between consecutive chunks", () => {
    const sentences = "Sentence one is here. Sentence two follows next. ".repeat(80);
    const chunks = chunkText(sentences);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const tail = chunks[0]!.slice(-CHUNK_OVERLAP_CHARS);
    const head = chunks[1]!.slice(0, CHUNK_OVERLAP_CHARS);
    // At least one short common substring confirms windowing
    let hasOverlap = false;
    for (let len = 30; len < CHUNK_OVERLAP_CHARS && !hasOverlap; len += 10) {
      if (head.includes(tail.slice(-len))) hasOverlap = true;
    }
    expect(hasOverlap).toBe(true);
  });

  it("is deterministic — repeated calls produce the same chunks", () => {
    const text = "Repeatable sentence. ".repeat(400);
    expect(chunkText(text)).toEqual(chunkText(text));
  });
});
