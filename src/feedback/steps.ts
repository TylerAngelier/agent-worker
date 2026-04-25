/** @module src/feedback/steps — State machine for per-ticket feedback processing */

import type { Config } from "../config.ts";
import type { Ticket, TicketProvider } from "../providers/types.ts";
import type { CodeExecutor } from "../pipeline/executor.ts";
import type { ScmProvider } from "../scm/types.ts";
import type { PRTracker } from "./tracking.ts";
import type { FeedbackEvent } from "./comment-filter.ts";
import { findActionableComments } from "./comment-filter.ts";
import { processFeedback } from "./feedback-handler.ts";
import { hasAgentReaction } from "./reaction-utils.ts";
import { log } from "../logger.ts";

// --- State type ---

/** Result of processing a single feedback comment. */
export interface ProcessResult {
  /** The comment ID that was processed. */
  commentId: string;
  /** Whether the executor succeeded. */
  success: boolean;
}

/** Discriminated union representing each step in the feedback pipeline. */
export type FeedbackState =
  | { step: "discover_pr"; ticketId: string }
  | { step: "check_merge"; ticketId: string; prNumber: number; branch: string }
  | { step: "collect_feedback"; ticketId: string; prNumber: number; branch: string }
  | { step: "dedupe"; ticketId: string; prNumber: number; comments: FeedbackEvent[] }
  | { step: "process"; ticketId: string; prNumber: number; comments: FeedbackEvent[] }
  | { step: "mark_outcome"; ticketId: string; prNumber: number; results: ProcessResult[] }
  | { step: "done" }
  | { step: "error"; ticketId: string; error: Error };

/** Shared context passed through the feedback pipeline. */
export interface FeedbackContext {
  provider: TicketProvider;
  scm: ScmProvider;
  prTracker: PRTracker;
  config: Config;
  executor?: CodeExecutor;
}

// --- Step implementations ---

/**
 * Step 1: Discovers the PR for a ticket by looking up the branch name.
 * Transitions to `check_merge` if found, or `done` if not yet discoverable.
 */
