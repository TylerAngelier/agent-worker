/** @module src/feedback/feedback-poller — Long-running poll loop that monitors PRs for merge events and actionable review feedback */

import type { Config } from "../config.ts";
import type { TicketProvider } from "../providers/types.ts";
import type { ScmProvider } from "../scm/types.ts";
import type { PRTracker } from "./tracking.ts";
import { findActionableComments, type FeedbackEvent } from "./comment-filter.ts";
import { processFeedback } from "./feedback-handler.ts";
import { log } from "../logger.ts";

/** Reactions placed by the agent to mark comments as seen or processed. */
const AGENT_REACTIONS = ["eyes", "+1", "-1"] as const;

/**
 * Checks whether a comment has any agent-placed reaction (eyes, +1, or -1).
 * Used for deduplication so that already-processed comments are not dispatched
 * again after a server restart.
 *
 * @param scm - SCM provider to query for reactions.
 * @param commentId - The comment ID to check.
 * @param commentType - Whether the comment is an issue-level or review-level comment.
 * @param prNumber - Optional PR number required by some SCM providers.
 * @returns `true` if any agent reaction is present, `false` otherwise.
 */
export async function hasAgentReaction(
  scm: ScmProvider,
  commentId: number,
  commentType: "issue" | "review",
  prNumber?: number,
): Promise<boolean> {
  const results = await Promise.all(
    AGENT_REACTIONS.map((reaction) =>
      scm.hasCommentReaction(commentId, commentType, reaction, prNumber).catch(() => false)
    ),
  );
  return results.some(Boolean);
}

/**
 * Creates a long-running poller that monitors tickets in "code_review" status.
 *
 * For each tracked ticket, on every poll cycle the poller:
 * 1. Discovers the PR by branch name if not yet known.
 * 2. Checks if the PR has been merged — if so, transitions the ticket to "verification".
 * 3. Fetches new PR and ticket comments matching the configured comment prefix.
 * 4. Dispatches actionable feedback to {@link processFeedback}.
 *
 * @param options - Poller configuration.
 * @param options.provider - Ticket provider for fetching tickets, comments, and transitioning statuses.
 * @param options.scm - SCM provider for finding PRs, checking merge status, and fetching PR comments.
 * @param options.prTracker - In-memory store mapping ticket IDs to their tracked PR metadata.
 * @param options.config - Full application configuration (poll interval, statuses, comment prefix, etc.).
 * @returns An object with `start()` and `stop()` methods for lifecycle control.
 */
