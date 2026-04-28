/** @module src/pipeline/claude-executor — Claude Code executor implementation */

import type { CodeExecutor, ExecutorResult } from "./executor.ts";
import { streamToLines, spawnOrError } from "./executor.ts";
import { log, time } from "../logger.ts";

const logger = log.child("claude");

/** Options for creating a Claude Code executor. */
export interface ClaudeExecutorOptions {
  /** Optional model identifier passed via --model flag. */
  model?: string;
}

/**
 * Creates a Claude Code executor.
 *
 * Uses `claude --print [--model <model>] --dangerously-skip-permissions -p <prompt>`.
 * Requires an isolated worktree (`needsWorktree: true`) since Claude
 * operates on the filesystem directly.
 *
 * @param options - Optional configuration including model selection.
 * @returns {@link CodeExecutor} configured for Claude Code
 */
export function createClaudeExecutor(options?: ClaudeExecutorOptions): CodeExecutor {
  return {
    name: "claude",
    needsWorktree: true,
    async run(prompt: string, cwd: string, timeoutMs: number): Promise<ExecutorResult> {
      return time("claude:run", async () => {
      logger.info("started", { timeoutMs, model: options?.model });

      const args = ["claude", "--print"];
      if (options?.model) {
        args.push("--model", options.model);
      }
      args.push("--dangerously-skip-permissions", "-p", prompt);

      const spawned = spawnOrError(args, { cwd, stdout: "pipe", stderr: "pipe" });

      if ("success" in spawned) return spawned;

      const proc = spawned.proc;

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);

      const [stdout, stderr] = await Promise.all([
        streamToLines(proc.stdout as ReadableStream<Uint8Array>, (line) => {
          logger.info("stream", { stream: "stdout", line });
        }),
        streamToLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
          logger.info("stream", { stream: "stderr", line });
        }),
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timer);

      const output = (stdout + "\n" + stderr).trim();

      if (timedOut) {
        logger.error("timed out", { timeoutMs });
        return { success: false, output, timedOut: true, exitCode: null };
      }

      if (exitCode !== 0) {
        logger.error("failed", { exitCode });
      } else {
        logger.info("completed");
      }

      return { success: exitCode === 0, output, timedOut: false, exitCode };
      });
    },
  };
}
