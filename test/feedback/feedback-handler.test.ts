import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { processFeedback } from "../../src/feedback/feedback-handler.ts";
import { initLogger } from "../../src/logger.ts";
import type { Ticket, TicketProvider } from "../../src/providers/types.ts";
import type { CodeExecutor } from "../../src/pipeline/executor.ts";
import type { PullRequest, ScmProvider } from "../../src/scm/types.ts";
import type { FeedbackEvent } from "../../src/feedback/comment-filter.ts";
import type { Config } from "../../src/config.ts";

beforeEach(() => {
  initLogger({ level: "error" });
});

const ticket: Ticket = {
  id: "uuid-1",
  identifier: "ENG-100",
  title: "Test ticket",
  description: "Do something",
};

const pr: PullRequest = {
  number: 42,
  url: "https://github.com/org/repo/pull/42",
  branch: "agent/task-ENG-100",
  state: "open",
};

const comment: FeedbackEvent = {
  source: "pr",
  commentId: "comment-1",
  author: "reviewer",
  body: "/agent Please fix the typo",
  createdAt: "2026-03-22T12:00:00Z",
  commentType: "issue",
};

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    provider: {
      type: "linear",
      project_id: "proj-1",
      poll_interval_seconds: 10,
      statuses: {
        ready: "Todo",
        in_progress: "In Progress",
        code_review: "Code Review",
        verification: "Verification",
        failed: "Canceled",
      },
    },
    repo: { path: "/tmp", base_branch: "main", branch_template: "agent/task-{id}" },
    hooks: { pre: [], post: [] },
    executor: { type: "claude", dangerously_skip_permissions: true, timeout_seconds: 5, retries: 0 },
    log: { level: "info", redact: [] },
    scm: { type: "github", owner: "myorg", repo: "myrepo" },
    feedback: { comment_prefix: "/agent", poll_interval_seconds: 120, max_concurrent: 1 },
    prompts: {},
    ...overrides,
  };
}

function makeProvider(): TicketProvider {
  return {
    fetchReadyTickets: async () => [],
    fetchTicketsByStatus: async () => [],
    transitionStatus: async () => {},
    postComment: async () => {},
    fetchComments: async () => [],
  };
}

function makeScm(): ScmProvider {
  return {
    findPullRequest: async () => null,
    getPRComments: async () => [],
    isPRMerged: async () => false,
    getPRMergeInfo: async () => null,
    addCommentReaction: async () => {},
    replyToComment: async () => {},
    hasCommentReaction: async () => false,
  };
}

function makePRTracker() {
  const map = new Map();
  return {
    track: (entry: { ticketId: string; prNumber: number; branch: string; lastCommentCheck: string }) => {
      map.set(entry.ticketId, entry);
    },
    get: (ticketId: string) => map.get(ticketId),
    untrack: (ticketId: string) => map.delete(ticketId),
    getAll: () => Array.from(map.values()),
  };
}

describe("processFeedback", () => {
  test("prepends custom feedback prompt with interpolation", async () => {
    let receivedPrompt = "";
    const capturingExecutor: CodeExecutor = {
      name: "mock",
      needsWorktree: false,
      run: async (prompt) => {
        receivedPrompt = prompt;
        return { success: true, output: "ok", timedOut: false, exitCode: 0 };
      },
    };

    const config = makeConfig({
      prompts: {
        feedback: "Working on {id}: Keep changes minimal.",
      },
    });

    // Seed the PR tracker so lastCommentCheck gets updated
    const prTracker = makePRTracker();
    prTracker.track({
      ticketId: ticket.id,
      prNumber: pr.number,
      branch: pr.branch,
      lastCommentCheck: new Date().toISOString(),
    });

    await processFeedback({
      ticket,
      comment,
      pr,
      config,
      provider: makeProvider(),
      scm: makeScm(),
      prTracker,
      executor: capturingExecutor,
    });

    expect(receivedPrompt).toContain("Working on ENG-100: Keep changes minimal.");
    expect(receivedPrompt).toContain("Review feedback on PR #42:");
    expect(receivedPrompt).toContain("Please fix the typo");
  });

  test("works without custom feedback prompt (default behavior)", async () => {
    let receivedPrompt = "";
    const capturingExecutor: CodeExecutor = {
      name: "mock",
      needsWorktree: false,
      run: async (prompt) => {
        receivedPrompt = prompt;
        return { success: true, output: "ok", timedOut: false, exitCode: 0 };
      },
    };

    const config = makeConfig(); // No prompts.feedback

    const prTracker = makePRTracker();
    prTracker.track({
      ticketId: ticket.id,
      prNumber: pr.number,
      branch: pr.branch,
      lastCommentCheck: new Date().toISOString(),
    });

    await processFeedback({
      ticket,
      comment,
      pr,
      config,
      provider: makeProvider(),
      scm: makeScm(),
      prTracker,
      executor: capturingExecutor,
    });

    expect(receivedPrompt).not.toContain("Keep changes minimal");
    expect(receivedPrompt).toContain("Review feedback on PR #42:");
    expect(receivedPrompt).toContain("Please fix the typo");
    expect(receivedPrompt).toContain("Address this feedback by pushing additional commits");
  });

  test("preserves branch after feedback processing (deleteBranch: false)", async () => {
    // Create a real temp git repo with a branch matching the ticket's worktree branch
    const repoDir = mkdtempSync(join(tmpdir(), "agent-worker-fb-test-"));
    const branchName = `agent/task-${ticket.identifier}`; // agent/task-ENG-100

    try {
      execSync("git init -b main && git commit --allow-empty -m 'init'", { cwd: repoDir });
      execSync(`git branch ${branchName}`, { cwd: repoDir });

      const config = makeConfig({ repo: { path: repoDir, base_branch: "main", branch_template: "agent/task-{id}" } });

      const worktreeExecutor: CodeExecutor = {
        name: "mock",
        needsWorktree: true,
        run: async () => ({ success: true, output: "ok", timedOut: false, exitCode: 0 }),
      };

      const prTracker = makePRTracker();
      prTracker.track({
        ticketId: ticket.id,
        prNumber: pr.number,
        branch: pr.branch,
        lastCommentCheck: new Date().toISOString(),
      });

      await processFeedback({
        ticket,
        comment,
        pr,
        config,
        provider: makeProvider(),
        scm: makeScm(),
        prTracker,
        executor: worktreeExecutor,
      });

      // The branch must still exist — removeWorktree was called with { deleteBranch: false }
      const branches = execSync(`git branch --list ${branchName}`, { cwd: repoDir }).toString().trim();
      expect(branches).toContain(branchName);
    } finally {
      try { execSync("git worktree prune", { cwd: repoDir }); } catch {}
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