export function createFeedbackPoller(options: {
  provider: TicketProvider;
  scm: ScmProvider;
  prTracker: PRTracker;
  config: Config;
}): { start: () => Promise<void>; stop: () => void } {
  const { provider, scm, prTracker, config } = options;

  const codeReviewStatus = config.provider.statuses.code_review;
  const verificationStatus = config.provider.statuses.verification;
  const prefix = config.feedback.comment_prefix;
  const intervalMs = config.feedback.poll_interval_seconds * 1000;

  const resolved = new Set<string>(); // ticket IDs already transitioned to verification
  let isRunning = false;
  let wakeSleep: (() => void) | null = null;

  /**
   * Internal helper that sleeps for the specified duration but can be interrupted
   * early via the `wakeSleep` closure variable set by this function.
   * @param ms - Number of milliseconds to sleep.
   * @returns A promise that resolves when the timer fires or is interrupted.
   */
  function interruptibleSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeSleep = null;
        resolve();
      }, ms);
      wakeSleep = () => {
        clearTimeout(timer);
        wakeSleep = null;
        resolve();
      };
    });
  }

  /**
   * Internal helper that looks up the tracked PR info for a ticket and delegates
   * to {@link processFeedback} with the assembled options.
   * @param ticket - The ticket to process feedback for.
   * @param comment - The actionable feedback event to address.
   */
  async function processActionableFeedback(
    ticket: Awaited<ReturnType<TicketProvider["fetchTicketsByStatus"]>>[number],
    comment: FeedbackEvent,
  ): Promise<void> {
    const tracked = prTracker.get(ticket.id);
    if (!tracked) return;

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
      config,
      provider,
      scm,
      prTracker,
    });
  }

  return {
    async start() {
      isRunning = true;
      log.info("Feedback poller started", {
        pollInterval: config.feedback.poll_interval_seconds,
        commentPrefix: prefix,
      });

      while (isRunning) {
        try {
          const tickets = await provider.fetchTicketsByStatus(codeReviewStatus);

          for (const ticket of tickets) {
            if (resolved.has(ticket.id)) {
              log.debug("Skipping already resolved ticket", { ticketId: ticket.identifier });
              continue;
            }

            const tracked = prTracker.get(ticket.id);

            if (!tracked || tracked.prNumber === 0) {
              // Discover PR by branch name
              const branch = `agent/task-${ticket.identifier}`;
              try {
                const pr = await scm.findPullRequest(branch);
                if (pr) {
                  // Preserve the existing lastCommentCheck (from when the ticket was
                  // first tracked) so that comments posted between PR creation and
                  // this discovery cycle are not silently dropped. When there is no
                  // existing entry (fresh restart), omit `since` entirely by using an
                  // empty string — the reaction-based dedup handles preventing
                  // reprocessing of already-addressed comments.
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
              // Re-read tracked entry so the merge check below runs immediately
              const updated = prTracker.get(ticket.id);
              if (!updated) continue;
            }

            // Re-fetch tracked after possible discovery
            const current = prTracker.get(ticket.id)!;

            // Check if PR is merged
            try {
              const merged = await scm.isPRMerged(current.prNumber);
              if (merged) {
                await provider.transitionStatus(ticket.id, verificationStatus);

                const mergeInfo = await scm.getPRMergeInfo(current.prNumber);
                const shortSha = mergeInfo?.sha ? mergeInfo.sha.slice(0, 7) : "unknown";

                const lines: string[] = [
                  "## agent-worker: PR Merged",
                  "",
                  `PR #${current.prNumber} has been merged. Ticket moved to **${verificationStatus}**.`,
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
                  prNumber: current.prNumber,
                  sha: mergeInfo?.sha ?? "unknown",
                });
                prTracker.untrack(ticket.id);
                resolved.add(ticket.id);
                continue;
              }
            } catch (err) {
              log.debug("Failed to check PR merge status", {
                ticketId: ticket.identifier,
                prNumber: current.prNumber,
                error: err instanceof Error ? err.message : String(err),
              });
            }

            // Fetch new PR comments
            let actionableComments: FeedbackEvent[] = [];
            try {
              const prComments = await scm.getPRComments(current.prNumber, current.lastCommentCheck);
              const issuePrComments = prComments.filter(c => c.commentType === "issue");
              const reviewPrComments = prComments.filter(c => c.commentType === "review");

              actionableComments = actionableComments.concat(
                findActionableComments(issuePrComments, prefix, undefined, "issue").map((c) => ({ ...c, source: "pr" as const })),
                findActionableComments(reviewPrComments, prefix, undefined, "review").map((c) => ({ ...c, source: "pr" as const })),
              );
            } catch (err) {
              log.debug("Failed to fetch PR comments", {
                ticketId: ticket.identifier,
                prNumber: current.prNumber,
                error: err instanceof Error ? err.message : String(err),
              });
            }

            // Fetch new ticket comments
            try {
              const ticketComments = await provider.fetchComments(ticket.id, current.lastCommentCheck);
              actionableComments = actionableComments.concat(
                findActionableComments(ticketComments, prefix, undefined, "ticket").map((c) => ({ ...c, source: "ticket" as const }))
              );
            } catch (err) {
              log.debug("Failed to fetch ticket comments", {
                ticketId: ticket.identifier,
                error: err instanceof Error ? err.message : String(err),
              });
            }

            // Filter out PR comments that already have an agent reaction (eyes, +1, or -1)
            actionableComments = await Promise.all(
              actionableComments.map(async (comment) => {
                if (comment.commentType === "ticket") return comment;
                try {
                  const seen = await hasAgentReaction(scm, Number(comment.commentId), comment.commentType as "issue" | "review", current.prNumber);
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

            if (actionableComments.length > 0) {
              log.info("Actionable feedback found", {
                ticketId: ticket.identifier,
                count: actionableComments.length,
              });
              for (const comment of actionableComments) {
                await processActionableFeedback(ticket, comment);
              }
            }

            // Update lastCommentCheck regardless
            const updated = prTracker.get(ticket.id);
            if (updated) {
              prTracker.track({ ...updated, lastCommentCheck: new Date().toISOString() });
            }
          }
        } catch (err) {
          log.error("Feedback poll cycle failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        if (!isRunning) break;
        await interruptibleSleep(intervalMs);
      }

      log.info("Feedback poller stopped");
    },

    stop() {
      isRunning = false;
      wakeSleep?.();
    },
  };
}
