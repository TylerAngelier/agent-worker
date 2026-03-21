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

  describe("getPRMergeInfo", () => {
    test("returns merge info with url, sha, and summary", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pulls/42")) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: "https://github.com/myorg/myrepo/pull/42",
            merge_commit_sha: "abc123def456789abc123def456789abc123def",
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/commits/abc123")) {
          return new Response(JSON.stringify({
            commit: {
              message: "feat: add new feature (#42)\n\nThis adds a new feature.",
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.getPRMergeInfo(42);

      expect(result).not.toBeNull();
      expect(result!.url).toBe("https://github.com/myorg/myrepo/pull/42");
      expect(result!.sha).toBe("abc123def456789abc123def456789abc123def");
      expect(result!.summary).toBe("feat: add new feature (#42)");
    });

    test("returns null when merge commit SHA is missing", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({
          number: 42,
          html_url: "https://github.com/myorg/myrepo/pull/42",
          merge_commit_sha: null,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.getPRMergeInfo(42);

      expect(result).toBeNull();
    });

    test("returns merge info with empty summary when commit fetch fails", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pulls/42")) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: "https://github.com/myorg/myrepo/pull/42",
            merge_commit_sha: "abc123def456789abc123def456789abc123def",
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.getPRMergeInfo(42);

      expect(result).not.toBeNull();
      expect(result!.url).toBe("https://github.com/myorg/myrepo/pull/42");
      expect(result!.sha).toBe("abc123def456789abc123def456789abc123def");
      expect(result!.summary).toBe("");
    });

    test("returns null when PR fetch fails", async () => {
      const mockFetch = mock(async () => {
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.getPRMergeInfo(42);

      expect(result).toBeNull();
    });
  });

  describe("getPRComments", () => {
    test("tags issue and review comments with correct commentType", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pulls/42/comments")) {
          // Review (inline code) comments
          return new Response(JSON.stringify([
            {
              id: 100,
              user: { login: "reviewer" },
              body: "fix this line",
              created_at: "2026-01-01T02:00:00Z",
            },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/issues/42/comments")) {
          // Issue comments
          return new Response(JSON.stringify([
            {
              id: 200,
              user: { login: " commenter" },
              body: "overall feedback",
              created_at: "2026-01-01T01:00:00Z",
            },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.getPRComments(42);

      expect(result).toHaveLength(2);
      // Issue comments come first in dedup order
      expect(result[0]!.id).toBe(200);
      expect(result[0]!.commentType).toBe("issue");
      expect(result[1]!.id).toBe(100);
      expect(result[1]!.commentType).toBe("review");
    });
  });

  describe("hasCommentReaction", () => {
    test("returns true when reaction exists on issue comment", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/issues/comments/300/reactions")) {
          return new Response(JSON.stringify([
            { id: 1, user: { login: "bot" }, content: "eyes" },
            { id: 2, user: { login: "other" }, content: "thumbs_up" },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.hasCommentReaction(300, "issue", "eyes");

      expect(result).toBe(true);
    });

    test("returns false when reaction does not exist", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/issues/comments/300/reactions")) {
          return new Response(JSON.stringify([
            { id: 1, user: { login: "bot" }, content: "thumbs_up" },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.hasCommentReaction(300, "issue", "eyes");

      expect(result).toBe(false);
    });

    test("returns false when no reactions exist", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/issues/comments/300/reactions")) {
          return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.hasCommentReaction(300, "issue", "eyes");

      expect(result).toBe(false);
    });

    test("checks review comment reactions via pulls/comments endpoint", async () => {
      const mockFetch = mock(async (url: string) => {
        if (url.includes("/pulls/comments/400/reactions")) {
          return new Response(JSON.stringify([
            { id: 1, user: { login: "bot" }, content: "eyes" },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.hasCommentReaction(400, "review", "eyes");

      expect(result).toBe(true);
    });

    test("returns false when API request fails", async () => {
      const mockFetch = mock(async () => {
        return new Response("Forbidden", { status: 403 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      const result = await provider.hasCommentReaction(300, "issue", "eyes");

      expect(result).toBe(false);
    });
  });

  describe("addCommentReaction", () => {
    test("posts reaction to issue comment", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/issues/comments/300/reactions") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.content).toBe("eyes");
          return new Response(JSON.stringify({ id: 1, content: "eyes" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      // Should not throw
      await provider.addCommentReaction(300, "issue", "eyes");
    });

    test("posts reaction to review comment", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/pulls/comments/400/reactions") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.content).toBe("white_check_mark");
          return new Response(JSON.stringify({ id: 2, content: "white_check_mark" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      await provider.addCommentReaction(400, "review", "white_check_mark");
    });

    test("does not throw on API error (best-effort)", async () => {
      const mockFetch = mock(async () => {
        return new Response("Forbidden", { status: 403 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      // Should not throw
      await provider.addCommentReaction(300, "issue", "eyes");
    });
  });

  describe("replyToComment", () => {
    test("posts standalone comment for issue comment type", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/issues/42/comments") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.body).toBe("Addressed in commit `abc123`.");
          return new Response(JSON.stringify({ id: 500 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      await provider.replyToComment(42, 300, "issue", "Addressed in commit `abc123`.");
    });

    test("posts threaded reply for review comment type", async () => {
      const mockFetch = mock(async (url: string, init?: RequestInit) => {
        if (url.includes("/pulls/42/comments/400/replies") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.body).toBe("Fixed in commit `def456`.");
          return new Response(JSON.stringify({ id: 501 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      await provider.replyToComment(42, 400, "review", "Fixed in commit `def456`.");
    });

    test("does not throw on API error (best-effort)", async () => {
      const mockFetch = mock(async () => {
        return new Response("Forbidden", { status: 403 });
      });

      // @ts-expect-error mocking global fetch
      globalThis.fetch = mockFetch;

      const { createGitHubProvider } = await import("../../src/scm/github.ts");
      const provider = createGitHubProvider({ type: "github", owner: "myorg", repo: "myrepo" });
      await provider.replyToComment(42, 300, "issue", "test reply");
    });
  });
});
