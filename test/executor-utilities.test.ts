import { describe, test, expect } from "bun:test";
import { streamToLines, spawnOrError } from "../src/pipeline/executor.ts";

describe("streamToLines", () => {
  test("collects all text and calls onLine for each complete line", async () => {
    const lines: string[] = [];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello\nworld\n"));
        controller.close();
      },
    });
    const result = await streamToLines(stream as ReadableStream<Uint8Array>, (line) => lines.push(line));
    expect(result).toBe("hello\nworld\n");
    expect(lines).toEqual(["hello", "world"]);
  });

  test("handles single line without trailing newline", async () => {
    const lines: string[] = [];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("single line"));
        controller.close();
      },
    });
    const result = await streamToLines(stream as ReadableStream<Uint8Array>, (line) => lines.push(line));
    expect(result).toBe("single line");
    expect(lines).toEqual(["single line"]);
  });

  test("handles multiple chunks that split across line boundaries", async () => {
    const lines: string[] = [];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hel"));
        controller.enqueue(new TextEncoder().encode("lo\nwor"));
        controller.enqueue(new TextEncoder().encode("ld\n"));
        controller.close();
      },
    });
    const result = await streamToLines(stream as ReadableStream<Uint8Array>, (line) => lines.push(line));
    expect(result).toBe("hello\nworld\n");
    expect(lines).toEqual(["hello", "world"]);
  });

  test("skips blank lines", async () => {
    const lines: string[] = [];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a\n\n  \nb\n"));
        controller.close();
      },
    });
    await streamToLines(stream as ReadableStream<Uint8Array>, (line) => lines.push(line));
    expect(lines).toEqual(["a", "b"]);
  });

  test("handles empty stream", async () => {
    const lines: string[] = [];
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const result = await streamToLines(stream as ReadableStream<Uint8Array>, (line) => lines.push(line));
    expect(result).toBe("");
    expect(lines).toEqual([]);
  });
});

describe("spawnOrError", () => {
  test("returns proc on successful spawn", () => {
    const result = spawnOrError(["echo", "hello"], { stdout: "pipe", stderr: "pipe" });
    if ("proc" in result) {
      expect(result.proc).toBeDefined();
      result.proc.kill();
    } else {
      expect.unreachable("Expected proc, got error result");
    }
  });

  test("returns error result for non-existent binary", () => {
    const result = spawnOrError(["__nonexistent_binary_that_does_not_exist__12345__"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if ("proc" in result) {
      result.proc.kill();
      expect.unreachable("Expected error result, got proc");
    } else {
      expect(result.success).toBe(false);
      expect(result.output).toContain("Executable not found");
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBeNull();
    }
  });
});
