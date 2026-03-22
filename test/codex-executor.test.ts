import { describe, test, expect } from "bun:test";
import { createCodexExecutor } from "../src/pipeline/codex-executor.ts";

describe("createCodexExecutor", () => {
  test("returns a CodeExecutor with name 'codex'", () => {
    const executor = createCodexExecutor();
    expect(executor.name).toBe("codex");
  });

  test("needsWorktree is false", () => {
    const executor = createCodexExecutor();
    expect(executor.needsWorktree).toBe(false);
  });

  test("accepts model option", () => {
    const executor = createCodexExecutor({ model: "o3" });
    expect(executor.name).toBe("codex");
    expect(executor.needsWorktree).toBe(false);
  });

  test("returns correct shape on failure (codex not installed)", async () => {
    const executor = createCodexExecutor();
    const result = await executor.run("test prompt", "/tmp", 2000);
    // codex CLI likely not installed in test env
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("exitCode");
    expect(typeof result.success).toBe("boolean");
  });

  test("returns correct shape with model option (codex not installed)", async () => {
    const executor = createCodexExecutor({ model: "o3" });
    const result = await executor.run("test prompt", "/tmp", 2000);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("exitCode");
  });
});
