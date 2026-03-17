import type { Logger } from "../logger.ts";
import type { Ticket } from "../providers/types.ts";
import type { CodeExecutor } from "./executor.ts";
import { buildTaskVars } from "./interpolate.ts";
import { runHooks } from "./hook-runner.ts";

export type PipelineResult = {
  success: boolean;
  stage?: "pre-hook" | "executor" | "post-hook";
  error?: string;
  output?: string;
};

export async function executePipeline(options: {
  ticket: Ticket;
  preHooks: string[];
  postHooks: string[];
  repoCwd: string;
  executor: CodeExecutor;
  timeoutMs: number;
  logger: Logger;
}): Promise<PipelineResult> {
  const { ticket, preHooks, postHooks, repoCwd, executor, timeoutMs, logger } = options;
  const vars = buildTaskVars(ticket);

  // Pre-hooks
  if (preHooks.length > 0) {
    const preResult = await runHooks(preHooks, repoCwd, vars, logger);
    if (!preResult.success) {
      return {
        success: false,
        stage: "pre-hook",
        error: `Command "${preResult.failedCommand}" exited with code ${preResult.exitCode}: ${preResult.output}`,
      };
    }
  }

  // Code executor
  const prompt = `Linear ticket: ${ticket.title}\n\n${ticket.description || "No description provided."}`;
  const execResult = await executor.run(prompt, repoCwd, timeoutMs, logger);
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
    const postResult = await runHooks(postHooks, repoCwd, vars, logger);
    if (!postResult.success) {
      return {
        success: false,
        stage: "post-hook",
        error: `Command "${postResult.failedCommand}" exited with code ${postResult.exitCode}: ${postResult.output}`,
      };
    }
  }

  return { success: true, output: execResult.output };
}
