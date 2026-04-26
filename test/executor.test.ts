import { describe, test, expect } from "bun:test";
import { spawnOrError, streamToLines, createExecutor } from "../src/pipeline/executor.ts";
import type { Config } from "../src/config.ts";

describe("spawnOrError", () => {
  test("returns proc on valid command", () => {
    const result = spawnOrError(["echo", "hello"], {});
    expect(result).toHaveProperty("proc");
    if ("proc" in result) {
      result.proc.kill();
    }
  });

  test("returns failure result for non-existent binary", () => {
    const result = spawnOrError(["__nonexistent_binary_xyz__"], {});
    expect(result).not.toHaveProperty("proc");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect(result.output).toContain("Executable not found");
    }
  });
});

describe("streamToLines", () => {
  test("calls onLine for each line and returns full text", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("line1\nline2\n"));
        controller.enqueue(encoder.encode("line3\n"));
        controller.close();
      },
    });

    const lines: string[] = [];
    const text = await streamToLines(stream as ReadableStream<Uint8Array>, (line) => lines.push(line));

    expect(text).toBe("line1\nline2\nline3\n");
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  test("handles partial line at end of stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("partial"));
        controller.close();
      },
    });

    const lines: string[] = [];
    await streamToLines(stream as ReadableStream<Uint8Array>, (line) => lines.push(line));

    expect(lines).toEqual(["partial"]);
  });

  test("skips blank lines", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("a\n\nb\n"));
        controller.close();
      },
    });

    const lines: string[] = [];
    await streamToLines(stream as ReadableStream<Uint8Array>, (line) => lines.push(line));

    expect(lines).toEqual(["a", "b"]);
  });
});

describe("createExecutor", () => {
  const nativeBase = {
    dangerously_skip_permissions: true,
    timeout_seconds: 300,
    retries: 0,
  } as const;

  test("creates claude executor", () => {
    const executor = createExecutor({ type: "claude", ...nativeBase });
    expect(executor.name).toBe("claude");
  });

  test("creates codex executor", () => {
    const executor = createExecutor({ type: "codex", ...nativeBase });
    expect(executor.name).toBe("codex");
  });

  test("creates opencode executor", () => {
    const executor = createExecutor({ type: "opencode", ...nativeBase });
    expect(executor.name).toBe("opencode");
  });

  test("creates pi executor", () => {
    const executor = createExecutor({ type: "pi", ...nativeBase });
    expect(executor.name).toBe("pi");
  });

  test("creates container executor", () => {
    const executor = createExecutor({
      type: "container",
      image: "test:latest",
      command: ["echo"],
      network: "none",
      env: {},
      mounts: [],
      timeout_seconds: 300,
      retries: 0,
    });
    expect(executor.name).toBe("docker");
  });

  test("throws for unknown executor type", () => {
    // Bypass TS by casting
    expect(() => createExecutor({ type: "unknown" } as any)).toThrow("Unknown executor type");
  });
});
