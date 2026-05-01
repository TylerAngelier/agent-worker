import { describe, test, expect, beforeEach, afterEach, spyOn, type Mock } from "bun:test";
import { colors, formatConsoleLine, printSplash, isTTY } from "../src/format.ts";

describe("colors", () => {
  test("bold wraps text in bold ANSI codes", () => {
    expect(colors.bold("hello")).toBe("\x1b[1mhello\x1b[0m");
  });

  test("dim wraps text in dim ANSI codes", () => {
    expect(colors.dim("hello")).toBe("\x1b[2mhello\x1b[0m");
  });

  test("red wraps text in red ANSI codes", () => {
    expect(colors.red("error")).toBe("\x1b[31merror\x1b[0m");
  });

  test("green wraps text in green ANSI codes", () => {
    expect(colors.green("success")).toBe("\x1b[32msuccess\x1b[0m");
  });

  test("yellow wraps text in yellow ANSI codes", () => {
    expect(colors.yellow("warning")).toBe("\x1b[33mwarning\x1b[0m");
  });

  test("blue wraps text in blue ANSI codes", () => {
    expect(colors.blue("info")).toBe("\x1b[34minfo\x1b[0m");
  });

  test("cyan wraps text in cyan ANSI codes", () => {
    expect(colors.cyan("box")).toBe("\x1b[36mbox\x1b[0m");
  });

  test("gray wraps text in gray ANSI codes", () => {
    expect(colors.gray("debug")).toBe("\x1b[90mdebug\x1b[0m");
  });
});

describe("formatConsoleLine", () => {
  test("includes timestamp, level badge, and message", () => {
    const line = formatConsoleLine("info", "server started");
    // Timestamp pattern: HH:MM:SS
    expect(line).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(line).toContain("INFO");
    expect(line).toContain("server started");
  });

  test("uses gray for debug level", () => {
    const line = formatConsoleLine("debug", "verbose output");
    expect(line).toContain("\x1b[90mDEBUG");
  });

  test("uses blue for info level", () => {
    const line = formatConsoleLine("info", "something happened");
    expect(line).toContain("\x1b[34mINFO");
  });

  test("uses yellow for warn level", () => {
    const line = formatConsoleLine("warn", "deprecated");
    expect(line).toContain("\x1b[33mWARN");
  });

  test("uses red for error level", () => {
    const line = formatConsoleLine("error", "crash");
    expect(line).toContain("\x1b[31mERROR");
  });

  test("pads level badge to 5 chars", () => {
    const line = formatConsoleLine("info", "test");
    // INFO is 4 chars, badge should be INFO + 1 space = 5 chars
    expect(line).toContain("INFO ");
  });

  test("includes component tag when ctx.component is set", () => {
    const line = formatConsoleLine("info", "processing", { component: "linear" });
    expect(line).toContain("\x1b[36m[linear]\x1b[0m");
  });

  test("excludes component from context key=value pairs", () => {
    const line = formatConsoleLine("info", "processing", {
      component: "linear",
      ticketId: "ENG-123",
    });
    expect(line).toContain("ticketId=ENG-123");
    // component should not appear as key=value
    expect(line).not.toMatch(/component=linear/);
  });

  test("renders context as dim key=value pairs", () => {
    const line = formatConsoleLine("info", "found", {
      ticketId: "ENG-100",
      prNumber: 42, // number gets coerced to string via .toString()
    });
    expect(line).toContain("ticketId=ENG-100");
  });

  test("does not add context section when ctx is empty", () => {
    const line = formatConsoleLine("info", "minimal");
    expect(line).not.toContain("  \x1b[2m"); // no dim context following
  });

  test("does not add context section when ctx only contains component", () => {
    const line = formatConsoleLine("info", "tagged only", { component: "poller" });
    // Should have the component but no trailing space + dim
    expect(line).toContain("[poller]");
    expect(line).toContain("tagged only");
    // No key=value pairs should be present
    expect(line).not.toMatch(/[a-z]+=/);
  });

  test("handles unknown level as gray", () => {
    const line = formatConsoleLine("verbose" as any, "custom");
    expect(line).toContain("\x1b[90mVERBO");
  });

  test("special Claude case: renders dim prefix for bare claude output", () => {
    const line = formatConsoleLine("debug", "claude", { line: "  function foo() {" });
    expect(line).toContain("\x1b[2m│\x1b[0m");
    expect(line).toContain("  function foo() {");
  });

  test("does not trigger Claude case when msg is claude but no line field", () => {
    const line = formatConsoleLine("info", "claude", { ticketId: "ENG-1" });
    expect(line).toContain("claude");
    expect(line).toContain("ticketId=ENG-1");
    expect(line).not.toContain("│");
  });
});

describe("printSplash", () => {
  // isTTY is a module-level const evaluated at import time.
  // Changing process.stdout.isTTY after import has no effect on isTTY.
  // When stdout IS a TTY (most interactive terminals), printSplash
  // will output; when it isn't (CI/pipes), it no-ops. Both paths
  // are validated by the production path in index.ts.

  test("no-ops when isTTY is false (module const)", () => {
    if (!isTTY) {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        printSplash("test");
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    } else {
      // When isTTY is true, we can verify printSplash emits output.
      // We can't force isTTY to false because it's a module-level const.
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        printSplash("linear → claude");
        expect(logSpy).toHaveBeenCalled();
        const calls = logSpy.mock.calls.map(c => c[0] as string).join("\n");
        expect(calls).toContain("Agent Worker");
        expect(calls).toContain("linear → claude");
      } finally {
        logSpy.mockRestore();
      }
    }
  });
});