async function stepDiscoverPr(
  ticket: Ticket,
  ctx: FeedbackContext,
): Promise<FeedbackState> {
  const { scm, prTracker, config } = ctx;
  const tracked = prTracker.get(ticket.id);

  if (!tracked || tracked.prNumber === 0) {
    const branch = config.repo.branch_template.replace("{id}", ticket.identifier);
    try {
      const pr = await scm.findPullRequest(branch);
      if (pr) {
        const existing = prTracker.get(ticket.id);
        prTracker.track({
          ticketId: ticket.id,
          ticketIdentifier: ticket.identifier,
          prNumber: pr.number,
          branch,
          lastCommentCheck: existing?.lastCommentCheck ?? "",
        });
        log.info("Tracking PR for ticket", {
          ticketId: ticket.identifier,
          prNumber: pr.number,
        });
      }
    } catch (err) {
      log.debug("Failed to find PR for ticket", {
        ticketId: ticket.identifier,
        branch,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const current = prTracker.get(ticket.id);
  if (!current || current.prNumber === 0) {
    return { step: "done" };
  }

  return {
    step: "check_merge",
    ticketId: ticket.id,
    prNumber: current.prNumber,
    branch: current.branch,
  };
}

/**
 * Step 2: Checks whether the PR has been merged.
 * If merged, transitions the ticket to verification and returns `done`.
 * Otherwise, transitions to `collect_feedback`.
 */
async function stepCheckMerge(
  ticket: Ticket,
  state: Extract<FeedbackState, { step: "check_merge" }>,
  ctx: FeedbackContext,
): Promise<FeedbackState> {
  const { provider, scm, prTracker, config } = ctx;
  const verificationStatus = config.provider.statuses.verification;

  try {
    const merged = await scm.isPRMerged(state.prNumber);
    if (merged) {
      await provider.transitionStatus(ticket.id, verificationStatus);

      const mergeInfo = await scm.getPRMergeInfo(state.prNumber);
      const shortSha = mergeInfo?.sha ? mergeInfo.sha.slice(0, 7) : "unknown";

      const lines: string[] = [
        "## agent-worker: PR Merged",
        "",
        `PR #${state.prNumber} has been merged. Ticket moved to **${verificationStatus}**.`,
      ];

      if (mergeInfo) {
        lines.push(
          "",
          `**PR:** ${mergeInfo.url}`,
          `**Commit:** \`${shortSha}\``,
        );
        if (mergeInfo.summary) {
          lines.push(`**Summary:** ${mergeInfo.summary}`);
        }
      }

      await provider.postComment(ticket.id, lines.join("\n"));

      log.info("PR merged, ticket moved to verification", {
        ticketId: ticket.identifier,
        prNumber: state.prNumber,
        sha: mergeInfo?.sha ?? "unknown",
      });

      prTracker.untrack(ticket.id);
      return { step: "done" };
    }
  } catch (err) {
    log.debug("Failed to check PR merge status", {
      ticketId: ticket.identifier,
      prNumber: state.prNumber,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    step: "collect_feedback",
    ticketId: ticket.id,
    prNumber: state.prNumber,
    branch: state.branch,
  };
}

/**
 * Step 3: Collects actionable feedback from PR and ticket comments.
 * Fetches comments from both sources, filters by the configured prefix,
 * and transitions to `dedupe`.
 */
async function stepCollectFeedback(
  ticket: Ticket,
  state: Extract<FeedbackState, { step: "collect_feedback" }>,
  ctx: FeedbackContext,
): Promise<FeedbackState> {
  const { provider, scm, prTracker, config } = ctx;
  const prefix = config.feedback.comment_prefix;
  const current = prTracker.get(ticket.id);
  const lastCommentCheck = current?.lastCommentCheck ?? "";

  let actionableComments: FeedbackEvent[] = [];

  // Fetch PR comments
  try {
    const prComments = await scm.getPRComments(state.prNumber, lastCommentCheck);
    const issuePrComments = prComments.filter(c => c.commentType === "issue");
    const reviewPrComments = prComments.filter(c => c.commentType === "review");

    actionableComments = actionableComments.concat(
      findActionableComments(issuePrComments, prefix, undefined, "issue").map((c) => ({ ...c, source: "pr" as const })),
      findActionableComments(reviewPrComments, prefix, undefined, "review").map((c) => ({ ...c, source: "pr" as const })),
    );
  } catch (err) {
    log.debug("Failed to fetch PR comments", {
      ticketId: ticket.identifier,
      prNumber: state.prNumber,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fetch ticket comments
  try {
    const ticketComments = await provider.fetchComments(ticket.id, lastCommentCheck);
    actionableComments = actionableComments.concat(
      findActionableComments(ticketComments, prefix, undefined, "ticket").map((c) => ({ ...c, source: "ticket" as const }))
    );
  } catch (err) {
    log.debug("Failed to fetch ticket comments", {
      ticketId: ticket.identifier,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    step: "dedupe",
    ticketId: ticket.id,
    prNumber: state.prNumber,
    comments: actionableComments,
  };
}

/**
 * Step 4: Deduplicates comments by checking for agent reactions.
 * PR comments with an existing agent reaction (eyes, +1, -1) are filtered out.
 * Ticket comments are always kept (they don't support SCM reactions).
 * Transitions to `process` if actionable comments remain, or `mark_outcome` if empty.
 */
async function stepDedupe(
  ticket: Ticket,
  state: Extract<FeedbackState, { step: "dedupe" }>,
  ctx: FeedbackContext,
): Promise<FeedbackState> {
  const { scm } = ctx;

  const deduped = await Promise.all(
    state.comments.map(async (comment) => {
      if (comment.commentType === "ticket") return comment;
      try {
        const seen = await hasAgentReaction(
          scm,
          Number(comment.commentId),
          comment.commentType as "issue" | "review",
          state.prNumber,
        );
        if (seen) {
          log.debug("Skipping already-seen PR comment", {
            ticketId: ticket.identifier,
            commentId: comment.commentId,
            commentType: comment.commentType,
          });
          return null;
        }
      } catch (err) {
        log.debug("Failed to check comment reaction for dedup", {
          commentId: comment.commentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return comment;
    }),
  ).then((results) => results.filter((c): c is FeedbackEvent => c !== null));

  if (deduped.length === 0) {
    return {
      step: "mark_outcome",
      ticketId: ticket.id,
      prNumber: state.prNumber,
      results: [],
    };
  }

  return {
    step: "process",
    ticketId: ticket.id,
    prNumber: state.prNumber,
    comments: deduped,
  };
}

/**
 * Step 5: Processes each actionable feedback comment by dispatching to the executor.
 * Errors are caught per-comment so that one failure does not prevent processing
 * subsequent comments for the same ticket.
 * Transitions to `mark_outcome` with the collected results.
 */
async function stepProcess(
  ticket: Ticket,
  state: Extract<FeedbackState, { step: "process" }>,
  ctx: FeedbackContext,
): Promise<FeedbackState> {
  const { scm, prTracker } = ctx;

  if (state.comments.length > 0) {
    log.info("Actionable feedback found", {
      ticketId: ticket.identifier,
      count: state.comments.length,
    });
  }

  const results: ProcessResult[] = [];

  for (const comment of state.comments) {
    try {
      const tracked = prTracker.get(ticket.id);
      if (!tracked) {
        log.warn("Tracker entry disappeared mid-processing", {
          ticketId: ticket.identifier,
          commentId: comment.commentId,
        });
        break;
      }

      const pr = {
        number: tracked.prNumber,
        url: "",
        branch: tracked.branch,
        state: "open" as const,
      };

      await processFeedback({
        ticket,
        comment,
        pr,
        config: ctx.config,
        provider: ctx.provider,
        scm,
        prTracker,
        executor: ctx.executor,
      });

      results.push({ commentId: comment.commentId, success: true });
    } catch (err) {
      log.error("Feedback processing failed", {
        ticketId: ticket.identifier,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({ commentId: comment.commentId, success: false });
    }
  }

  return {
    step: "mark_outcome",
    ticketId: ticket.id,
    prNumber: state.prNumber,
    results,
  };
}

/**
 * Step 6: Finalizes the pipeline by advancing `lastCommentCheck`.
 * The tracker timestamp is updated so the next poll cycle only fetches
 * comments newer than this point.
 */
async function stepMarkOutcome(
  ticket: Ticket,
  _state: Extract<FeedbackState, { step: "mark_outcome" }>,
  ctx: FeedbackContext,
): Promise<FeedbackState> {
  const { prTracker } = ctx;
  const updated = prTracker.get(ticket.id);
  if (updated) {
    prTracker.track({ ...updated, lastCommentCheck: new Date().toISOString() });
  }
  return { step: "done" };
}

// --- Pipeline runner ---

/** Ordered list of step names for logging. */
const STEP_ORDER: FeedbackState["step"][] = [
  "discover_pr",
  "check_merge",
  "collect_feedback",
  "dedupe",
  "process",
  "mark_outcome",
  "done",
  "error",
];

/**
 * Runs the complete feedback pipeline for a single ticket.
 *
 * The pipeline is modeled as a state machine with explicit transitions:
 *
 * 1. **discover_pr** → finds PR by branch → `check_merge` or `done`
 * 2. **check_merge** → checks if PR merged → `done` (merged) or `collect_feedback`
 * 3. **collect_feedback** → fetches PR + ticket comments → `dedupe`
 * 4. **dedupe** → filters out reaction-marked comments → `process` or `mark_outcome`
 * 5. **process** → dispatches each comment to the executor → `mark_outcome`
 * 6. **mark_outcome** → advances `lastCommentCheck` → `done`
 *
 * Errors at any step transition the state to `error` and the pipeline terminates.
 *
 * @param ticket - The ticket to process.
 * @param ctx - Shared context with providers, tracker, and config.
 */
export async function runFeedbackPipeline(
  ticket: Ticket,
  ctx: FeedbackContext,
): Promise<void> {
  let state: FeedbackState = { step: "discover_pr", ticketId: ticket.id };

  while (state.step !== "done" && state.step !== "error") {
    const stepIndex = STEP_ORDER.indexOf(state.step);
    log.debug("Feedback pipeline step", {
      ticketId: ticket.identifier,
      step: state.step,
      stepIndex,
    });

    try {
      switch (state.step) {
        case "discover_pr":
          state = await stepDiscoverPr(ticket, ctx);
          break;
        case "check_merge":
          state = await stepCheckMerge(ticket, state, ctx);
          break;
        case "collect_feedback":
          state = await stepCollectFeedback(ticket, state, ctx);
          break;
        case "dedupe":
          state = await stepDedupe(ticket, state, ctx);
          break;
        case "process":
          state = await stepProcess(ticket, state, ctx);
          break;
        case "mark_outcome":
          state = await stepMarkOutcome(ticket, state, ctx);
          break;
      }
    } catch (err) {
      // Safety net: current step implementations have internal try/catch,
      // so this outer catch primarily guards against future steps that may
      // not handle errors internally.
      state = {
        step: "error",
        ticketId: ticket.id,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  if (state.step === "error") {
    log.error("Feedback pipeline failed", {
      ticketId: ticket.identifier,
      error: state.error.message,
    });
  }
}

/**
 * Runs a single pipeline step and returns the next state.
 * Exported for testing individual steps in isolation.
 */
export async function runStep(
  ticket: Ticket,
  state: FeedbackState,
  ctx: FeedbackContext,
): Promise<FeedbackState> {
  switch (state.step) {
    case "discover_pr":
      return stepDiscoverPr(ticket, ctx);
    case "check_merge":
      return stepCheckMerge(ticket, state, ctx);
    case "collect_feedback":
      return stepCollectFeedback(ticket, state, ctx);
    case "dedupe":
      return stepDedupe(ticket, state, ctx);
    case "process":
      return stepProcess(ticket, state, ctx);
    case "mark_outcome":
      return stepMarkOutcome(ticket, state, ctx);
    default:
      return state; // done/error are terminal
  }
}
