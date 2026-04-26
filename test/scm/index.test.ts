import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createScmProvider } from "../../src/scm/index.ts";

describe("createScmProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, GITHUB_TOKEN: "ghp_test", BITBUCKET_TOKEN: "bb_test" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns a GitHub provider for github config", () => {
    const provider = createScmProvider({
      type: "github",
      owner: "myorg",
      repo: "myrepo",
    });
    expect(provider).toBeDefined();
    expect(typeof provider.findPullRequest).toBe("function");
    expect(typeof provider.getPRComments).toBe("function");
    expect(typeof provider.isPRMerged).toBe("function");
  });

  test("returns a Bitbucket Server provider for bitbucket_server config", () => {
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
});
