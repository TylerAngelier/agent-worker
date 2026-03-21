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

  describe("getPRMergeInfo", () => {
    test("returns merge info with url, sha, and summary", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pull-requests/42") && !url.includes("/commits")) {
          return new Response(JSON.stringify({
            id: 42,
            state: "MERGED",
            links: {
              self: [{ href: "https://bb.example.com/projects/PROJ/repos/myrepo/pull-requests/42" }],
            },
            mergeCommit: {
              id: "abc123def456789abc123def456789abc123def",
              displayId: "abc123d",
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/commits/abc123")) {
          return new Response(JSON.stringify({
            id: "abc123def456789abc123def456789abc123def",
            message: "feat: add new feature (#42)\n\nThis adds a new feature.",
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      const result = await provider.getPRMergeInfo(42);

      expect(result).not.toBeNull();
      expect(result!.url).toBe("https://bb.example.com/projects/PROJ/repos/myrepo/pull-requests/42");
      expect(result!.sha).toBe("abc123def456789abc123def456789abc123def");
      expect(result!.summary).toBe("feat: add new feature (#42)");
    });

    test("returns null when merge commit is missing", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({
          id: 42,
          state: "MERGED",
          links: {
            self: [{ href: "https://bb.example.com/projects/PROJ/repos/myrepo/pull-requests/42" }],
          },
          mergeCommit: null,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      const result = await provider.getPRMergeInfo(42);

      expect(result).toBeNull();
    });

    test("returns merge info with empty summary when commit fetch fails", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pull-requests/42") && !url.includes("/commits")) {
          return new Response(JSON.stringify({
            id: 42,
            state: "MERGED",
            links: {
              self: [{ href: "https://bb.example.com/projects/PROJ/repos/myrepo/pull-requests/42" }],
            },
            mergeCommit: {
              id: "abc123def456789abc123def456789abc123def",
              displayId: "abc123d",
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      const result = await provider.getPRMergeInfo(42);

      expect(result).not.toBeNull();
      expect(result!.url).toBe("https://bb.example.com/projects/PROJ/repos/myrepo/pull-requests/42");
      expect(result!.sha).toBe("abc123def456789abc123def456789abc123def");
      expect(result!.summary).toBe("");
    });

    test("falls back to constructed URL when self link is missing", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pull-requests/42") && !url.includes("/commits")) {
          return new Response(JSON.stringify({
            id: 42,
            state: "MERGED",
            links: {},
            mergeCommit: {
              id: "abc123def456789abc123def456789abc123def",
              displayId: "abc123d",
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/commits/abc123")) {
          return new Response(JSON.stringify({
            id: "abc123def456789abc123def456789abc123def",
            message: "fix: correct typo",
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      const result = await provider.getPRMergeInfo(42);

      expect(result).not.toBeNull();
      expect(result!.url).toBe("https://bb.example.com/projects/PROJ/repos/myrepo/pull-requests/42");
      expect(result!.summary).toBe("fix: correct typo");
    });
  });

  describe("hasCommentReaction", () => {
    test("returns false when prNumber is not provided", async () => {
      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      expect(await provider.hasCommentReaction(1, "issue", "eyes")).toBe(false);
    });

    test("returns true when reaction found on comment", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pull-requests/42/comments/100")) {
          return new Response(JSON.stringify({
            id: 100,
            text: "fix this line",
            properties: [
              { key: "reactions", value: '{"eyes":1,"thumbsup":2}' },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      const result = await provider.hasCommentReaction(100, "review", "eyes", 42);

      expect(result).toBe(true);
    });

    test("returns false when reaction not found", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pull-requests/42/comments/100")) {
          return new Response(JSON.stringify({
            id: 100,
            text: "fix this line",
            properties: [
              { key: "reactions", value: '{"thumbsup":2}' },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      const result = await provider.hasCommentReaction(100, "review", "eyes", 42);

      expect(result).toBe(false);
    });

    test("returns false when no properties on comment", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pull-requests/42/comments/100")) {
          return new Response(JSON.stringify({
            id: 100,
            text: "fix this line",
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      const result = await provider.hasCommentReaction(100, "review", "eyes", 42);

      expect(result).toBe(false);
    });

    test("returns false on API error", async () => {
      const mockFetch = mock(async () => {
        return new Response("Forbidden", { status: 403 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      const result = await provider.hasCommentReaction(100, "review", "eyes", 42);

      expect(result).toBe(false);
    });

    test("maps GitHub reaction names to Bitbucket emoticons", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pull-requests/42/comments/100")) {
          return new Response(JSON.stringify({
            id: 100,
            text: "looks good",
            properties: [
              { key: "reactions", value: '{"thumbsup":1}' },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      // "white_check_mark" maps to "thumbsup" in Bitbucket
      const result = await provider.hasCommentReaction(100, "review", "white_check_mark", 42);
      expect(result).toBe(true);
    });
  });

  describe("addCommentReaction", () => {
    test("does not throw when prNumber is not provided (best-effort)", async () => {
      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      // Should not throw
      await provider.addCommentReaction(1, "issue", "eyes");
    });

    test("posts reaction to Bitbucket Server comment-likes API", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/comment-likes/") && init?.method === "PUT") {
          expect(url).toContain("/pull-requests/42/comments/100/reactions/eyes");
          return new Response("", { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      await provider.addCommentReaction(100, "review", "eyes", 42);
    });

    test("maps GitHub reaction names to Bitbucket emoticons", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/comment-likes/") && init?.method === "PUT") {
          expect(url).toContain("/reactions/thumbsup");
          return new Response("", { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      // "white_check_mark" maps to "thumbsup"
      await provider.addCommentReaction(100, "review", "white_check_mark", 42);
    });

    test("handles 409 conflict gracefully", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/comment-likes/") && init?.method === "PUT") {
          return new Response("Conflict", { status: 409 });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      // Should not throw on 409
      await provider.addCommentReaction(100, "review", "eyes", 42);
    });

    test("does not throw on API error (best-effort)", async () => {
      const mockFetch = mock(async () => {
        return new Response("Forbidden", { status: 403 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      // Should not throw
      await provider.addCommentReaction(100, "review", "eyes", 42);
    });

    test("passes unknown reaction names through as-is", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/comment-likes/") && init?.method === "PUT") {
          expect(url).toContain("/reactions/rocket");
          return new Response("", { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      await provider.addCommentReaction(100, "review", "rocket", 42);
    });
  });

  describe("replyToComment", () => {
    test("posts threaded reply with parent id", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/pull-requests/42/comments") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.text).toBe("Addressed in commit `abc123`.");
          expect(body.parent.id).toBe(100);
          return new Response(JSON.stringify({ id: 200, text: "Addressed in commit `abc123`." }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      await provider.replyToComment(42, 100, "review", "Addressed in commit `abc123`.");
    });

    test("does not throw on API error (best-effort)", async () => {
      const mockFetch = mock(async () => {
        return new Response("Forbidden", { status: 403 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createBitbucketServerProvider } = await import("../../src/scm/bitbucket-server.ts");
      const provider = createBitbucketServerProvider({
        type: "bitbucket_server",
        base_url: "https://bb.example.com",
        project: "PROJ",
        repo: "myrepo",
      });
      // Should not throw
      await provider.replyToComment(42, 100, "review", "test reply");
    });
  });
});
