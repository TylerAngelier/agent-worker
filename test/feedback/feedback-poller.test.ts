import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { hasAgentReaction } from "../../src/feedback/reaction-utils.ts";
import { createFeedbackPoller } from "../../src/feedback/feedback-poller.ts";
import { initLogger } from "../../src/logger.ts";
import type { ScmProvider } from "../../src/scm/types.ts";
import type { TicketProvider } from "../../src/providers/types.ts";
import type { PRTracker } from "../../src/feedback/tracking.ts";
import type { Config } from "../../src/config.ts";
import * as feedbackHandler from "../../src/feedback/feedback-handler.ts";

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
  initLogger({ level: "error" });
});

afterEach(() => {
  (console.log as ReturnType<typeof spyOn>).mockRestore();
});

function createMockScm(reactions: Record<string, boolean>): ScmProvider {
  return {
    findPullRequest: async () => null,
    getPRComments: async () => [],
    isPRMerged: async () => false,
    getPRMergeInfo: async () => null,
    hasCommentReaction: async (_commentId, _commentType, reaction) => {
      return reactions[reaction] ?? false;
    },
    addCommentReaction: async () => {},
    replyToComment: async () => {},
  };
}

describe("hasAgentReaction", () => {
  test("returns true when comment has eyes reaction", async () => {
    const scm = createMockScm({ eyes: true });
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(true);
  });

  test("returns true when comment has +1 reaction", async () => {
    const scm = createMockScm({ "+1": true });
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(true);
  });

  test("returns true when comment has -1 reaction", async () => {
    const scm = createMockScm({ "-1": true });
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(true);
  });

  test("returns false when no agent reactions are present", async () => {
    const scm = createMockScm({});
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(false);
  });

  test("returns false when only non-agent reactions are present", async () => {
    const scm = createMockScm({ rocket: true, laugh: true });
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(false);
  });

  test("returns true when multiple agent reactions are present", async () => {
    const scm = createMockScm({ eyes: true, "+1": true });
    expect(await hasAgentReaction(scm, 1, "review", 42)).toBe(true);
  });

  test("passes commentType and prNumber through to SCM provider", async () => {
    let receivedType: string | undefined;
    let receivedPrNumber: number | undefined;
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async (_commentId, commentType, _reaction, prNumber) => {
        receivedType = commentType;
        receivedPrNumber = prNumber;
        return false;
      },
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    await hasAgentReaction(scm, 99, "review", 123);
    expect(receivedType).toBe("review");
    expect(receivedPrNumber).toBe(123);
  });

  test("returns false when SCM provider throws for all reactions", async () => {
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => {
        throw new Error("API error");
      },
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(false);
  });

  test("returns true when one reaction throws but another succeeds with true", async () => {
    let callCount = 0;
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async (_commentId, _commentType, reaction) => {
        callCount++;
        if (reaction === "eyes") throw new Error("API error");
        return reaction === "+1";
      },
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    // eyes throws, +1 returns true
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(true);
    expect(callCount).toBe(3); // All three reactions are checked in parallel
  });
});

