/** @module src/pipeline/opencode-executor — OpenCode executor implementation */

import type { CodeExecutor, ExecutorResult } from "./executor.ts";
import { streamToLines, spawnOrError } from "./executor.ts";
import { log as logOuter } from "../logger.ts";

const log = logOuter.child("opencode");

/** Options for creating an OpenCode executor. */
export interface OpenCodeExecutorOptions {
  /** Optional model identifier passed via --model flag. */
  model?: string;
}

/**
 * Creates an OpenCode executor.
 *
 * Uses `opencode [--model <model>] -p <prompt>`.
 * Requires an isolated worktree (`needsWorktree: true`).
 *
 * @param options - Optional configuration including model selection.
 * @returns {@link CodeExecutor} configured for OpenCode
 */
export function createOpencodeExecutor(options?: OpenCodeExecutorOptions): CodeExecutor {
  return {
    name: "opencode",
    needsWorktree: true,
    async run(prompt: string, cwd: string, timeoutMs: number): Promise<ExecutorResult> {
      log.info("opencode started", { timeoutMs, model: options?.model });

      const args = ["opencode"];
      if (options?.model) {
        args.push("--model", options.model);
      }
      args.push("-p", prompt);

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
          log.info("opencode", { stream: "stdout", line });
        }),
        streamToLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
          log.info("opencode", { stream: "stderr", line });
        }),
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timer);

      const output = (stdout + "\n" + stderr).trim();

      if (timedOut) {
        log.error("opencode timed out", { timeoutMs });
        return { success: false, output, timedOut: true, exitCode: null };
      }

      if (exitCode !== 0) {
        log.error("opencode failed", { exitCode });
      } else {
        log.info("opencode completed successfully");
      }

      return { success: exitCode === 0, output, timedOut: false, exitCode };
    },
  };
}
