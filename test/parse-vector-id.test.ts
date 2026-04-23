import { describe, expect, it } from "vitest";

import { parseVectorId } from "../src/vector/sync.js";

describe("parseVectorId", () => {
  it("parses a habit_name id", () => {
    expect(parseVectorId("habit:42:name:0")).toEqual({
      sourceId: "habit:42:name",
      kind: "habit_name",
      habitId: 42,
      chunkIndex: 0,
    });
  });

  it("parses a habit_description id with multi-digit chunk index", () => {
    expect(parseVectorId("habit:7:description:12")).toEqual({
      sourceId: "habit:7:description",
      kind: "habit_description",
      habitId: 7,
      chunkIndex: 12,
    });
  });

  it("parses a day_comment id", () => {
    expect(parseVectorId("day:2026-04-23:comment:3")).toEqual({
      sourceId: "day:2026-04-23:comment",
      kind: "day_comment",
      date: "2026-04-23",
      chunkIndex: 3,
    });
  });

  it("parses a day_exercise id", () => {
    expect(parseVectorId("day:2026-04-23:exercise:0")).toEqual({
      sourceId: "day:2026-04-23:exercise",
      kind: "day_exercise",
      date: "2026-04-23",
      chunkIndex: 0,
    });
  });

  it("parses a check_in_note id", () => {
    expect(parseVectorId("checkin:99:2026-12-31:note:5")).toEqual({
      sourceId: "checkin:99:2026-12-31:note",
      kind: "check_in_note",
      habitId: 99,
      date: "2026-12-31",
      chunkIndex: 5,
    });
  });

  it("returns null for malformed ids", () => {
    expect(parseVectorId("")).toBeNull();
    expect(parseVectorId("garbage")).toBeNull();
    // Missing chunk index.
    expect(parseVectorId("habit:1:name")).toBeNull();
    expect(parseVectorId("day:2026-01-01:comment")).toBeNull();
    // Wrong field name.
    expect(parseVectorId("habit:1:bogus:0")).toBeNull();
    expect(parseVectorId("day:2026-01-01:weight:0")).toBeNull();
    // Non-numeric habit id / chunk index.
    expect(parseVectorId("habit:foo:name:0")).toBeNull();
    expect(parseVectorId("habit:1:name:abc")).toBeNull();
    // Bad date shape.
    expect(parseVectorId("day:2026-1-1:comment:0")).toBeNull();
    expect(parseVectorId("day:not-a-date:exercise:0")).toBeNull();
    expect(parseVectorId("checkin:1:2026-1-1:note:0")).toBeNull();
  });

  it("source IDs round-trip through parse", () => {
    const ids = [
      "habit:1:name:0",
      "habit:1:description:0",
      "day:2026-04-23:comment:0",
      "day:2026-04-23:exercise:0",
      "checkin:1:2026-04-23:note:0",
    ];
    for (const id of ids) {
      const parsed = parseVectorId(id);
      expect(parsed).not.toBeNull();
      expect(`${parsed!.sourceId}:${parsed!.chunkIndex}`).toBe(id);
    }
  });
});
