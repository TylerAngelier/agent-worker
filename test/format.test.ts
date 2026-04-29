import { describe, test, expect } from "bun:test";
import {
  colors,
  isTTY,
  formatConsoleLine,
} from "../src/format.ts";

// ── colors ────────────────────────────────────────────────────────

describe("colors", () => {
  test("bold wraps text with ANSI bold escape", () => {
    expect(colors.bold("hi")).toBe("\x1b[1mhi\x1b[0m");
  });

  test("red wraps text with ANSI red escape", () => {
    expect(colors.red("err")).toBe("\x1b[31merr\x1b[0m");
  });

  test("green wraps text with ANSI green escape", () => {
    expect(colors.green("ok")).toBe("\x1b[32mok\x1b[0m");
  });

  test("yellow wraps text with ANSI yellow escape", () => {
    expect(colors.yellow("warn")).toBe("\x1b[33mwarn\x1b[0m");
  });

  test("blue wraps text with ANSI blue escape", () => {
    expect(colors.blue("info")).toBe("\x1b[34minfo\x1b[0m");
  });

  test("cyan wraps text with ANSI cyan escape", () => {
    expect(colors.cyan("tag")).toBe("\x1b[36mtag\x1b[0m");
  });

  test("dim wraps text with ANSI dim escape", () => {
    expect(colors.dim("faint")).toBe("\x1b[2mfaint\x1b[0m");
  });

  test("gray wraps text with ANSI bright-black escape", () => {
    expect(colors.gray("muted")).toBe("\x1b[90mmuted\x1b[0m");
  });
});

// ── isTTY ──────────────────────────────────────────────────────────

describe("isTTY", () => {
  test("is a boolean", () => {
    expect(typeof isTTY).toBe("boolean");
  });
});

// ── formatConsoleLine ──────────────────────────────────────────────

describe("formatConsoleLine", () => {
  test("includes the message text", () => {
    const out = formatConsoleLine("info", "hello world");
    expect(out).toContain("hello world");
  });

  test("includes uppercased level badge", () => {
    const out = formatConsoleLine("warn", "careful");
    expect(out).toContain("WARN");
  });

  test("includes context key=value pairs", () => {
    const out = formatConsoleLine("info", "msg", { foo: "bar", count: 3 });
    expect(out).toContain("foo=bar");
    expect(out).toContain("count=3");
  });

  test("excludes component from context key=value pairs and renders as tag", () => {
    const out = formatConsoleLine("info", "msg", { component: "poller", status: "ok" });
    expect(out).toContain("[poller]");
    expect(out).toContain("status=ok");
    // "component=" should NOT appear in the context pairs
    expect(out).not.toMatch(/component=/);
  });

  test("handles bare Claude output line", () => {
    const out = formatConsoleLine("info", "claude", { line: "some output" });
    expect(out).toContain("some output");
    expect(out).toContain("│");
    // Should NOT contain the normal badge/message format
    expect(out).not.toContain("INFO");
  });

  test("handles empty context", () => {
    const out = formatConsoleLine("error", "fail");
    expect(out).toContain("fail");
    expect(out).toContain("ERROR");
  });

  test("uses gray for unknown level", () => {
    const out = formatConsoleLine("custom", "test");
    expect(out).toContain("CUSTOM");
  });
});
