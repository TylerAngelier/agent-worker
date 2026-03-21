import { describe, test, expect } from "bun:test";
import { createPRTracker } from "../../src/feedback/tracking.ts";

describe("PRTracker", () => {
  test("tracks and retrieves entries", () => {
    const tracker = createPRTracker();
    const entry = {
      ticketId: "uuid-1",
      ticketIdentifier: "ENG-100",
      prNumber: 42,
      branch: "agent/task-ENG-100",
      lastCommentCheck: "2026-01-01T00:00:00.000Z",
    };

    tracker.track(entry);
    expect(tracker.get("uuid-1")).toEqual(entry);
  });

  test("returns undefined for unknown ticket", () => {
    const tracker = createPRTracker();
    expect(tracker.get("nonexistent")).toBeUndefined();
  });

  test("untracks entries", () => {
    const tracker = createPRTracker();
    tracker.track({
      ticketId: "uuid-1",
      ticketIdentifier: "ENG-100",
      prNumber: 42,
      branch: "agent/task-ENG-100",
      lastCommentCheck: "2026-01-01T00:00:00.000Z",
    });

    tracker.untrack("uuid-1");
    expect(tracker.get("uuid-1")).toBeUndefined();
  });

  test("getAll returns all tracked entries", () => {
    const tracker = createPRTracker();
    tracker.track({
      ticketId: "uuid-1",
      ticketIdentifier: "ENG-100",
      prNumber: 42,
      branch: "agent/task-ENG-100",
      lastCommentCheck: "2026-01-01T00:00:00.000Z",
    });
    tracker.track({
      ticketId: "uuid-2",
      ticketIdentifier: "ENG-101",
      prNumber: 43,
      branch: "agent/task-ENG-101",
      lastCommentCheck: "2026-01-01T01:00:00.000Z",
    });

    expect(tracker.getAll()).toHaveLength(2);
  });

  test("overwrites existing entry on re-track", () => {
    const tracker = createPRTracker();
    tracker.track({
      ticketId: "uuid-1",
      ticketIdentifier: "ENG-100",
      prNumber: 42,
      branch: "agent/task-ENG-100",
      lastCommentCheck: "2026-01-01T00:00:00.000Z",
    });
    tracker.track({
      ticketId: "uuid-1",
      ticketIdentifier: "ENG-100",
      prNumber: 42,
      branch: "agent/task-ENG-100",
      lastCommentCheck: "2026-01-02T00:00:00.000Z",
    });

    expect(tracker.getAll()).toHaveLength(1);
    expect(tracker.get("uuid-1")!.lastCommentCheck).toBe("2026-01-02T00:00:00.000Z");
  });
});
