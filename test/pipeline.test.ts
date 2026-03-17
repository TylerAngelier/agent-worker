import { describe, test, expect } from "bun:test";
import { executePipeline } from "../src/pipeline/pipeline.ts";
import type { CodeExecutor } from "../src/pipeline/executor.ts";
import type { Logger } from "../src/logger.ts";
import type { Ticket } from "../src/providers/types.ts";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const ticket: Ticket = {
  id: "uuid-1",
  identifier: "ENG-100",
  title: "Test ticket",
  description: "Do something",
};

function mockExecutor(overrides?: Partial<CodeExecutor>): CodeExecutor {
  return {
    name: "mock",
    run: async () => ({
      success: true,
      output: "mock output",
      timedOut: false,
      exitCode: 0,
    }),
    ...overrides,
  };
}

function failingExecutor(): CodeExecutor {
  return {
    name: "mock",
    run: async () => ({
      success: false,
      output: "error output",
      timedOut: false,
      exitCode: 1,
    }),
  };
}

describe("executePipeline", () => {
  test("fails on pre-hook failure before reaching executor", async () => {
    const result = await executePipeline({
      ticket,
      preHooks: ["exit 1"],
      postHooks: [],
      repoCwd: "/tmp",
      executor: mockExecutor(),
      timeoutMs: 5000,
      logger: noopLogger,
    });
    expect(result.success).toBe(false);
    expect(result.stage).toBe("pre-hook");
  });

  test("returns error details from failed pre-hook", async () => {
    const result = await executePipeline({
      ticket,
      preHooks: ["echo 'setup ok'", "sh -c 'echo bad >&2; exit 2'"],
      postHooks: [],
      repoCwd: "/tmp",
      executor: mockExecutor(),
      timeoutMs: 5000,
      logger: noopLogger,
    });
    expect(result.success).toBe(false);
    expect(result.stage).toBe("pre-hook");
    expect(result.error).toContain("exited with code 2");
  });

  test("succeeds when all hooks pass and executor succeeds", async () => {
    const result = await executePipeline({
      ticket,
      preHooks: ["echo pre"],
      postHooks: ["echo post"],
      repoCwd: "/tmp",
      executor: mockExecutor(),
      timeoutMs: 5000,
      logger: noopLogger,
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("mock output");
  });

  test("fails at executor stage when executor fails", async () => {
    const result = await executePipeline({
      ticket,
      preHooks: [],
      postHooks: [],
      repoCwd: "/tmp",
      executor: failingExecutor(),
      timeoutMs: 5000,
      logger: noopLogger,
    });
    expect(result.success).toBe(false);
    expect(result.stage).toBe("executor");
  });

  test("does not run post-hooks when executor fails", async () => {
    let postHookRan = false;
    const result = await executePipeline({
      ticket,
      preHooks: [],
      postHooks: ["echo post"],
      repoCwd: "/tmp",
      executor: failingExecutor(),
      timeoutMs: 5000,
      logger: noopLogger,
    });
    expect(result.success).toBe(false);
    expect(result.stage).toBe("executor");
  });
});
