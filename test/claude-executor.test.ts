import { describe, test, expect } from "bun:test";
import { createClaudeExecutor } from "../src/pipeline/claude-executor.ts";

describe("createClaudeExecutor", () => {
  test("returns a CodeExecutor with name 'claude'", () => {
    const executor = createClaudeExecutor();
    expect(executor.name).toBe("claude");
  });

  test("accepts model option", () => {
    const executor = createClaudeExecutor({ model: "claude-sonnet-4-20250514" });
    expect(executor.name).toBe("claude");
  });

  test("returns correct shape on failure (claude not installed)", async () => {
    const executor = createClaudeExecutor();
    const result = await executor.run("test prompt", "/tmp", 2000);
    // claude CLI likely not installed in test env
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("exitCode");
    expect(typeof result.success).toBe("boolean");
  });

  test("returns correct shape with model option (claude not installed)", async () => {
    const executor = createClaudeExecutor({ model: "claude-sonnet-4-20250514" });
    const result = await executor.run("test prompt", "/tmp", 2000);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("exitCode");
  });
});
