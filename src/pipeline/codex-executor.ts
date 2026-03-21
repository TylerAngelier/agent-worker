import type { Logger } from "../logger.ts";
import type { CodeExecutor, ExecutorResult } from "./executor.ts";
import { streamToLines, spawnOrError } from "./executor.ts";

export function createCodexExecutor(): CodeExecutor {
  return {
    name: "codex",
    needsWorktree: false,
    async run(prompt: string, cwd: string, timeoutMs: number, logger: Logger): Promise<ExecutorResult> {
      logger.info("Codex started", { timeoutMs });

      const spawned = spawnOrError(
        ["codex", "exec", "--full-auto", prompt],
        { cwd, stdout: "pipe", stderr: "pipe" }
      );

      if ("success" in spawned) return spawned;

      const proc = spawned.proc;

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);

      const [stdout, stderr] = await Promise.all([
        streamToLines(proc.stdout as ReadableStream<Uint8Array>, (line) => {
          logger.info("codex", { stream: "stdout", line });
        }),
        streamToLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
          logger.info("codex", { stream: "stderr", line });
        }),
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timer);

      const output = (stdout + "\n" + stderr).trim();

      if (timedOut) {
        logger.error("Codex timed out", { timeoutMs });
        return { success: false, output, timedOut: true, exitCode: null };
      }

      if (exitCode !== 0) {
        logger.error("Codex failed", { exitCode });
      } else {
        logger.info("Codex completed successfully");
      }

      return { success: exitCode === 0, output, timedOut: false, exitCode };
    },
  };
}
