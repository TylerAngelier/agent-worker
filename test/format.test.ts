import { describe, test, expect } from "bun:test";
import { colors, formatConsoleLine } from "../src/format.ts";

// Strip ANSI escape codes for assertions
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("colors", () => {
  test("bold wraps text in bold escape", () => {
    const result = colors.bold("hello");
    expect(strip(result)).toBe("hello");
    expect(result).toContain("\x1b[1m");
  });

  test("red wraps text in red escape", () => {
    const result = colors.red("err");
    expect(strip(result)).toBe("err");
    expect(result).toContain("\x1b[31m");
  });

  test("green wraps text in green escape", () => {
    const result = colors.green("ok");
    expect(strip(result)).toBe("ok");
    expect(result).toContain("\x1b[32m");
  });

  test("yellow wraps text in yellow escape", () => {
    const result = colors.yellow("warn");
    expect(strip(result)).toBe("warn");
    expect(result).toContain("\x1b[33m");
  });

  test("blue wraps text in blue escape", () => {
    const result = colors.blue("info");
    expect(strip(result)).toBe("info");
    expect(result).toContain("\x1b[34m");
  });

  test("cyan wraps text in cyan escape", () => {
    const result = colors.cyan("tag");
    expect(strip(result)).toBe("tag");
    expect(result).toContain("\x1b[36m");
  });

  test("gray wraps text in gray escape", () => {
    const result = colors.gray("dim");
    expect(strip(result)).toBe("dim");
    expect(result).toContain("\x1b[90m");
  });

  test("dim wraps text in dim escape", () => {
    const result = colors.dim("faint");
    expect(strip(result)).toBe("faint");
    expect(result).toContain("\x1b[2m");
  });
});

describe("formatConsoleLine", () => {
  test("formats a basic info message", () => {
    const result = formatConsoleLine("info", "Server started");
    const plain = strip(result);
    expect(plain).toContain("INFO");
    expect(plain).toContain("Server started");
  });

  test("includes a timestamp in HH:MM:SS format", () => {
    const result = strip(formatConsoleLine("info", "test"));
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test("includes context as key=value pairs", () => {
    const result = strip(formatConsoleLine("debug", "Fetched tickets", { count: 5, provider: "linear" }));
    expect(result).toContain("count=5");
    expect(result).toContain("provider=linear");
  });

  test("includes component tag when provided", () => {
    const result = strip(formatConsoleLine("info", "Connected", { component: "provider:linear" }));
    expect(result).toContain("[provider:linear]");
    expect(result).toContain("Connected");
  });

  test("excludes component from key=value context", () => {
    const result = strip(formatConsoleLine("info", "msg", { component: "test", key: "val" }));
    expect(result).toContain("key=val");
    // component should only appear as tag, not as key=value
    expect(result).not.toMatch(/component=test/);
  });

  test("handles claude bare output lines", () => {
    const result = formatConsoleLine("info", "claude", { line: "writing file..." });
    const plain = strip(result);
    expect(plain).toContain("writing file...");
    expect(plain).toContain("│");
    expect(plain).not.toContain("INFO");
  });

  test("warn level uses WARN badge", () => {
    const result = strip(formatConsoleLine("warn", "Slow response"));
    expect(result).toContain("WARN");
  });

  test("error level uses ERROR badge", () => {
    const result = strip(formatConsoleLine("error", "Crashed"));
    expect(result).toContain("ERROR");
  });

  test("handles empty context", () => {
    const result = strip(formatConsoleLine("info", "No ctx"));
    expect(result).toContain("No ctx");
  });

  test("unknown level falls back to gray badge", () => {
    const result = strip(formatConsoleLine("trace", "test"));
    expect(result).toContain("TRACE");
  });
});
