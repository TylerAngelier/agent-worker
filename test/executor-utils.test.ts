import { describe, test, expect, spyOn } from "bun:test";
import { spawnOrError, streamToLines } from "../src/pipeline/executor.ts";

// =============================================================================
// spawnOrError
// =============================================================================

describe("spawnOrError", () => {
  test("returns { proc } when command spawns successfully", () => {
    const result = spawnOrError(["echo", "hello"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect("proc" in result).toBe(true);
    if ("proc" in result) {
      expect(result.proc).toBeDefined();
      expect(typeof result.proc.exited).toBe("object");
      result.proc.kill();
    }
  });

  test("returns ExecutorResult with success:false when executable not found (ENOENT)", () => {
    const result = spawnOrError(["nonexistent-command-xyz-123", "arg"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect("success" in result).toBe(true);
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect(result.output).toContain("Executable not found");
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBeNull();
    }
  });

  test("re-throws errors that are not ENOENT", () => {
    // Create a situation that would throw a non-ENOENT error.
    // Bun.spawn with a directory as command throws with a different code.
    // We'll test via a path that is a directory to trigger a non-ENOENT spawn error.
    expect(() => {
      spawnOrError(["/"], {
        stdout: "pipe",
        stderr: "pipe",
      });
    }).toThrow();
  });

  test("returns { proc } for a command that exits non-zero (still spawns fine)", async () => {
    const result = spawnOrError(["sh", "-c", "exit 42"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect("proc" in result).toBe(true);
    if ("proc" in result) {
      const exitCode = await result.proc.exited;
      expect(exitCode).toBe(42);
    }
  });
});

// =============================================================================
// streamToLines
// =============================================================================

describe("streamToLines", () => {
  test("calls onLine for each complete line and returns full text", async () => {
    const lines: string[] = [];
    const chunks = ["line1\nline2\nline3\n"];
    const stream = createChunkedStream(chunks);

    const result = await streamToLines(stream, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual(["line1", "line2", "line3"]);
    expect(result).toBe("line1\nline2\nline3\n");
  });

  test("handles partial lines across chunk boundaries", async () => {
    const lines: string[] = [];
    const chunks = ["hel", "lo\nwor", "ld\n"];
    const stream = createChunkedStream(chunks);

    const result = await streamToLines(stream, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual(["hello", "world"]);
    expect(result).toBe("hello\nworld\n");
  });

  test("handles trailing text with no final newline", async () => {
    const lines: string[] = [];
    const chunks = ["line1\nline2"];
    const stream = createChunkedStream(chunks);

    const result = await streamToLines(stream, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual(["line1", "line2"]);
    expect(result).toBe("line1\nline2");
  });

  test("returns empty and calls no onLine for empty stream", async () => {
    const lines: string[] = [];
    const stream = createChunkedStream([""]);

    const result = await streamToLines(stream, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual([]);
    expect(result).toBe("");
  });

  test("skips blank/whitespace-only lines", async () => {
    const lines: string[] = [];
    const chunks = ["line1\n   \n\nline2\n"];
    const stream = createChunkedStream(chunks);

    const result = await streamToLines(stream, (line) => {
      lines.push(line);
    });

    // Blank lines are not emitted via onLine, but they are in the result text
    expect(lines).toEqual(["line1", "line2"]);
    expect(result).toBe("line1\n   \n\nline2\n");
  });

  test("handles single large chunk with many lines", async () => {
    const count = 100;
    const content = Array.from({ length: count }, (_, i) => `line-${i}`).join("\n") + "\n";
    const lines: string[] = [];
    const stream = createChunkedStream([content]);

    const result = await streamToLines(stream, (line) => {
      lines.push(line);
    });

    expect(lines.length).toBe(count);
    expect(lines[0]).toBe("line-0");
    expect(lines[count - 1]).toBe(`line-${count - 1}`);
    expect(result).toBe(content);
  });

  test("handles empty chunks interspersed with content", async () => {
    const lines: string[] = [];
    const chunks = ["", "line1\n", "", "line2\n", ""];
    const stream = createChunkedStream(chunks);

    const result = await streamToLines(stream, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual(["line1", "line2"]);
    expect(result).toBe("line1\nline2\n");
  });
});

// =============================================================================
// Test helpers
// =============================================================================

/**
 * Creates a ReadableStream<Uint8Array> from an array of string chunks.
 * Each chunk is encoded as UTF-8 and enqueued sequentially.
 */
function createChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        const data = chunks[index]!;
        controller.enqueue(encoder.encode(data));
        index++;
      } else {
        controller.close();
      }
    },
  });
}
