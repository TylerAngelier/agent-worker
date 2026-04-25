import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { runFeedbackPipeline, runStep } from "../../src/feedback/steps.ts";
import type { FeedbackContext, FeedbackState, ProcessResult } from "../../src/feedback/steps.ts";
import { initLogger } from "../../src/logger.ts";
import type { ScmProvider } from "../../src/scm/types.ts";
import type { TicketProvider } from "../../src/providers/types.ts";
import type { PRTracker } from "../../src/feedback/tracking.ts";
import type { Config } from "../../src/config.ts";
import type { FeedbackEvent } from "../../src/feedback/comment-filter.ts";
import * as feedbackHandler from "../../src/feedback/feedback-handler.ts";

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
  initLogger({ level: "error" });
});

afterEach(() => {
  (console.log as ReturnType<typeof spyOn>).mockRestore();
});

// --- Helpers ---

function makeConfig(overrides?: { max_concurrent?: number }): Config {
  return {
    provider: {
      type: "linear" as const,
      project_id: "proj-1",
      poll_interval_seconds: 60,
      statuses: {
        ready: "Ready",
        in_progress: "In Progress",
        code_review: "Code Review",
        verification: "Verification",
        failed: "Failed",
      },
    },
    repo: {
      path: "/tmp/repo",
      base_branch: "main",
      branch_template: "agent/task-{id}",
    },
    hooks: { pre: [], post: [] },
    executor: {
      type: "claude" as const,
      dangerously_skip_permissions: true,
      timeout_seconds: 300,
      retries: 0,
    },
    log: { level: "info" as const, redact: [] },
    scm: {
      type: "github" as const,
      owner: "myorg",
      repo: "myrepo",
    },
    feedback: {
      comment_prefix: "/agent",
      poll_interval_seconds: 1,
      max_concurrent: overrides?.max_concurrent ?? 1,
    },
    prompts: {},
  };
}

function createMockProvider(
  tickets: Awaited<ReturnType<TicketProvider["fetchTicketsByStatus"]>>,
): TicketProvider & { transitionedStatuses: Array<{ ticketId: string; status: string }>; postedComments: Array<{ ticketId: string; body: string }> } {
  const transitionedStatuses: Array<{ ticketId: string; status: string }> = [];
  const postedComments: Array<{ ticketId: string; body: string }> = [];
  return {
    fetchReadyTickets: async () => tickets,
    fetchTicketsByStatus: async () => tickets,
    transitionStatus: async (ticketId, status) => { transitionedStatuses.push({ ticketId, status }); },
    postComment: async (ticketId, body) => { postedComments.push({ ticketId, body }); },
    fetchComments: async () => [],
    transitionedStatuses,
    postedComments,
  };
}

function createMockScm(options?: {
  prNumber?: number;
  prComments?: Array<{ id: number; author: string; body: string; createdAt: string; commentType: "issue" | "review" }>;
  merged?: boolean;
  mergeInfo?: { url: string; sha: string; summary: string } | null;
  reactions?: Record<string, boolean>;
}): ScmProvider {
  return {
    findPullRequest: options?.prNumber
      ? async () => ({
          number: options.prNumber!,
          url: `https://github.com/myorg/myrepo/pull/${options.prNumber}`,
          branch: "agent/task-TEST-1",
          state: "open" as const,
        })
      : async () => null,
    getPRComments: async () => options?.prComments ?? [],
    isPRMerged: async () => options?.merged ?? false,
    getPRMergeInfo: async () => options?.mergeInfo ?? null,
    hasCommentReaction: async (_commentId, _commentType, reaction) => {
      return options?.reactions?.[reaction] ?? false;
    },
    addCommentReaction: async () => {},
    replyToComment: async () => {},
  };
}

function createMockTracker(
  entries?: Array<{ ticketId: string; ticketIdentifier: string; prNumber: number; branch: string; lastCommentCheck: string }>,
): PRTracker {
  const map = new Map<string, { ticketId: string; ticketIdentifier: string; prNumber: number; branch: string; lastCommentCheck: string }>();
  for (const e of entries ?? []) map.set(e.ticketId, e);

  return {
    track: (entry) => map.set(entry.ticketId, entry),
    get: (id) => map.get(id),
    untrack: (id) => { map.delete(id); },
    getAll: () => Array.from(map.values()),
  };
}

