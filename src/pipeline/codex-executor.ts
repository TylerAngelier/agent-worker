/** @module src/pipeline/codex-executor — OpenAI Codex executor implementation */

import type { CodeExecutor, ExecutorResult } from "./executor.ts";
import { streamToLines, spawnOrError } from "./executor.ts";
import { log, time } from "../logger.ts";

/** Options for creating a Codex executor. */
export interface CodexExecutorOptions {
  /** Optional model identifier passed via --model flag. */
  model?: string;
}

/**
 * Creates an OpenAI Codex executor.
 *
 * Uses `codex exec [--model <model>] --full-auto <prompt>`.
 * Does NOT require a worktree (`needsWorktree: false`) because Codex
 * manages its own git isolation internally.
 *
 * @param options - Optional configuration including model selection.
 * @returns {@link CodeExecutor} configured for Codex
 */
export function createCodexExecutor(options?: CodexExecutorOptions): CodeExecutor {
  const execLog = log.child("codex");
  return {
    name: "codex",
    needsWorktree: false,
    async run(prompt: string, cwd: string, timeoutMs: number): Promise<ExecutorResult> {
      return time("codex", async () => {
      execLog.info("Codex started", { timeoutMs, model: options?.model });

      const args = ["codex", "exec"];
      if (options?.model) {
        args.push("--model", options.model);
      }
      args.push("--full-auto", prompt);

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
          execLog.info("codex", { stream: "stdout", line });
        }),
        streamToLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
          execLog.info("codex", { stream: "stderr", line });
        }),
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timer);

      const output = (stdout + "\n" + stderr).trim();

      if (timedOut) {
        execLog.error("Codex timed out", { timeoutMs });
        return { success: false, output, timedOut: true, exitCode: null };
      }

      if (exitCode !== 0) {
        execLog.error("Codex failed", { exitCode });
      } else {
        execLog.info("Codex completed successfully");
      }

      return { success: exitCode === 0, output, timedOut: false, exitCode };
      });
    },
  };
}
