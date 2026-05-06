/**
 * @module src/pipeline/hook-runner — Sequential shell hook execution with fail-fast semantics.
 */
import { interpolate, type TaskVars } from "./interpolate.ts";
import { log as logOuter, time } from "../logger.ts";

export type HookResult = {
  /** Whether all hook commands completed successfully. */
  success: boolean;
  /** The shell command that failed (undefined on success). */
  failedCommand?: string;
  /** Exit code of the failed command. */
  exitCode?: number;
  /** Stderr or stdout from the failed command. */
  output?: string;
};

/**
 * Runs shell commands sequentially via `sh -c`. Stops on first failure (fail-fast).
 * Template variables in commands are interpolated before execution.
 * @param commands - Array of shell command strings.
 * @param cwd - Working directory for command execution.
 * @param vars - Template variables for interpolation.
 * @returns HookResult indicating success or which command failed.
 */
export async function runHooks(
  commands: string[],
  cwd: string,
  vars: TaskVars,
): Promise<HookResult> {
  const logger = logOuter.child("hook");

  for (const raw of commands) {
    const command = interpolate(raw, vars);
    logger.info("running", { command });

    const result = await time("hook.command", async () => {
      const proc = Bun.spawn(["sh", "-c", command], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      return { exitCode, stdout, stderr };
    });

    logger.debug("output", { command, stdout: result.stdout, stderr: result.stderr });

    if (result.exitCode !== 0) {
      const output = (result.stderr || result.stdout).trim();
      logger.error("failed", { command, exitCode: result.exitCode, output });
      return { success: false, failedCommand: command, exitCode: result.exitCode, output };
    }
  }

  return { success: true };
}
