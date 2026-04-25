import { describe, test, expect } from "bun:test";
import { slugify, sanitizeTitle, buildTaskVars, interpolate } from "../../src/pipeline/interpolate.ts";
import type { Ticket } from "../../src/providers/types.ts";

const ticket: Ticket = {
  id: "uuid-1",
  identifier: "ENG-100",
  title: "Fix the login bug",
  description: "Do something",
};

describe("slugify", () => {
  test("lowercases text", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("replaces non-alphanumeric chars with hyphens", () => {
    expect(slugify("foo bar & baz!")).toBe("foo-bar-baz");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });

  test("collapses multiple non-alphanumeric into single hyphen", () => {
    expect(slugify("a---b")).toBe("a-b");
  });

  test("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  test("handles special characters only", () => {
    expect(slugify("@#$%")).toBe("");
  });
});

describe("sanitizeTitle", () => {
  test("removes single quotes", () => {
    expect(sanitizeTitle("it's broken")).toBe("its broken");
  });

  test("removes backticks", () => {
    expect(sanitizeTitle("run `npm test`")).toBe("run npm test");
  });

  test("removes dollar signs", () => {
    expect(sanitizeTitle("$HOME/env")).toBe("HOME/env");
  });

  test("removes backslashes", () => {
    expect(sanitizeTitle("path\\to\\file")).toBe("pathtofile");
  });

  test("leaves normal text unchanged", () => {
    expect(sanitizeTitle("hello world 123")).toBe("hello world 123");
  });
});

describe("buildTaskVars", () => {
  test("constructs vars from ticket", () => {
    const vars = buildTaskVars(ticket);
    expect(vars.id).toBe("ENG-100");
    expect(vars.title).toBe("fix-the-login-bug");
    expect(vars.raw_title).toBe("Fix the login bug");
    expect(vars.branch).toBe("agent/task-ENG-100");
    expect(vars.worktree).toBe("");
  });

  test("accepts custom worktree path", () => {
    const vars = buildTaskVars(ticket, "/tmp/worktree");
    expect(vars.worktree).toBe("/tmp/worktree");
  });

  test("slugifies title with special characters", () => {
    const t: Ticket = { id: "1", identifier: "OPS-1", title: "Deploy API (v2) & migrate DB!", description: undefined };
    const vars = buildTaskVars(t);
    expect(vars.title).toBe("deploy-api-v2-migrate-db");
  });

  test("sanitizes title with shell-unsafe characters", () => {
    const t: Ticket = { id: "1", identifier: "OPS-2", title: "Run `test` with $VAR", description: undefined };
    const vars = buildTaskVars(t);
    expect(vars.raw_title).toBe("Run test with VAR");
  });
});

describe("interpolate", () => {
  test("replaces {id} token", () => {
    const vars = buildTaskVars(ticket);
    expect(interpolate("Task {id}", vars)).toBe("Task ENG-100");
  });

  test("replaces {title} token", () => {
    const vars = buildTaskVars(ticket);
    expect(interpolate("slug: {title}", vars)).toBe("slug: fix-the-login-bug");
  });

  test("replaces {raw_title} token", () => {
    const vars = buildTaskVars(ticket);
    expect(interpolate("raw: {raw_title}", vars)).toBe("raw: Fix the login bug");
  });

  test("replaces {branch} token", () => {
    const vars = buildTaskVars(ticket);
    expect(interpolate("branch={branch}", vars)).toBe("branch=agent/task-ENG-100");
  });

  test("replaces {worktree} token", () => {
    const vars = buildTaskVars(ticket, "/tmp/wt");
    expect(interpolate("cd {worktree}", vars)).toBe("cd /tmp/wt");
  });

  test("replaces {date} with ISO timestamp", () => {
    const vars = buildTaskVars(ticket);
    const result = interpolate("date={date}", vars);
    expect(result).toMatch(/^date=\d{4}-\d{2}-\d{2}T/);
  });

  test("replaces multiple tokens in one template", () => {
    const vars = buildTaskVars(ticket, "/tmp/wt");
    const result = interpolate("{id}: {title} in {worktree}", vars);
    expect(result).toBe("ENG-100: fix-the-login-bug in /tmp/wt");
  });

  test("leaves unknown tokens unchanged", () => {
    const vars = buildTaskVars(ticket);
    expect(interpolate("{unknown} token", vars)).toBe("{unknown} token");
  });

  test("handles template with no tokens", () => {
    const vars = buildTaskVars(ticket);
    expect(interpolate("plain text", vars)).toBe("plain text");
  });
});
