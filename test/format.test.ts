import { describe, it, expect } from "bun:test";
import { colors, formatConsoleLine, isTTY } from "../src/format";

describe("colors", () => {
  it("wraps text in bold escape codes", () => {
    const result = colors.bold("hello");
    expect(result).toContain("hello");
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[0m");
  });

  it("wraps text in red escape codes", () => {
    const result = colors.red("err");
    expect(result).toContain("err");
    expect(result).toContain("\x1b[31m");
  });

  it("wraps text in green escape codes", () => {
    const result = colors.green("ok");
    expect(result).toContain("ok");
    expect(result).toContain("\x1b[32m");
  });

  it("wraps text in cyan escape codes", () => {
    const result = colors.cyan("info");
    expect(result).toContain("info");
    expect(result).toContain("\x1b[36m");
  });

  it("wraps text in gray escape codes", () => {
    const result = colors.gray("muted");
    expect(result).toContain("muted");
    expect(result).toContain("\x1b[90m");
  });
});

describe("isTTY", () => {
  it("is a boolean", () => {
    expect(typeof isTTY).toBe("boolean");
  });
});

describe("formatConsoleLine", () => {
  it("formats a simple info message", () => {
    const result = formatConsoleLine("info", "hello");
    // Should contain the message text
    expect(result).toContain("hello");
    // Should contain an INFO badge (padded to 5 chars)
    expect(result).toContain("INFO");
  });

  it("formats with context key=value pairs", () => {
    const result = formatConsoleLine("warn", "something happened", { count: 3 });
    expect(result).toContain("count=3");
  });

  it("includes component tag when provided in context", () => {
    const result = formatConsoleLine("info", "test", { component: "provider:linear" });
    expect(result).toContain("[provider:linear]");
    // Component should NOT appear as a key=value pair
    expect(result).not.toContain("component=");
  });

  it("strips component from context key=value output", () => {
    const result = formatConsoleLine("info", "msg", { component: "x", key: "val" });
    expect(result).toContain("key=val");
    expect(result).not.toContain("component=");
  });

  it("formats claude bare lines with pipe prefix", () => {
    const result = formatConsoleLine("info", "claude", { line: "some output" });
    expect(result).toContain("some output");
    expect(result).toContain("│");
  });

  it("uses gray for unknown levels", () => {
    const result = formatConsoleLine("custom", "test");
    expect(result).toContain("CUSTOM");
    expect(result).toContain("test");
  });
});
