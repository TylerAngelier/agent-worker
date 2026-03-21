import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createPlaneProvider } from "../src/providers/plane.ts";

const planeConfig = {
  type: "plane" as const,
  base_url: "https://plane.example.com",
  workspace_slug: "my-workspace",
  project_id: "proj-uuid-123",
  poll_interval_seconds: 60,
  query: "state_group: backlog",
  statuses: {
    ready: "Backlog",
    in_progress: "In Progress",
    code_review: "Code Review",
    verification: "Verification",
    failed: "Canceled",
  },
};

const projectResponse = {
  ok: true,
  json: async () => ({ identifier: "ENG" }),
};

const statesResponse = {
  ok: true,
  json: async () => ({
    results: [
      { id: "state-backlog", name: "Backlog", group: "backlog" },
      { id: "state-in-progress", name: "In Progress", group: "started" },
      { id: "state-code-review", name: "Code Review", group: "started" },
      { id: "state-verification", name: "Verification", group: "completed" },
      { id: "state-canceled", name: "Canceled", group: "cancelled" },
    ],
  }),
};

function mockFetch(fn: typeof fetch) {
  (globalThis as { fetch: typeof fetch }).fetch = fn;
}

function createMockFetchFn(responses: Record<string, Response>) {
  const sorted = Object.entries(responses).sort(([a], [b]) => b.length - a.length);
  return mock((url: string) => {
    for (const [pattern, response] of sorted) {
      if (url.includes(pattern)) {
        return Promise.resolve(response);
      }
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as unknown as typeof fetch;
}

describe("createPlaneProvider", () => {
  beforeEach(() => {
    process.env.PLANE_API_KEY = "test-plane-key";
  });

  afterEach(() => {
    delete process.env.PLANE_API_KEY;
  });

  test("throws when PLANE_API_KEY is not set", () => {
    delete process.env.PLANE_API_KEY;
    expect(() => createPlaneProvider(planeConfig)).toThrow(
      "PLANE_API_KEY environment variable is required"
    );
  });

  test("returns a TicketProvider with required methods", () => {
    const provider = createPlaneProvider(planeConfig);
    expect(typeof provider.fetchReadyTickets).toBe("function");
    expect(typeof provider.transitionStatus).toBe("function");
    expect(typeof provider.postComment).toBe("function");
  });

  test("fetchReadyTickets calls Plane issues API with query param", async () => {
    const issuesResponse = {
      ok: true,
      json: async () => ({
        results: [
          {
            id: "issue-uuid-1",
            sequence_id: 42,
            name: "Fix the login bug",
            description_html: "<p>Login is broken</p>",
            state: "state-backlog",
          },
        ],
      }),
    };

    const originalFetch = globalThis.fetch;
    mockFetch(createMockFetchFn({
      "/projects/proj-uuid-123/issues/": issuesResponse as unknown as Response,
      "/projects/proj-uuid-123/": projectResponse as unknown as Response,
      "/projects/proj-uuid-123/states/": statesResponse as unknown as Response,
    }));

    const provider = createPlaneProvider(planeConfig);
    const tickets = await provider.fetchReadyTickets();

    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.id).toBe("issue-uuid-1");
    expect(tickets[0]!.identifier).toBe("ENG-42");
    expect(tickets[0]!.title).toBe("Fix the login bug");
    expect(tickets[0]!.description).toBe("<p>Login is broken</p>");

    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  test("fetchReadyTickets filters out tickets not in ready state", async () => {
    const issuesResponse = {
      ok: true,
      json: async () => ({
        results: [
          {
            id: "issue-uuid-1",
            sequence_id: 42,
            name: "Backlog ticket",
            description_html: null,
            state: "state-backlog",
          },
          {
            id: "issue-uuid-2",
            sequence_id: 43,
            name: "In progress ticket",
            description_html: null,
            state: "state-in-progress",
          },
        ],
      }),
    };

    const originalFetch = globalThis.fetch;
    mockFetch(createMockFetchFn({
      "/projects/proj-uuid-123/issues/": issuesResponse as unknown as Response,
      "/projects/proj-uuid-123/": projectResponse as unknown as Response,
      "/projects/proj-uuid-123/states/": statesResponse as unknown as Response,
    }));

    const provider = createPlaneProvider(planeConfig);
    const tickets = await provider.fetchReadyTickets();

    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.id).toBe("issue-uuid-1");
    expect(tickets[0]!.title).toBe("Backlog ticket");

    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  test("fetchReadyTickets handles null description_html", async () => {
    const issuesResponse = {
      ok: true,
      json: async () => ({
        results: [
          {
            id: "issue-uuid-2",
            sequence_id: 43,
            name: "No desc issue",
            description_html: null,
            state: "state-backlog",
          },
        ],
      }),
    };

    const originalFetch = globalThis.fetch;
    mockFetch(createMockFetchFn({
      "/projects/proj-uuid-123/issues/": issuesResponse as unknown as Response,
      "/projects/proj-uuid-123/": projectResponse as unknown as Response,
      "/projects/proj-uuid-123/states/": statesResponse as unknown as Response,
    }));

    const provider = createPlaneProvider(planeConfig);
    const tickets = await provider.fetchReadyTickets();

    expect(tickets[0]!.description).toBeUndefined();

    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  test("fetchReadyTickets returns empty array when no issues", async () => {
    const emptyResponse = {
      ok: true,
      json: async () => ({ results: [] }),
    };

    const originalFetch = globalThis.fetch;
    mockFetch(createMockFetchFn({
      "/projects/proj-uuid-123/issues/": emptyResponse as unknown as Response,
      "/projects/proj-uuid-123/": projectResponse as unknown as Response,
      "/projects/proj-uuid-123/states/": statesResponse as unknown as Response,
    }));

    const provider = createPlaneProvider(planeConfig);
    const tickets = await provider.fetchReadyTickets();

    expect(tickets).toEqual([]);

    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  test("transitionStatus fetches states then patches issue", async () => {
    const patchResponse = {
      ok: true,
      json: async () => ({}),
    };

    const originalFetch = globalThis.fetch;
    mockFetch(createMockFetchFn({
      "/projects/proj-uuid-123/states/": statesResponse as unknown as Response,
      "/projects/proj-uuid-123/": projectResponse as unknown as Response,
      "/issues/": patchResponse as unknown as Response,
    }));

    const provider = createPlaneProvider(planeConfig);
    await provider.transitionStatus("issue-uuid-1", "Verification");

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  test("transitionStatus throws when state name not found", async () => {
    const limitedStatesResponse = {
      ok: true,
      json: async () => ({
        results: [
          { id: "state-1", name: "Backlog", group: "backlog" },
        ],
      }),
    };

    const originalFetch = globalThis.fetch;
    mockFetch(createMockFetchFn({
      "/projects/proj-uuid-123/states/": limitedStatesResponse as unknown as Response,
      "/projects/proj-uuid-123/": projectResponse as unknown as Response,
    }));

    const provider = createPlaneProvider(planeConfig);
    await expect(provider.transitionStatus("issue-uuid-1", "Verification")).rejects.toThrow(
      'Plane state "Verification" not found'
    );

    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  test("postComment calls Plane comments API", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ id: "comment-1" }),
    };

    const originalFetch = globalThis.fetch;
    mockFetch(mock(() => Promise.resolve(mockResponse as Response)) as unknown as typeof fetch);

    const provider = createPlaneProvider(planeConfig);
    await provider.postComment("issue-uuid-1", "Test comment");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const call = calls[0]!;
    expect(call[0]).toContain("/issues/issue-uuid-1/comments/");
    expect(call[1].method).toBe("POST");

    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });
});
