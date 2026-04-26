import { describe, it, expect } from "bun:test";
import { colors, formatConsoleLine, isTTY } from "../src/format.ts";

describe("colors", () => {
  it("wraps text in ANSI escape codes and resets", () => {
    const result = colors.red("hello");
    expect(result).toBe("\x1b[31mhello\x1b[0m");
  });

  it("bold wraps with escape code 1", () => {
    expect(colors.bold("x")).toBe("\x1b[1mx\x1b[0m");
  });

  it("dim wraps with escape code 2", () => {
    expect(colors.dim("x")).toBe("\x1b[2mx\x1b[0m");
  });

  it("green wraps with escape code 32", () => {
    expect(colors.green("ok")).toBe("\x1b[32mok\x1b[0m");
  });

  it("yellow wraps with escape code 33", () => {
    expect(colors.yellow("warn")).toBe("\x1b[33mwarn\x1b[0m");
  });

  it("blue wraps with escape code 34", () => {
    expect(colors.blue("info")).toBe("\x1b[34minfo\x1b[0m");
  });

  it("cyan wraps with escape code 36", () => {
    expect(colors.cyan("c")).toBe("\x1b[36mc\x1b[0m");
  });

  it("gray wraps with escape code 90", () => {
    expect(colors.gray("g")).toBe("\x1b[90mg\x1b[0m");
  });
});

describe("isTTY", () => {
  it("is a boolean", () => {
    expect(typeof isTTY).toBe("boolean");
  });
});

describe("formatConsoleLine", () => {
  it("formats a basic info log line with badge and message", () => {
    const result = formatConsoleLine("info", "started");
    // Should contain the message
    expect(result).toContain("started");
    // Should contain INFO badge (padded to 5 chars)
    expect(result).toContain("INFO ");
    // Should contain ANSI escape sequences
    expect(result).toContain("\x1b[");
  });

  it("includes context key=value pairs", () => {
    const result = formatConsoleLine("info", "test", { key: "val" });
    expect(result).toContain("key=val");
  });

  it("includes component tag when provided", () => {
    const result = formatConsoleLine("info", "msg", { component: "scheduler" });
    expect(result).toContain("[scheduler]");
    // component should NOT appear in the ctx key=value section
    expect(result).not.toContain("component=scheduler");
  });

  it("excludes component from context pairs", () => {
    const result = formatConsoleLine("info", "msg", { component: "poller", count: 5 });
    expect(result).toContain("[poller]");
    expect(result).toContain("count=5");
    expect(result).not.toContain("component=poller");
  });

  it("formats claude bare line specially when ctx.line is present", () => {
    const result = formatConsoleLine("claude", "claude", { line: "some output" });
    expect(result).toContain("some output");
    expect(result).toContain("│");
    // Should NOT contain INFO/WARN/etc badge formatting
    expect(result).not.toContain("CLAUDE");
  });

  it("uses gray for unknown log levels", () => {
    const result = formatConsoleLine("custom", "msg");
    expect(result).toContain("CUSTOM");
    // Gray uses escape code 90
    expect(result).toContain("\x1b[90m");
  });

  it("handles empty context", () => {
    const result = formatConsoleLine("warn", "no ctx");
    expect(result).toContain("no ctx");
    expect(result).toContain("WARN ");
  });

  it("handles context with multiple keys", () => {
    const result = formatConsoleLine("error", "fail", { a: 1, b: "two" });
    expect(result).toContain("a=1");
    expect(result).toContain("b=two");
  });
});
