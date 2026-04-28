import { describe, test, expect } from "bun:test";
import { spawnOrError, streamToLines, createExecutor } from "../src/pipeline/executor.ts";
import type { ExecutorResult } from "../src/pipeline/executor.ts";

// --- spawnOrError ---

describe("spawnOrError", () => {
  test("returns { proc } for a valid command", () => {
    const result = spawnOrError(["echo", "hello"], { stdout: "pipe", stderr: "pipe" });
    expect("proc" in result).toBe(true);
    if ("proc" in result) {
      result.proc.kill();
    }
  });

  test("returns ExecutorResult on ENOENT (missing binary)", () => {
    const result = spawnOrError(
      ["__nonexistent_binary_that_does_not_exist_12345__"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect("proc" in result).toBe(false);
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect(result.output).toContain("Executable not found");
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBeNull();
    }
  });
});

// --- streamToLines ---

describe("streamToLines", () => {
  function makeStream(text: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  }

  test("reads full text and calls onLine for each line", async () => {
    const lines: string[] = [];
    const text = await streamToLines(makeStream("line1\nline2\nline3"), (l) => lines.push(l));
    expect(text).toBe("line1\nline2\nline3");
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  test("skips blank lines", async () => {
    const lines: string[] = [];
    await streamToLines(makeStream("a\n\nb\n"), (l) => lines.push(l));
    expect(lines).toEqual(["a", "b"]);
  });

  test("handles empty stream", async () => {
    const lines: string[] = [];
    const text = await streamToLines(makeStream(""), (l) => lines.push(l));
    expect(text).toBe("");
    expect(lines).toEqual([]);
  });

  test("handles single line without trailing newline", async () => {
    const lines: string[] = [];
    await streamToLines(makeStream("hello"), (l) => lines.push(l));
    expect(lines).toEqual(["hello"]);
  });
});

// --- createExecutor ---

describe("createExecutor", () => {
  test("creates claude executor", () => {
    const executor = createExecutor({ type: "claude", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 });
    expect(executor.name).toBe("claude");
    expect(executor.needsWorktree).toBe(true);
  });

  test("creates codex executor", () => {
    const executor = createExecutor({ type: "codex", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 });
    expect(executor.name).toBe("codex");
    expect(executor.needsWorktree).toBe(false);
  });

  test("creates opencode executor", () => {
    const executor = createExecutor({ type: "opencode", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 });
    expect(executor.name).toBe("opencode");
    expect(executor.needsWorktree).toBe(true);
  });

  test("creates pi executor", () => {
    const executor = createExecutor({ type: "pi", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 });
    expect(executor.name).toBe("pi");
    expect(executor.needsWorktree).toBe(true);
  });

  test("creates container executor", () => {
    const executor = createExecutor({
      type: "container",
      image: "test:latest",
      command: ["run"],
      timeout_seconds: 300,
      retries: 0,
      network: "none",
      env: {},
      mounts: [],
    });
    expect(executor.name).toBe("docker");
    expect(executor.needsWorktree).toBe(true);
  });
});
