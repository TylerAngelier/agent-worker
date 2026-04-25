/** @module src/feedback/feedback-poller — Long-running poll loop that monitors PRs for merge events and actionable review feedback */

import type { Config } from "../config.ts";
import type { TicketProvider } from "../providers/types.ts";
import type { ScmProvider } from "../scm/types.ts";
import type { PRTracker } from "./tracking.ts";
import { runFeedbackPipeline } from "./steps.ts";
// Re-exported for backward compatibility — consumers that imported hasAgentReaction
// from this module continue to work.
export { hasAgentReaction } from "./reaction-utils.ts";
import { log } from "../logger.ts";

/**
 * Creates a long-running poller that monitors tickets in "code_review" status.
 *
 * For each tracked ticket, on every poll cycle the poller delegates per-ticket
 * processing to {@link runFeedbackPipeline}, which runs a state machine that:
 * 1. Discovers the PR by branch name if not yet known.
 * 2. Checks if the PR has been merged — if so, transitions the ticket to "verification".
 * 3. Fetches new PR and ticket comments matching the configured comment prefix.
 * 4. Dispatches actionable feedback to the code executor.
 *
 * @param options - Poller configuration.
 * @param options.provider - Ticket provider for fetching tickets, comments, and transitioning statuses.
 * @param options.scm - SCM provider for finding PRs, checking merge status, and fetching PR comments.
 * @param options.prTracker - Persistent or in-memory store mapping ticket IDs to their tracked PR metadata.
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
  const intervalMs = config.feedback.poll_interval_seconds * 1000;

  const resolved = new Set<string>(); // ticket IDs already transitioned to verification
  const maxConcurrent = config.feedback.max_concurrent;
  let activeCount = 0;
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

  return {
    async start() {
      isRunning = true;
      log.info("Feedback poller started", {
        pollInterval: config.feedback.poll_interval_seconds,
        commentPrefix: config.feedback.comment_prefix,
      });

      while (isRunning) {
        try {
          const tickets = await provider.fetchTicketsByStatus(codeReviewStatus);
          const inFlight: Promise<void>[] = [];

          for (const ticket of tickets) {
            if (resolved.has(ticket.id)) {
              log.debug("Skipping already resolved ticket", { ticketId: ticket.identifier });
              continue;
            }

            // Concurrency gate: defer tickets that exceed the limit.
            // Deferred tickets are not processed this cycle; their lastCommentCheck
            // is not advanced, so their comments remain visible for the next cycle.
            if (activeCount >= maxConcurrent) {
              log.debug("Deferring ticket — max concurrency reached", {
                ticketId: ticket.identifier,
                activeCount,
                maxConcurrent,
              });
              continue;
            }

            activeCount++;
            // Pipeline is awaited via Promise.allSettled below, so
            // errors inside runFeedbackPipeline do not crash the poll cycle.
            // .finally() ensures activeCount is always decremented.
            const p = runFeedbackPipeline(ticket, { provider, scm, prTracker, config })
              .then(() => {
                // Track resolved tickets after successful pipeline run.
                // The pipeline untracks merged tickets internally, so we
                // only need to add them to the resolved set for quick skip.
                const tracked = prTracker.get(ticket.id);
                if (!tracked) {
                  resolved.add(ticket.id);
                }
              })
              .finally(() => {
                activeCount--;
              });
            inFlight.push(p);
          }

          // Wait for all in-flight ticket processing to settle before
          // starting the next poll cycle. This prevents overlapping work.
          await Promise.allSettled(inFlight);
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
