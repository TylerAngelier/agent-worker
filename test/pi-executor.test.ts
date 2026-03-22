import { describe, test, expect } from "bun:test";
import { createPiExecutor } from "../src/pipeline/pi-executor.ts";

describe("createPiExecutor", () => {
  test("returns a CodeExecutor with name 'pi'", () => {
    const executor = createPiExecutor();
    expect(executor.name).toBe("pi");
  });

  test("needsWorktree is true", () => {
    const executor = createPiExecutor();
    expect(executor.needsWorktree).toBe(true);
  });

  test("accepts model option", () => {
    const executor = createPiExecutor({ model: "claude-sonnet-4" });
    expect(executor.name).toBe("pi");
    expect(executor.needsWorktree).toBe(true);
  });

  test("returns correct shape on failure (pi not installed)", async () => {
    const executor = createPiExecutor();
    const result = await executor.run("test prompt", "/tmp", 2000);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("exitCode");
    expect(typeof result.success).toBe("boolean");
  });

  test("returns correct shape with model option (pi not installed)", async () => {
    const executor = createPiExecutor({ model: "claude-sonnet-4" });
    const result = await executor.run("test prompt", "/tmp", 2000);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("exitCode");
  });
});
