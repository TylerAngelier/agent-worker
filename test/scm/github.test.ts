import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

describe("GitHub SCM Provider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, GITHUB_TOKEN: "ghp_test" };
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restore();
  });

  test("throws if GITHUB_TOKEN is not set", async () => {
    delete process.env.GITHUB_TOKEN;
    const { createGitHubProvider } = await import("../../src/scm/github.ts");
    expect(() => createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" })).toThrow(
      "GITHUB_TOKEN environment variable is required"
    );
  });
});
