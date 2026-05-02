/** @module src/pipeline/pi-executor — Pi coding agent executor implementation */

import type { CodeExecutor, ExecutorResult } from "./executor.ts";
import { streamToLines, spawnOrError } from "./executor.ts";
import { log, time } from "../logger.ts";

/** Options for creating a Pi executor. */
export interface PiExecutorOptions {
  /** Optional model identifier passed via --model flag. */
  model?: string;
}

/**
 * Creates a Pi coding agent executor.
 *
 * Uses `pi [--model <model>] -p <prompt> --no-session`. The `--no-session` flag ensures
 * each invocation is stateless (no session file persisted).
 * Requires an isolated worktree (`needsWorktree: true`).
 *
 * @param options - Optional configuration including model selection.
 * @returns {@link CodeExecutor} configured for Pi
 */
export function createPiExecutor(options?: PiExecutorOptions): CodeExecutor {
  const execLog = log.child("pi");
  return {
    name: "pi",
    needsWorktree: true,
    async run(prompt: string, cwd: string, timeoutMs: number): Promise<ExecutorResult> {
      return time("pi", async () => {
      execLog.info("pi started", { timeoutMs, model: options?.model });

      const args = ["pi"];
      if (options?.model) {
        args.push("--model", options.model);
      }
      args.push("-p", prompt, "--no-session");

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
          execLog.info("pi", { stream: "stdout", line });
        }),
        streamToLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
          execLog.info("pi", { stream: "stderr", line });
        }),
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timer);

      const output = (stdout + "\n" + stderr).trim();

      if (timedOut) {
        execLog.error("pi timed out", { timeoutMs });
        return { success: false, output, timedOut: true, exitCode: null };
      }

      if (exitCode !== 0) {
        execLog.error("pi failed", { exitCode });
      } else {
        execLog.info("pi completed successfully");
      }

      return { success: exitCode === 0, output, timedOut: false, exitCode };
      });
    },
  };
}
