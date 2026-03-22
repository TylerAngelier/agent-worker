import { describe, test, expect } from "bun:test";
import { createOpencodeExecutor } from "../src/pipeline/opencode-executor.ts";

describe("createOpencodeExecutor", () => {
  test("returns a CodeExecutor with name 'opencode'", () => {
    const executor = createOpencodeExecutor();
    expect(executor.name).toBe("opencode");
  });

  test("needsWorktree is true", () => {
    const executor = createOpencodeExecutor();
    expect(executor.needsWorktree).toBe(true);
  });

  test("accepts model option", () => {
    const executor = createOpencodeExecutor({ model: "anthropic/claude-sonnet-4" });
    expect(executor.name).toBe("opencode");
    expect(executor.needsWorktree).toBe(true);
  });

  test("returns correct shape on failure (opencode not installed)", async () => {
    const executor = createOpencodeExecutor();
    const result = await executor.run("test prompt", "/tmp", 2000);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("exitCode");
    expect(typeof result.success).toBe("boolean");
  });

  test("returns correct shape with model option (opencode not installed)", async () => {
    const executor = createOpencodeExecutor({ model: "anthropic/claude-sonnet-4" });
    const result = await executor.run("test prompt", "/tmp", 2000);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("exitCode");
  });
});
