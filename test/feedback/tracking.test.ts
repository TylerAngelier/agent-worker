import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { createPRTracker } from "../../src/feedback/tracking.ts";

function makeEntry(overrides: Partial<{
  ticketId: string;
  ticketIdentifier: string;
  prNumber: number;
  branch: string;
  lastCommentCheck: string;
}> = {}) {
  return {
    ticketId: overrides.ticketId ?? "uuid-1",
    ticketIdentifier: overrides.ticketIdentifier ?? "ENG-100",
    prNumber: overrides.prNumber ?? 42,
    branch: overrides.branch ?? "agent/task-ENG-100",
    lastCommentCheck: overrides.lastCommentCheck ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("PRTracker (in-memory)", () => {
  test("tracks and retrieves entries", () => {
    const tracker = createPRTracker();
    const entry = makeEntry();

    tracker.track(entry);
    expect(tracker.get("uuid-1")).toEqual(entry);
  });

  test("returns undefined for unknown ticket", () => {
    const tracker = createPRTracker();
    expect(tracker.get("nonexistent")).toBeUndefined();
  });

  test("untracks entries", () => {
    const tracker = createPRTracker();
    tracker.track(makeEntry());

    tracker.untrack("uuid-1");
    expect(tracker.get("uuid-1")).toBeUndefined();
  });

  test("getAll returns all tracked entries", () => {
    const tracker = createPRTracker();
    tracker.track(makeEntry({ ticketId: "uuid-1", ticketIdentifier: "ENG-100" }));
    tracker.track(makeEntry({ ticketId: "uuid-2", ticketIdentifier: "ENG-101" }));

    expect(tracker.getAll()).toHaveLength(2);
  });

  test("overwrites existing entry on re-track", () => {
    const tracker = createPRTracker();
    tracker.track(makeEntry());
    tracker.track(makeEntry({ lastCommentCheck: "2026-01-02T00:00:00.000Z" }));

    expect(tracker.getAll()).toHaveLength(1);
    expect(tracker.get("uuid-1")!.lastCommentCheck).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("PRTracker (file-backed)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `pr-tracking-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function trackingPath() {
    return join(tempDir, ".agent-worker-pr-tracking.json");
  }

  test("persists entries to file on track", () => {
    const filePath = trackingPath();
    const tracker = createPRTracker({ filePath });

    tracker.track(makeEntry());

    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.version).toBe(1);
    expect(data.entries["uuid-1"]).toBeDefined();
    expect(data.entries["uuid-1"].ticketIdentifier).toBe("ENG-100");
  });

  test("reloads entries from file on createPRTracker", () => {
    const filePath = trackingPath();

    // First tracker writes
    const tracker1 = createPRTracker({ filePath });
    tracker1.track(makeEntry({ ticketId: "uuid-1", ticketIdentifier: "ENG-100" }));
    tracker1.track(makeEntry({ ticketId: "uuid-2", ticketIdentifier: "ENG-101" }));

    // Second tracker reads from file
    const tracker2 = createPRTracker({ filePath });
    expect(tracker2.get("uuid-1")).toBeDefined();
    expect(tracker2.get("uuid-1")!.ticketIdentifier).toBe("ENG-100");
    expect(tracker2.get("uuid-2")).toBeDefined();
    expect(tracker2.get("uuid-2")!.ticketIdentifier).toBe("ENG-101");
    expect(tracker2.getAll()).toHaveLength(2);
  });

  test("persists untrack to file", () => {
    const filePath = trackingPath();

    const tracker1 = createPRTracker({ filePath });
    tracker1.track(makeEntry({ ticketId: "uuid-1" }));
    tracker1.track(makeEntry({ ticketId: "uuid-2" }));

    const tracker2 = createPRTracker({ filePath });
    tracker2.untrack("uuid-1");

    const tracker3 = createPRTracker({ filePath });
    expect(tracker3.get("uuid-1")).toBeUndefined();
    expect(tracker3.get("uuid-2")).toBeDefined();
  });

  test("uses atomic write (temp file + rename)", () => {
    const filePath = trackingPath();
    const tracker = createPRTracker({ filePath });

    tracker.track(makeEntry());

    // Read the file and verify it's valid JSON (the rename completed)
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.version).toBe(1);
    expect(data.entries["uuid-1"]).toBeDefined();

    // No temp files should be left behind
    const files = readdirSync(tempDir);
    const tmpFiles = files.filter((f: string) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  test("handles corrupted file by starting fresh", () => {
    const filePath = trackingPath();

    // Write invalid JSON
    writeFileSync(filePath, "this is not json{{{{", "utf-8");

    const tracker = createPRTracker({ filePath });
    // Should start fresh — no entries
    expect(tracker.getAll()).toHaveLength(0);

    // Should still be functional
    tracker.track(makeEntry());
    expect(tracker.get("uuid-1")).toBeDefined();
  });

  test("handles file with wrong version by starting fresh", () => {
    const filePath = trackingPath();

    writeFileSync(filePath, JSON.stringify({ version: 99, entries: {} }), "utf-8");

    const tracker = createPRTracker({ filePath });
    expect(tracker.getAll()).toHaveLength(0);
  });

  test("handles file with missing entries field by starting fresh", () => {
    const filePath = trackingPath();

    writeFileSync(filePath, JSON.stringify({ version: 1 }), "utf-8");

    const tracker = createPRTracker({ filePath });
    expect(tracker.getAll()).toHaveLength(0);
  });

  test("handles missing file by starting fresh", () => {
    const filePath = join(tempDir, "does-not-exist.json");

    const tracker = createPRTracker({ filePath });
    expect(tracker.getAll()).toHaveLength(0);

    // Tracking should create the file
    tracker.track(makeEntry());
    expect(existsSync(filePath)).toBe(true);
  });

  test("file format includes version field", () => {
    const filePath = trackingPath();
    const tracker = createPRTracker({ filePath });

    tracker.track(makeEntry());

    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data).toHaveProperty("version", 1);
    expect(data).toHaveProperty("entries");
    expect(typeof data.entries).toBe("object");
  });

  test("skips malformed entries on load", () => {
    const filePath = trackingPath();

    // Write a file with one valid entry and one malformed entry (missing required fields)
    const data = {
      version: 1,
      entries: {
        "uuid-1": makeEntry({ ticketId: "uuid-1", ticketIdentifier: "ENG-100" }),
        "uuid-bad": { foo: "bar" }, // missing ticketId and branch
        "uuid-null": null,
      },
    };
    writeFileSync(filePath, JSON.stringify(data), "utf-8");

    const tracker = createPRTracker({ filePath });
    // Only the valid entry should be loaded
    expect(tracker.get("uuid-1")).toBeDefined();
    expect(tracker.get("uuid-1")!.ticketIdentifier).toBe("ENG-100");
    expect(tracker.get("uuid-bad")).toBeUndefined();
    expect(tracker.get("uuid-null")).toBeUndefined();
    expect(tracker.getAll()).toHaveLength(1);
  });

  test("in-memory fallback (no filePath) does not create files", () => {
    const tracker = createPRTracker();
    tracker.track(makeEntry());
    tracker.track(makeEntry({ ticketId: "uuid-2" }));

    // No files created anywhere — just verify it works
    expect(tracker.getAll()).toHaveLength(2);
    expect(tracker.get("uuid-1")).toBeDefined();
  });
});
