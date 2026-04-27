import { describe, test, expect } from "bun:test";
import { createExecutor, streamToLines, spawnOrError } from "../src/pipeline/executor.ts";
import type { Config } from "../src/config.ts";

describe("createExecutor", () => {
  test("creates a claude executor for type 'claude'", () => {
    const executor = createExecutor({ type: "claude", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 } as Config["executor"]);
    expect(executor.name).toBe("claude");
    expect(executor.needsWorktree).toBe(true);
  });

  test("creates a claude executor with model", () => {
    const executor = createExecutor({ type: "claude", model: "sonnet-4", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 } as Config["executor"]);
    expect(executor.name).toBe("claude");
  });

  test("creates a codex executor for type 'codex'", () => {
    const executor = createExecutor({ type: "codex", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 } as Config["executor"]);
    expect(executor.name).toBe("codex");
    expect(executor.needsWorktree).toBe(false);
  });

  test("creates an opencode executor for type 'opencode'", () => {
    const executor = createExecutor({ type: "opencode", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 } as Config["executor"]);
    expect(executor.name).toBe("opencode");
    expect(executor.needsWorktree).toBe(true);
  });

  test("creates a pi executor for type 'pi'", () => {
    const executor = createExecutor({ type: "pi", dangerously_skip_permissions: true, timeout_seconds: 300, retries: 0 } as Config["executor"]);
    expect(executor.name).toBe("pi");
    expect(executor.needsWorktree).toBe(true);
  });

  test("creates a docker executor for type 'container'", () => {
    const executor = createExecutor({
      type: "container",
      image: "node:20",
      command: ["node", "-e", "console.log('hi')"],
      network: "none",
      env: {},
      mounts: [],
      timeout_seconds: 300,
      retries: 0,
    } as Config["executor"]);
    expect(executor.name).toBe("docker");
    expect(executor.needsWorktree).toBe(true);
  });

  test("throws on unknown executor type", () => {
    expect(() =>
      createExecutor({ type: "unknown" } as never)
    ).toThrow(/unknown executor type/i);
  });
});

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

  test("collects full text and calls onLine for each non-empty line", async () => {
    const lines: string[] = [];
    const result = await streamToLines(makeStream("hello\nworld\n"), (l) => lines.push(l));
    expect(result).toBe("hello\nworld\n");
    expect(lines).toEqual(["hello", "world"]);
  });

  test("skips blank lines", async () => {
    const lines: string[] = [];
    await streamToLines(makeStream("a\n\nb\n"), (l) => lines.push(l));
    expect(lines).toEqual(["a", "b"]);
  });

  test("handles single line without trailing newline", async () => {
    const lines: string[] = [];
    const result = await streamToLines(makeStream("only"), (l) => lines.push(l));
    expect(result).toBe("only");
    expect(lines).toEqual(["only"]);
  });

  test("handles empty stream", async () => {
    const lines: string[] = [];
    const result = await streamToLines(makeStream(""), (l) => lines.push(l));
    expect(result).toBe("");
    expect(lines).toEqual([]);
  });
});

describe("spawnOrError", () => {
  test("returns error result for missing executable", () => {
    const result = spawnOrError(["nonexistent_binary_xyz_123"], {});
    expect("success" in result && result.success === false).toBe(true);
    if ("success" in result) {
      expect(result.output).toContain("nonexistent_binary_xyz_123");
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBeNull();
    }
  });

  test("returns proc for valid executable", () => {
    const result = spawnOrError(["echo", "hello"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect("proc" in result).toBe(true);
    if ("proc" in result) {
      result.proc.kill();
    }
  });
});