function makeTicket(id = "t1", identifier = "TEST-1") {
  return { id, identifier, title: "Test ticket", description: "" };
}

function makeCtx(overrides?: Partial<FeedbackContext>): FeedbackContext {
  return {
    provider: createMockProvider([]),
    scm: createMockScm(),
    prTracker: createMockTracker(),
    config: makeConfig(),
    ...overrides,
  };
}

// --- Tests ---

describe("runStep — discover_pr", () => {
  test("transitions to check_merge when PR is found", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({ prNumber: 42 });
    const ctx = makeCtx({ scm });

    const state: FeedbackState = { step: "discover_pr", ticketId: ticket.id };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("check_merge");
    if (next.step === "check_merge") {
      expect(next.prNumber).toBe(42);
      expect(next.branch).toBe("agent/task-TEST-1");
    }
  });

  test("transitions to done when PR is not found", async () => {
    const ticket = makeTicket();
    const scm = createMockScm(); // no PR
    const ctx = makeCtx({ scm });

    const state: FeedbackState = { step: "discover_pr", ticketId: ticket.id };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("done");
  });

  test("preserves existing lastCommentCheck when discovering PR", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({ prNumber: 42 });
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 0,
      branch: "",
      lastCommentCheck: "2026-01-01T00:00:00Z",
    }]);
    const ctx = makeCtx({ scm, prTracker: tracker });

    const state: FeedbackState = { step: "discover_pr", ticketId: ticket.id };
    await runStep(ticket, state, ctx);

    const tracked = tracker.get("t1");
    expect(tracked?.lastCommentCheck).toBe("2026-01-01T00:00:00Z");
  });

  test("sets empty lastCommentCheck when no prior entry exists", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({ prNumber: 42 });
    const tracker = createMockTracker(); // empty
    const ctx = makeCtx({ scm, prTracker: tracker });

    const state: FeedbackState = { step: "discover_pr", ticketId: ticket.id };
    await runStep(ticket, state, ctx);

    const tracked = tracker.get("t1");
    expect(tracked?.lastCommentCheck).toBe("");
  });

  test("transitions to done when SCM throws during PR lookup", async () => {
    const ticket = makeTicket();
    const scm: ScmProvider = {
      findPullRequest: async () => { throw new Error("API error"); },
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => false,
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };
    const ctx = makeCtx({ scm });

    const state: FeedbackState = { step: "discover_pr", ticketId: ticket.id };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("done");
  });

  test("skips discovery when PR is already tracked", async () => {
    const ticket = makeTicket();
    const scm = createMockScm(); // no PR — should not be called
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const ctx = makeCtx({ scm, prTracker: tracker });

    const state: FeedbackState = { step: "discover_pr", ticketId: ticket.id };
    const next = await runStep(ticket, state, ctx);

    // Already tracked with prNumber > 0, goes straight to check_merge
    expect(next.step).toBe("check_merge");
    if (next.step === "check_merge") {
      expect(next.prNumber).toBe(42);
    }
  });
});

describe("runStep — check_merge", () => {
  test("transitions to done and untracks when PR is merged", async () => {
    const ticket = makeTicket();
    const provider = createMockProvider([]);
    const scm = createMockScm({
      merged: true,
      mergeInfo: { url: "https://github.com/myorg/myrepo/commit/abc1234", sha: "abc1234def5678", summary: "Merge PR #42" },
    });
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const ctx = makeCtx({ provider, scm, prTracker: tracker });

    const state: FeedbackState = { step: "check_merge", ticketId: ticket.id, prNumber: 42, branch: "agent/task-TEST-1" };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("done");
    expect(tracker.get("t1")).toBeUndefined();
    expect(provider.transitionedStatuses).toEqual([{ ticketId: "t1", status: "Verification" }]);
    expect(provider.postedComments.length).toBe(1);
    expect(provider.postedComments[0]!.body).toContain("PR Merged");
  });

  test("transitions to collect_feedback when PR is not merged", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({ merged: false });
    const ctx = makeCtx({ scm });

    const state: FeedbackState = { step: "check_merge", ticketId: ticket.id, prNumber: 42, branch: "agent/task-TEST-1" };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("collect_feedback");
    if (next.step === "collect_feedback") {
      expect(next.prNumber).toBe(42);
    }
  });

  test("transitions to collect_feedback when merge check throws", async () => {
    const ticket = makeTicket();
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => { throw new Error("API error"); },
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => false,
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };
    const ctx = makeCtx({ scm });

    const state: FeedbackState = { step: "check_merge", ticketId: ticket.id, prNumber: 42, branch: "agent/task-TEST-1" };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("collect_feedback");
  });
});

