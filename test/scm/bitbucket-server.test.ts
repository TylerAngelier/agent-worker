import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

describe("BitBucket Server SCM Provider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, BITBUCKET_TOKEN: "bb_test" };
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restore();
  });

  test("throws if BITBUCKET_TOKEN is not set", async () => {
    delete process.env.BITBUCKET_TOKEN;
    const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
    expect(() =>
      createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      })
    ).toThrow("BITBUCKET_TOKEN environment variable is required");
  });
});
