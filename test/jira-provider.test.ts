import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createJiraProvider } from "../src/providers/jira.ts";

const jiraConfig = {
  type: "jira" as const,
  base_url: "https://jira.example.com",
  poll_interval_seconds: 60,
  jql: "project = FOO AND status = 'Todo'",
  statuses: {
    ready: "Todo",
    in_progress: "In Progress",
    done: "Done",
    failed: "Canceled",
  },
};

describe("createJiraProvider", () => {
  beforeEach(() => {
    process.env.JIRA_USERNAME = "testuser";
    process.env.JIRA_API_TOKEN = "testtoken";
  });

  afterEach(() => {
    delete process.env.JIRA_USERNAME;
    delete process.env.JIRA_API_TOKEN;
  });

  test("throws when JIRA_USERNAME is not set", () => {
    delete process.env.JIRA_USERNAME;
    expect(() => createJiraProvider(jiraConfig)).toThrow(
      "JIRA_USERNAME and JIRA_API_TOKEN environment variables are required"
    );
  });

  test("throws when JIRA_API_TOKEN is not set", () => {
    delete process.env.JIRA_API_TOKEN;
    expect(() => createJiraProvider(jiraConfig)).toThrow(
      "JIRA_USERNAME and JIRA_API_TOKEN environment variables are required"
    );
  });

  test("returns a TicketProvider with required methods", () => {
    const provider = createJiraProvider(jiraConfig);
    expect(typeof provider.fetchReadyTickets).toBe("function");
    expect(typeof provider.transitionStatus).toBe("function");
    expect(typeof provider.postComment).toBe("function");
  });

  test("fetchReadyTickets calls Jira search API with encoded JQL", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        issues: [
          {
            id: "10001",
            key: "FOO-42",
            fields: {
              summary: "Fix the bug",
              description: "Description here",
            },
          },
        ],
      }),
    };

    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response));

    const provider = createJiraProvider(jiraConfig);
    const tickets = await provider.fetchReadyTickets();

    expect(tickets).toHaveLength(1);
    expect(tickets[0].id).toBe("10001");
    expect(tickets[0].identifier).toBe("FOO-42");
    expect(tickets[0].title).toBe("Fix the bug");
    expect(tickets[0].description).toBe("Description here");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0][0] as string;
    expect(calledUrl).toContain("jql=");
    expect(calledUrl).toContain("maxResults=1");
  });

  test("fetchReadyTickets handles null description", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        issues: [
          {
            id: "10002",
            key: "FOO-43",
            fields: {
              summary: "No desc",
              description: null,
            },
          },
        ],
      }),
    };

    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response));

    const provider = createJiraProvider(jiraConfig);
    const tickets = await provider.fetchReadyTickets();

    expect(tickets[0].description).toBeUndefined();
  });

  test("fetchReadyTickets returns empty array when no issues", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ issues: [] }),
    };

    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response));

    const provider = createJiraProvider(jiraConfig);
    const tickets = await provider.fetchReadyTickets();

    expect(tickets).toEqual([]);
  });

  test("transitionStatus finds transition by name and calls POST", async () => {
    const getTransitionsResponse = {
      ok: true,
      json: async () => ({
        transitions: [
          { id: "11", name: "In Progress" },
          { id: "21", name: "Done" },
        ],
      }),
    };

    const postTransitionResponse = {
      ok: true,
      json: async () => ({}),
    };

    globalThis.fetch = mock((url: string, options?: RequestInit) => {
      if (url.includes("/transitions") && (!options || options.method !== "POST")) {
        return Promise.resolve(getTransitionsResponse as Response);
      }
      return Promise.resolve(postTransitionResponse as Response);
    });

    const provider = createJiraProvider(jiraConfig);
    await provider.transitionStatus("FOO-42", "In Progress");

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test("transitionStatus throws when transition name not found", async () => {
    const getTransitionsResponse = {
      ok: true,
      json: async () => ({
        transitions: [
          { id: "11", name: "Some Other Status" },
        ],
      }),
    };

    globalThis.fetch = mock(() => Promise.resolve(getTransitionsResponse as Response));

    const provider = createJiraProvider(jiraConfig);
    await expect(provider.transitionStatus("FOO-42", "In Progress")).rejects.toThrow(
      'Jira transition "In Progress" not found'
    );
  });

  test("postComment calls Jira comment API", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ id: "comment-1" }),
    };

    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response));

    const provider = createJiraProvider(jiraConfig);
    await provider.postComment("FOO-42", "Test comment");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const call = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call[0]).toContain("/issue/FOO-42/comment");
    expect(call[1].method).toBe("POST");
  });
});