describe("runStep — collect_feedback", () => {
  test("transitions to dedupe with filtered PR and ticket comments", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({
      prNumber: 42,
      prComments: [
        { id: 1, author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" as const },
        { id: 2, author: "reviewer", body: "not actionable", createdAt: "2026-01-01T00:01:00Z", commentType: "issue" as const },
      ],
    });
    const provider = createMockProvider([]);
    provider.fetchComments = async () => [
      { id: "tc1", author: "user", body: "/agent ticket feedback", createdAt: "2026-01-01T00:02:00Z" },
    ];
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const ctx = makeCtx({ provider, scm, prTracker: tracker });

    const state: FeedbackState = { step: "collect_feedback", ticketId: ticket.id, prNumber: 42, branch: "agent/task-TEST-1" };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("dedupe");
    if (next.step === "dedupe") {
      expect(next.comments.length).toBe(2); // 1 PR + 1 ticket
    }
  });

  test("returns empty comments when both fetches fail", async () => {
    const ticket = makeTicket();
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => { throw new Error("API error"); },
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => false,
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };
    const provider = createMockProvider([]);
    provider.fetchComments = async () => { throw new Error("API error"); };
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const ctx = makeCtx({ provider, scm, prTracker: tracker });

    const state: FeedbackState = { step: "collect_feedback", ticketId: ticket.id, prNumber: 42, branch: "agent/task-TEST-1" };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("dedupe");
    if (next.step === "dedupe") {
      expect(next.comments.length).toBe(0);
    }
  });

  test("separates issue and review PR comments correctly", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({
      prNumber: 42,
      prComments: [
        { id: 1, author: "reviewer", body: "/agent issue comment", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" as const },
        { id: 2, author: "reviewer", body: "/agent review comment", createdAt: "2026-01-01T00:01:00Z", commentType: "review" as const },
      ],
    });
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const ctx = makeCtx({ scm, prTracker: tracker });

    const state: FeedbackState = { step: "collect_feedback", ticketId: ticket.id, prNumber: 42, branch: "agent/task-TEST-1" };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("dedupe");
    if (next.step === "dedupe") {
      expect(next.comments.length).toBe(2);
      const issueComment = next.comments.find(c => c.commentType === "issue");
      const reviewComment = next.comments.find(c => c.commentType === "review");
      expect(issueComment).toBeDefined();
      expect(reviewComment).toBeDefined();
      expect(issueComment?.source).toBe("pr");
      expect(reviewComment?.source).toBe("pr");
    }
  });
});

