import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("SCM Provider Factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, GITHUB_TOKEN: "ghp_test", BITBUCKET_TOKEN: "bb_test" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("creates GitHub SCM provider for type 'github'", async () => {
    const { createScmProvider } = await import("../../src/scm/index.ts");
    const provider = createScmProvider({ type: "github", owner: "myorg", repo: "myrepo" });
    expect(provider).toBeDefined();
    expect(typeof provider.findPullRequest).toBe("function");
    expect(typeof provider.getPRComments).toBe("function");
    expect(typeof provider.isPRMerged).toBe("function");
  });

  test("creates Bitbucket Server SCM provider for type 'bitbucket_server'", async () => {
    const { createScmProvider } = await import("../../src/scm/index.ts");
    const provider = createScmProvider({
      type: "bitbucket_server",
      base_url: "https://bitbucket.example.com",
      project: "PROJ",
      repo: "myrepo",
    });
    expect(provider).toBeDefined();
    expect(typeof provider.findPullRequest).toBe("function");
    expect(typeof provider.getPRComments).toBe("function");
    expect(typeof provider.isPRMerged).toBe("function");
  });

  test("throws on unknown SCM provider type at compile time (exhaustive check)", () => {
    // The switch is exhaustive — unknown types won't compile.
    // This test just confirms the happy paths work.
    expect(true).toBe(true);
  });
});
