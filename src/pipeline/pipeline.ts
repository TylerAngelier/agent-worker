/**
 * @module src/pipeline/pipeline — Pipeline orchestration for worktree lifecycle, hooks, and executor invocation.
 */
import type { Ticket } from "../providers/types.ts";
import type { CodeExecutor } from "./executor.ts";
import type { WorktreeHandle } from "./worktree.ts";
import { createWorktree, removeWorktree } from "./worktree.ts";
import { buildTaskVars, interpolate } from "./interpolate.ts";
import { runHooks } from "./hook-runner.ts";
import { log } from "../logger.ts";

export type PipelineResult = {
  /** Whether the full pipeline completed without errors. */
  success: boolean;
  /** Pipeline stage that failed, if applicable. */
  stage?: "pre-hook" | "executor" | "post-hook";
  /** Human-readable error description on failure. */
  error?: string;
  /** Executor output text on success. */
  output?: string;
};

/**
 * Orchestrates the full pipeline lifecycle for a ticket: optionally creates a worktree,
 * runs pre-hooks sequentially, invokes the code executor with the ticket prompt,
 * runs post-hooks sequentially, and cleans up the worktree in a finally block.
 * @param options.ticket - The ticket to process.
 * @param options.preHooks - Shell commands to run before the executor.
 * @param options.postHooks - Shell commands to run after the executor.
 * @param options.repoCwd - Working directory of the git repository.
 * @param options.executor - The code executor to invoke.
 * @param options.timeoutMs - Maximum execution time in milliseconds.
 * @param options.customPrompt - Optional custom prompt to prepend before the ticket context.
 * @returns PipelineResult indicating success or failure details.
 */
export async function executePipeline(options: {
  ticket: Ticket;
  preHooks: string[];
  postHooks: string[];
  repoCwd: string;
  executor: CodeExecutor;
  timeoutMs: number;
  customPrompt?: string;
}): Promise<PipelineResult> {
  const { ticket, preHooks, postHooks, repoCwd, executor, timeoutMs, customPrompt } = options;
  const vars = buildTaskVars(ticket);

  const useWorktree = executor.needsWorktree;
  let effectiveCwd = repoCwd;
  let handle: WorktreeHandle | null = null;

  // Create an isolated worktree if the executor needs one (e.g. Claude).
  // Codex manages its own worktrees internally so we skip this.
  if (useWorktree) {
    try {
      handle = await createWorktree(repoCwd, vars.branch);
      effectiveCwd = handle.path;
    } catch (err) {
      return {
        success: false,
        stage: "pre-hook",
        error: `Worktree creation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  vars.worktree = effectiveCwd;

  try {
    // Pre-hooks
    if (preHooks.length > 0) {
      const preResult = await runHooks(preHooks, effectiveCwd, vars);
      if (!preResult.success) {
        return {
          success: false,
          stage: "pre-hook",
          error: `Command "${preResult.failedCommand}" exited with code ${preResult.exitCode}: ${preResult.output}`,
        };
      }
    }

    // Code executor
    const customPart = customPrompt
      ? interpolate(customPrompt, vars) + "\n\n"
      : "";
    const prompt = `${customPart}Ticket: ${ticket.title}\n\n${ticket.description || "No description provided."}`;
    const execResult = await executor.run(prompt, effectiveCwd, timeoutMs);
    if (!execResult.success) {
      const reason = execResult.timedOut
        ? `Timed out after ${timeoutMs}ms`
        : `Exited with code ${execResult.exitCode}`;
      return {
        success: false,
        stage: "executor",
        error: `${reason}: ${execResult.output.slice(-2000)}`,
      };
    }

    // Post-hooks
    if (postHooks.length > 0) {
      const postResult = await runHooks(postHooks, effectiveCwd, vars);
      if (!postResult.success) {
        return {
          success: false,
          stage: "post-hook",
          error: `Command "${postResult.failedCommand}" exited with code ${postResult.exitCode}: ${postResult.output}`,
        };
      }
    }

    return { success: true, output: execResult.output };
  } finally {
    if (handle) {
      await removeWorktree(repoCwd, handle);
    }
  }
}
