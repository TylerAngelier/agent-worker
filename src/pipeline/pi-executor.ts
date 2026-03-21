import type { Logger } from "../logger.ts";
import type { CodeExecutor, ExecutorResult } from "./executor.ts";
import { streamToLines } from "./executor.ts";

export function createPiExecutor(): CodeExecutor {
  return {
    name: "pi",
    needsWorktree: true,
    async run(prompt: string, cwd: string, timeoutMs: number, logger: Logger): Promise<ExecutorResult> {
      logger.info("pi started", { timeoutMs });

      const proc = Bun.spawn(["pi", "-p", prompt, "--no-session"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);

      const [stdout, stderr] = await Promise.all([
        streamToLines(proc.stdout as ReadableStream<Uint8Array>, (line) => {
          logger.info("pi", { stream: "stdout", line });
        }),
        streamToLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
          logger.info("pi", { stream: "stderr", line });
        }),
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timer);

      const output = (stdout + "\n" + stderr).trim();

      if (timedOut) {
        logger.error("pi timed out", { timeoutMs });
        return { success: false, output, timedOut: true, exitCode: null };
      }

      if (exitCode !== 0) {
        logger.error("pi failed", { exitCode });
      } else {
        logger.info("pi completed successfully");
      }

      return { success: exitCode === 0, output, timedOut: false, exitCode };
    },
  };
}
