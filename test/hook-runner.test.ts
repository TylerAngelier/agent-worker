import { describe, test, expect } from "bun:test";
import { runHooks } from "../src/pipeline/hook-runner.ts";
import type { TaskVars } from "../src/pipeline/interpolate.ts";
import { initLogger } from "../src/logger.ts";

// Suppress log noise during tests
initLogger({ level: "error" });

const testVars: TaskVars = {
  id: "TEST-1",
  title: "test-task",
  raw_title: "Test Task",
  branch: "agent/task-TEST-1",
  worktree: "/tmp/test-worktree",
};

describe("runHooks", () => {
  test("returns success for empty commands array", async () => {
    const result = await runHooks([], "/tmp", testVars);
    expect(result.success).toBe(true);
  });

  test("returns success when all commands succeed", async () => {
    const result = await runHooks(
      ["echo hello", "echo world"],
      "/tmp",
      testVars,
    );
    expect(result.success).toBe(true);
  });

  test("returns success for a single successful command", async () => {
    const result = await runHooks(["echo done"], "/tmp", testVars);
    expect(result.success).toBe(true);
  });

  test("fails on non-zero exit code", async () => {
    const result = await runHooks(["sh -c 'exit 42'"], "/tmp", testVars);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
    expect(result.failedCommand).toBeDefined();
  });

  test("fail-fast: stops on first failure and does not run subsequent commands", async () => {
    const result = await runHooks(
      ["sh -c 'exit 1'", "echo should-not-run"],
      "/tmp",
      testVars,
    );
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).not.toContain("should-not-run");
  });

  test("interpolates template variables in commands", async () => {
    const result = await runHooks(
      ["echo {id}"],
      "/tmp",
      testVars,
    );
    expect(result.success).toBe(true);
  });

  test("captures stderr output on failure", async () => {
    const result = await runHooks(
      ["sh -c 'echo custom error message >&2; exit 3'"],
      "/tmp",
      testVars,
    );
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("custom error message");
  });

  test("falls back to stdout when stderr is empty on failure", async () => {
    const result = await runHooks(
      ["sh -c 'echo stdout-only-failure; exit 5'"],
      "/tmp",
      testVars,
    );
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(5);
    expect(result.output).toContain("stdout-only-failure");
  });
});
