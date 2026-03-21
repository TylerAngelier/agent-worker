import { describe, test, expect } from "bun:test";
import { findActionableComments } from "../../src/feedback/comment-filter.ts";

describe("findActionableComments", () => {
  test("filters comments by prefix", () => {
    const comments = [
      { id: "1", author: "alice", body: "/agent please fix this", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", author: "bob", body: "looks good to me", createdAt: "2026-01-01T01:00:00Z" },
      { id: "3", author: "charlie", body: "/agent also handle the edge case", createdAt: "2026-01-01T02:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent");
    expect(result).toHaveLength(2);
    expect(result[0]!.commentId).toBe("1");
    expect(result[1]!.commentId).toBe("3");
  });

  test("excludes specified author", () => {
    const comments = [
      { id: "1", author: "alice", body: "/agent please fix this", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", author: "agent-bot", body: "/agent done", createdAt: "2026-01-01T01:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent", "agent-bot");
    expect(result).toHaveLength(1);
    expect(result[0]!.author).toBe("alice");
  });

  test("returns empty when no comments match prefix", () => {
    const comments = [
      { id: "1", author: "alice", body: "looks good", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", author: "bob", body: "approved", createdAt: "2026-01-01T01:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent");
    expect(result).toHaveLength(0);
  });

  test("returns empty for empty input", () => {
    const result = findActionableComments([], "/agent");
    expect(result).toHaveLength(0);
  });

  test("handles numeric comment IDs", () => {
    const comments = [
      { id: 123, author: "alice", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent");
    expect(result).toHaveLength(1);
    expect(result[0]!.commentId).toBe("123");
  });

  test("matches prefix with leading whitespace", () => {
    const comments = [
      { id: "1", author: "alice", body: "  /agent fix this", createdAt: "2026-01-01T00:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent");
    expect(result).toHaveLength(1);
  });

  test("does not match prefix in middle of body", () => {
    const comments = [
      { id: "1", author: "alice", body: "please /agent fix this", createdAt: "2026-01-01T00:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent");
    expect(result).toHaveLength(0);
  });

  test("defaults commentType to 'ticket'", () => {
    const comments = [
      { id: "1", author: "alice", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent");
    expect(result).toHaveLength(1);
    expect(result[0]!.commentType).toBe("ticket");
  });

  test("passes through specified commentType", () => {
    const comments = [
      { id: "1", author: "alice", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent", undefined, "issue");
    expect(result).toHaveLength(1);
    expect(result[0]!.commentType).toBe("issue");
  });

  test("supports review commentType", () => {
    const comments = [
      { id: "1", author: "alice", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z" },
    ];

    const result = findActionableComments(comments, "/agent", undefined, "review");
    expect(result).toHaveLength(1);
    expect(result[0]!.commentType).toBe("review");
  });
});