describe("runStep — dedupe", () => {
  test("filters out PR comments with agent reactions", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({ reactions: { eyes: true } });
    const ctx = makeCtx({ scm });

    const comments: FeedbackEvent[] = [
      { source: "pr", commentId: "1", author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" },
    ];
    const state: FeedbackState = { step: "dedupe", ticketId: ticket.id, prNumber: 42, comments };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("mark_outcome");
    if (next.step === "mark_outcome") {
      expect(next.results.length).toBe(0);
    }
  });

  test("keeps ticket comments regardless of reactions", async () => {
    const ticket = makeTicket();
    const scm = createMockScm();
    const ctx = makeCtx({ scm });

    const comments: FeedbackEvent[] = [
      { source: "ticket", commentId: "tc1", author: "user", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "ticket" },
    ];
    const state: FeedbackState = { step: "dedupe", ticketId: ticket.id, prNumber: 42, comments };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("process");
    if (next.step === "process") {
      expect(next.comments.length).toBe(1);
    }
  });

  test("transitions to process when comments remain after dedup", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({ reactions: {} }); // no reactions
    const ctx = makeCtx({ scm });

    const comments: FeedbackEvent[] = [
      { source: "pr", commentId: "1", author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" },
      { source: "ticket", commentId: "tc1", author: "user", body: "/agent also this", createdAt: "2026-01-01T00:01:00Z", commentType: "ticket" },
    ];
    const state: FeedbackState = { step: "dedupe", ticketId: ticket.id, prNumber: 42, comments };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("process");
    if (next.step === "process") {
      expect(next.comments.length).toBe(2);
    }
  });

  test("fails open when reaction check throws", async () => {
    const ticket = makeTicket();
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => { throw new Error("API error"); },
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };
    const ctx = makeCtx({ scm });

    const comments: FeedbackEvent[] = [
      { source: "pr", commentId: "1", author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" },
    ];
    const state: FeedbackState = { step: "dedupe", ticketId: ticket.id, prNumber: 42, comments };
    const next = await runStep(ticket, state, ctx);

    // Fails open: comment is kept despite the error
    expect(next.step).toBe("process");
    if (next.step === "process") {
      expect(next.comments.length).toBe(1);
    }
  });
});

describe("runStep — process", () => {
  test("dispatches each comment and collects results", async () => {
    const ticket = makeTicket();
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const ctx = makeCtx({ prTracker: tracker });

    const processedBodies: string[] = [];
    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async ({ comment }) => {
      processedBodies.push(comment.body);
    });

    const comments: FeedbackEvent[] = [
      { source: "pr", commentId: "1", author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" },
      { source: "pr", commentId: "2", author: "reviewer", body: "/agent also that", createdAt: "2026-01-01T00:01:00Z", commentType: "issue" },
    ];
    const state: FeedbackState = { step: "process", ticketId: ticket.id, prNumber: 42, comments };
    const next = await runStep(ticket, state, ctx);

    spy.mockRestore();

    expect(next.step).toBe("mark_outcome");
    if (next.step === "mark_outcome") {
      expect(next.results.length).toBe(2);
      expect(next.results.every(r => r.success)).toBe(true);
    }
    expect(processedBodies).toEqual(["/agent fix this", "/agent also that"]);
  });

  test("continues after a comment fails", async () => {
    const ticket = makeTicket();
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const ctx = makeCtx({ prTracker: tracker });

    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async ({ comment }) => {
      if (comment.body.includes("fail")) {
        throw new Error("Executor failed");
      }
    });

    const comments: FeedbackEvent[] = [
      { source: "pr", commentId: "1", author: "reviewer", body: "/agent fail this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" },
      { source: "pr", commentId: "2", author: "reviewer", body: "/agent fix that", createdAt: "2026-01-01T00:01:00Z", commentType: "issue" },
    ];
    const state: FeedbackState = { step: "process", ticketId: ticket.id, prNumber: 42, comments };
    const next = await runStep(ticket, state, ctx);

    spy.mockRestore();

    expect(next.step).toBe("mark_outcome");
    if (next.step === "mark_outcome") {
      expect(next.results.length).toBe(2);
      expect(next.results[0]!.success).toBe(false);
      expect(next.results[1]!.success).toBe(true);
    }
  });

  test("returns empty results when tracker entry is gone mid-processing", async () => {
    const ticket = makeTicket();
    const tracker = createMockTracker(); // empty — no tracked entry
    const ctx = makeCtx({ prTracker: tracker });

    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async () => {});

    const comments: FeedbackEvent[] = [
      { source: "pr", commentId: "1", author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" },
    ];
    const state: FeedbackState = { step: "process", ticketId: ticket.id, prNumber: 42, comments };
    const next = await runStep(ticket, state, ctx);

    spy.mockRestore();

    expect(next.step).toBe("mark_outcome");
    if (next.step === "mark_outcome") {
      // No results because the tracker entry was missing and we broke out of the loop
      expect(next.results.length).toBe(0);
    }
  });
});

