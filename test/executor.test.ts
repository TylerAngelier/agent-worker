import { describe, test, expect, beforeEach } from "bun:test";
import { streamToLines, createExecutor } from "../src/pipeline/executor.ts";
import { initLogger } from "../src/logger.ts";

beforeEach(() => {
  initLogger({ level: "error" });
});

// --- streamToLines ---

/**
 * Creates a ReadableStream that enqueues the given text chunks.
 */
function textStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("streamToLines", () => {
  test("emits each line via the callback", async () => {
    const lines: string[] = [];
    const result = await streamToLines(textStream("hello\nworld\n"), (line) => {
      lines.push(line);
    });
    expect(lines).toEqual(["hello", "world"]);
    expect(result).toBe("hello\nworld\n");
  });

  test("handles lines split across chunks", async () => {
    const lines: string[] = [];
    const result = await streamToLines(textStream("hel", "lo\nwor", "ld\n"), (line) => {
      lines.push(line);
    });
    expect(lines).toEqual(["hello", "world"]);
    expect(result).toBe("hello\nworld\n");
  });

  test("skips empty lines", async () => {
    const lines: string[] = [];
    await streamToLines(textStream("a\n\nb\n"), (line) => {
      lines.push(line);
    });
    expect(lines).toEqual(["a", "b"]);
  });

  test("skips whitespace-only lines", async () => {
    const lines: string[] = [];
    await streamToLines(textStream("a\n   \nb\n"), (line) => {
      lines.push(line);
    });
    expect(lines).toEqual(["a", "b"]);
  });

  test("emits trailing content after final newline", async () => {
    const lines: string[] = [];
    await streamToLines(textStream("hello\nworld"), (line) => {
      lines.push(line);
    });
    expect(lines).toEqual(["hello", "world"]);
  });

  test("handles single line without trailing newline", async () => {
    const lines: string[] = [];
    const result = await streamToLines(textStream("just one line"), (line) => {
      lines.push(line);
    });
    expect(lines).toEqual(["just one line"]);
    expect(result).toBe("just one line");
  });

  test("handles empty stream", async () => {
    const lines: string[] = [];
    const result = await streamToLines(textStream(), (line) => {
      lines.push(line);
    });
    expect(lines).toEqual([]);
    expect(result).toBe("");
  });

  test("handles multi-byte unicode characters split across chunks", async () => {
    const lines: string[] = [];
    // "café" — é is U+00E9, encoded as two bytes in UTF-8. Split mid-character.
    const encoder = new TextEncoder();
    const cafeBytes = encoder.encode("café\n");
    // Split after the first 3 bytes ("caf" = 3 bytes, é = 2 bytes)
    const chunk1 = cafeBytes.slice(0, 3);
    const chunk2 = cafeBytes.slice(3);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const result = await streamToLines(stream, (line) => {
      lines.push(line);
    });
    expect(lines).toEqual(["café"]);
    expect(result).toContain("café");
  });

  test("preserves original chunk content in return value", async () => {
    const chunks = ["line1\nline2\n", "line3\n"];
    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(new TextEncoder().encode(c));
        }
        controller.close();
      },
    });

    const result = await streamToLines(stream, () => {});
    expect(result).toBe("line1\nline2\nline3\n");
  });
});

// --- createExecutor ---

describe("createExecutor", () => {
  test("returns claude executor for type claude", () => {
    const executor = createExecutor({
      type: "claude",
      dangerously_skip_permissions: true,
      timeout_seconds: 300,
      retries: 0,
    });
    expect(executor.name).toBe("claude");
    expect(executor.needsWorktree).toBe(true);
    expect(typeof executor.run).toBe("function");
  });

  test("returns claude executor with model config", () => {
    const executor = createExecutor({
      type: "claude",
      model: "claude-sonnet-4-20250514",
      dangerously_skip_permissions: false,
      timeout_seconds: 600,
      retries: 1,
    });
    expect(executor.name).toBe("claude");
    expect(typeof executor.run).toBe("function");
  });

  test("returns codex executor for type codex", () => {
    const executor = createExecutor({
      type: "codex",
      dangerously_skip_permissions: true,
      timeout_seconds: 300,
      retries: 0,
    });
    expect(executor.name).toBe("codex");
    expect(executor.needsWorktree).toBe(false);
    expect(typeof executor.run).toBe("function");
  });

  test("returns codex executor with model config", () => {
    const executor = createExecutor({
      type: "codex",
      model: "gpt-5",
      dangerously_skip_permissions: true,
      timeout_seconds: 300,
      retries: 0,
    });
    expect(executor.name).toBe("codex");
  });

  test("returns opencode executor for type opencode", () => {
    const executor = createExecutor({
      type: "opencode",
      dangerously_skip_permissions: true,
      timeout_seconds: 300,
      retries: 0,
    });
    expect(executor.name).toBe("opencode");
    expect(typeof executor.run).toBe("function");
  });

  test("returns pi executor for type pi", () => {
    const executor = createExecutor({
      type: "pi",
      dangerously_skip_permissions: true,
      timeout_seconds: 300,
      retries: 0,
    });
    expect(executor.name).toBe("pi");
    expect(typeof executor.run).toBe("function");
  });

  test("returns docker executor for type container", () => {
    const executor = createExecutor({
      type: "container",
      image: "node:22",
      command: ["claude"],
      network: "none",
      env: {},
      mounts: [],
      timeout_seconds: 300,
      retries: 0,
    });
    expect(executor.name).toBe("docker");
    expect(executor.needsWorktree).toBe(true);
    expect(typeof executor.run).toBe("function");
  });

  test("throws for unknown executor type", () => {
    expect(() =>
      createExecutor({
        type: "unknown" as "claude",
        dangerously_skip_permissions: true,
        timeout_seconds: 300,
        retries: 0,
      })
    ).toThrow("Unknown executor type");
  });
});