describe("createFeedbackPoller — concurrency controls", () => {
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
        poll_interval_seconds: 1, // short for tests
        max_concurrent: overrides?.max_concurrent ?? 1,
      },
      prompts: {},
    };
  }

  function createMockProvider(
    tickets: Awaited<ReturnType<TicketProvider["fetchTicketsByStatus"]>>,
  ): TicketProvider {
    return {
      fetchReadyTickets: async () => tickets,
      fetchTicketsByStatus: async () => tickets,
      transitionStatus: async () => {},
      postComment: async () => {},
      fetchComments: async () => [],
    };
  }

  function createMockScmWithPr(
    prNumber: number,
    prComments: Array<{ id: number; author: string; body: string; createdAt: string; commentType: "issue" | "review" }>,
  ): ScmProvider {
    return {
      findPullRequest: async () => ({
        number: prNumber,
        url: `https://github.com/myorg/myrepo/pull/${prNumber}`,
        branch: "agent/task-TEST-1",
        state: "open" as const,
      }),
      getPRComments: async () => prComments,
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => false,
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };
  }

  function createMockTracker(entries?: Array<{ ticketId: string; ticketIdentifier: string; prNumber: number; branch: string; lastCommentCheck: string }>): PRTracker {
    const map = new Map<string, { ticketId: string; ticketIdentifier: string; prNumber: number; branch: string; lastCommentCheck: string }>();
    for (const e of entries ?? []) map.set(e.ticketId, e);

    return {
      track: (entry) => map.set(entry.ticketId, entry),
      get: (id) => map.get(id),
      untrack: (id) => map.delete(id),
      getAll: () => Array.from(map.values()),
    };
  }

  test("dispatches feedback for a single ticket with actionable comment", async () => {
    const config = makeConfig({ max_concurrent: 1 });
    const ticket = { id: "t1", identifier: "TEST-1", title: "Test", description: "" };

    let processFeedbackCallCount = 0;
    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async () => {
      processFeedbackCallCount++;
    });

    const scm = createMockScmWithPr(42, [
      { id: 1, author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" as const },
    ]);

    const trackedEntry = {
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    };
    const prTracker = createMockTracker([trackedEntry]);
    const provider = createMockProvider([ticket]);

    const poller = createFeedbackPoller({ provider, scm, prTracker, config });

    const pollerPromise = poller.start();
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();
    await pollerPromise;

    spy.mockRestore();
    expect(processFeedbackCallCount).toBe(1);
  });

  test("processes multiple tickets concurrently with max_concurrent=2", async () => {
    const config = makeConfig({ max_concurrent: 2 });
    const tickets = [
      { id: "t1", identifier: "TEST-1", title: "Ticket 1", description: "" },
      { id: "t2", identifier: "TEST-2", title: "Ticket 2", description: "" },
    ];

    const processedTickets: string[] = [];
    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async ({ ticket }) => {
      processedTickets.push(ticket.id);
    });

    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async (_prNumber: number, _since?: string) => [
        { id: 1, author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" as const },
      ],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => false,
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    const prTracker = createMockTracker([
      { ticketId: "t1", ticketIdentifier: "TEST-1", prNumber: 10, branch: "agent/task-TEST-1", lastCommentCheck: "" },
      { ticketId: "t2", ticketIdentifier: "TEST-2", prNumber: 20, branch: "agent/task-TEST-2", lastCommentCheck: "" },
    ]);
    const provider = createMockProvider(tickets);

    const poller = createFeedbackPoller({ provider, scm, prTracker, config });

    const pollerPromise = poller.start();
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();
    await pollerPromise;

    spy.mockRestore();
    // Both tickets should have been processed in a single cycle
    expect(processedTickets).toEqual(["t1", "t2"]);
  });

  test("defers tickets beyond max_concurrent limit", async () => {
    const config = makeConfig({ max_concurrent: 1 });
    const tickets = [
      { id: "t1", identifier: "TEST-1", title: "Ticket 1", description: "" },
      { id: "t2", identifier: "TEST-2", title: "Ticket 2", description: "" },
    ];

    const processedTickets: string[] = [];
    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async ({ ticket }) => {
      processedTickets.push(ticket.id);
    });

    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async (_prNumber: number, _since?: string) => [
        { id: 1, author: "reviewer", body: "/agent fix this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" as const },
      ],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => false,
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    const prTracker = createMockTracker([
      { ticketId: "t1", ticketIdentifier: "TEST-1", prNumber: 10, branch: "agent/task-TEST-1", lastCommentCheck: "" },
      { ticketId: "t2", ticketIdentifier: "TEST-2", prNumber: 20, branch: "agent/task-TEST-2", lastCommentCheck: "" },
    ]);
    const provider = createMockProvider(tickets);

    const poller = createFeedbackPoller({ provider, scm, prTracker, config });

    const pollerPromise = poller.start();
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();
    await pollerPromise;

    spy.mockRestore();
    // Only the first ticket should be processed — the second is deferred
    expect(processedTickets).toEqual(["t1"]);
  });

  test("continues processing remaining comments after one fails", async () => {
    const config = makeConfig({ max_concurrent: 1 });
    const ticket = { id: "t1", identifier: "TEST-1", title: "Test", description: "" };

    const processedBodies: string[] = [];
    const spy = spyOn(feedbackHandler, "processFeedback").mockImplementation(async ({ comment }) => {
      processedBodies.push(comment.body);
      if (comment.body.includes("fail")) {
        throw new Error("Executor failed");
      }
    });

    const scm = createMockScmWithPr(42, [
      { id: 1, author: "reviewer", body: "/agent fail this", createdAt: "2026-01-01T00:00:00Z", commentType: "issue" as const },
      { id: 2, author: "reviewer", body: "/agent fix that", createdAt: "2026-01-01T00:01:00Z", commentType: "issue" as const },
    ]);

    const prTracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);

    const provider = createMockProvider([ticket]);
    const poller = createFeedbackPoller({ provider, scm, prTracker, config });

    const pollerPromise = poller.start();
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();
    await pollerPromise;

    spy.mockRestore();
    // Both comments should be attempted despite the first one failing
    expect(processedBodies).toEqual(["/agent fail this", "/agent fix that"]);
  });

  test("skips already-resolved tickets on subsequent cycles", async () => {
    const config = makeConfig({ max_concurrent: 1 });
    const ticket = { id: "t1", identifier: "TEST-1", title: "Test", description: "" };

    let transitionCount = 0;
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => true,
      getPRMergeInfo: async () => ({ url: "https://github.com/myorg/myrepo/commit/abc", sha: "abc1234", summary: "Merge" }),
      hasCommentReaction: async () => false,
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    const provider: TicketProvider = {
      fetchReadyTickets: async () => [ticket],
      fetchTicketsByStatus: async () => [ticket],
      transitionStatus: async () => { transitionCount++; },
      postComment: async () => {},
      fetchComments: async () => [],
    };

    const prTracker = createMockTracker([{
      ticketId: "t1",
      ticketIdentifier: "TEST-1",
      prNumber: 42,
      branch: "agent/task-TEST-1",
      lastCommentCheck: "",
    }]);

    const poller = createFeedbackPoller({ provider, scm, prTracker, config });

    const pollerPromise = poller.start();
    // Wait for two poll cycles
    await new Promise((r) => setTimeout(r, 250));
    poller.stop();
    await pollerPromise;

    // Transition should only happen once (second cycle skips resolved ticket)
    expect(transitionCount).toBe(1);
  });
});
