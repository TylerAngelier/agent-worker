import type { Logger } from "../logger.ts";
import type { Config } from "../config.ts";
import type { Ticket, TicketProvider } from "../providers/types.ts";
import type { CodeExecutor } from "../pipeline/executor.ts";
import type { PullRequest } from "../scm/types.ts";
import type { FeedbackEvent } from "./comment-filter.ts";
import type { PRTracker } from "./tracking.ts";
import { createWorktree, removeWorktree } from "../pipeline/pipeline.ts";
import { buildTaskVars } from "../pipeline/interpolate.ts";
import { runHooks } from "../pipeline/hook-runner.ts";

export async function processFeedback(options: {
  ticket: Ticket;
  comment: FeedbackEvent;
  pr: PullRequest;
  config: Config;
  logger: Logger;
  provider: TicketProvider;
  prTracker: PRTracker;
  executor?: CodeExecutor;
}): Promise<void> {
  const { ticket, comment, pr, config, logger, provider, prTracker } = options;

  let executor = options.executor;
  if (!executor) {
    const { createExecutor } = await import("../pipeline/executor.ts");
    executor = createExecutor(config.executor.type);
  }

  const vars = buildTaskVars(ticket);
  const useWorktree = executor.needsWorktree;
  let effectiveCwd = config.repo.path;
  let worktreePath: string | null = null;

  if (useWorktree) {
    try {
      worktreePath = await createWorktree(config.repo.path, vars.branch, logger, {
        createBranch: false,
      });
      effectiveCwd = worktreePath;
    } catch (err) {
      logger.error("Failed to create worktree for feedback", {
        ticketId: ticket.identifier,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  vars.worktree = effectiveCwd;

  try {
    const prompt = [
      `Review feedback on PR #${pr.number}:`,
      "",
      comment.body.replace(/^\/agent\s*/i, ""),
      "",
      "Address this feedback by pushing additional commits to the current branch.",
    ].join("\n");

    logger.info("Processing feedback", {
      ticketId: ticket.identifier,
      prNumber: pr.number,
      commentId: comment.commentId,
    });

    const execResult = await executor.run(prompt, effectiveCwd, config.executor.timeout_seconds * 1000, logger);

    if (execResult.success) {
      if (config.hooks.post.length > 0) {
        const postResult = await runHooks(config.hooks.post, effectiveCwd, vars, logger);
        if (!postResult.success) {
          logger.error("Post-hooks failed during feedback", {
            ticketId: ticket.identifier,
            command: postResult.failedCommand,
          });
        }
      }

      await provider.postComment(ticket.id, [
        "## Agent Worker — Feedback Addressed",
        "",
        `Addressed review feedback on [PR #${pr.number}](${pr.url}).`,
      ].join("\n"));

      logger.info("Feedback processed successfully", { ticketId: ticket.identifier });
    } else {
      logger.error("Executor failed during feedback processing", {
        ticketId: ticket.identifier,
        error: execResult.output.slice(-500),
      });

      await provider.postComment(ticket.id, [
        "## Agent Worker — Feedback Processing Failed",
        "",
        `Failed to address review feedback on [PR #${pr.number}](${pr.url}).`,
        "",
        "**Error:**",
        "```",
        execResult.output.slice(-1000),
        "```",
      ].join("\n"));
    }

    const tracked = prTracker.get(ticket.id);
    if (tracked) {
      prTracker.track({ ...tracked, lastCommentCheck: new Date().toISOString() });
    }
  } finally {
    if (worktreePath) {
      await removeWorktree(config.repo.path, worktreePath, logger);
    }
  }
}