describe("runStep — mark_outcome", () => {
  test("advances lastCommentCheck and transitions to done", async () => {
    const ticket = makeTicket();
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "2026-01-01T00:00:00Z",
    }]);
    const ctx = makeCtx({ prTracker: tracker });

    const state: FeedbackState = { step: "mark_outcome", ticketId: ticket.id, prNumber: 42, results: [] };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("done");
    const tracked = tracker.get("t1");
    expect(tracked).toBeDefined();
    expect(tracked!.lastCommentCheck).not.toBe("2026-01-01T00:00:00Z");
    // Should be a valid ISO date
    expect(new Date(tracked!.lastCommentCheck).getTime()).not.toBeNaN();
  });

  test("does not fail when tracker entry is gone", async () => {
    const ticket = makeTicket();
    const tracker = createMockTracker(); // empty
    const ctx = makeCtx({ prTracker: tracker });

    const state: FeedbackState = { step: "mark_outcome", ticketId: ticket.id, prNumber: 42, results: [] };
    const next = await runStep(ticket, state, ctx);

    expect(next.step).toBe("done");
  });
});

describe("runFeedbackPipeline — full pipeline", () => {
  test("discovers PR, checks merge, collects feedback, dedupes, processes, and marks outcome", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({
      prNumber: 42,
      prComments: [
        { id: 1, author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" as const },
      ],
    });
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 0,
      branch: "",
      lastCommentCheck: "",
    }]);
    const provider = createMockProvider([]);
    const ctx = makeCtx({ provider, scm, prTracker: tracker });

    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async () => {});
    await runFeedbackPipeline(ticket, ctx);
    spy.mockRestore();

    // PR should be tracked now
    const tracked = tracker.get("t1");
    expect(tracked).toBeDefined();
    expect(tracked!.prNumber).toBe(42);
  });

  test("exits at done when PR is not found and not tracked", async () => {
    const ticket = makeTicket();
    const scm = createMockScm(); // no PR
    const ctx = makeCtx({ scm });

    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async () => {});
    await runFeedbackPipeline(ticket, ctx);
    spy.mockRestore();

    // No feedback should have been processed
    expect(spy).not.toHaveBeenCalled();
  });

  test("exits at done after merge detection", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({
      prNumber: 42,
      merged: true,
      mergeInfo: { url: "https://github.com/myorg/myrepo/commit/abc", sha: "abcdef", summary: "Merge" },
    });
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const provider = createMockProvider([]);
    const ctx = makeCtx({ provider, scm, prTracker: tracker });

    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async () => {});
    await runFeedbackPipeline(ticket, ctx);
    spy.mockRestore();

    // Ticket should be untracked
    expect(tracker.get("t1")).toBeUndefined();
    // Status should be transitioned
    expect(provider.transitionedStatuses).toEqual([{ ticketId: "t1", status: "Verification" }]);
  });

  test("handles SCM errors gracefully during discovery", async () => {
    const ticket = makeTicket();
    const scm: ScmProvider = {
      findPullRequest: async () => { throw new Error("Unexpected error"); },
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => false,
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };
    // All steps have internal try/catch, so the outer catch in runFeedbackPipeline
    // is a safety net for future steps that may not handle errors internally.
    const ctx = makeCtx({ scm });

    // Should not throw — errors are handled internally
    await runFeedbackPipeline(ticket, ctx);
  });

  test("processes multiple comments sequentially", async () => {
    const ticket = makeTicket();
    const scm = createMockScm({
      prNumber: 42,
      prComments: [
        { id: 1, author: "reviewer", body: "/agent first", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" as const },
        { id: 2, author: "reviewer", body: "/agent second", createdAt: "2026-01-01T00:01:00Z", commentType: "issue" as const },
      ],
    });
    const tracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);
    const ctx = makeCtx({ scm, prTracker: tracker });

    const processedOrder: string[] = [];
    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async ({ comment }) => {
      processedOrder.push(comment.body);
    });

    await runFeedbackPipeline(ticket, ctx);
    spy.mockRestore();

    expect(processedOrder).toEqual(["/agent first", "/agent second"]);
  });
});
