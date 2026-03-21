import type { Ticket, TicketComment, TicketProvider } from "./types.ts";
import type { JiraProviderConfig } from "../config.ts";
import type { Logger } from "../logger.ts";

const INITIAL_DELAY_MS = 1000;
const JITTER_MS = 500;
const MAX_DELAY_MS = 60000;
const MAX_BACKOFF_RETRIES = 5;

async function withBackoff<T>(
  fn: () => Promise<T>,
  logger?: Logger,
  maxRetries: number = MAX_BACKOFF_RETRIES
): Promise<T> {
  let delay = INITIAL_DELAY_MS;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        (err instanceof Error && err.message.includes("429")) ||
        (err instanceof Error && err.message.toLowerCase().includes("ratelimit"));

      if (!isRateLimit || attempt === maxRetries) throw err;

      logger?.debug("Rate limited, backing off", { attempt, delayMs: delay + Math.random() * JITTER_MS });
      const jitter = Math.random() * JITTER_MS;
      await Bun.sleep(delay + jitter);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
  throw new Error("Unreachable");
}

interface JiraSearchResponse {
  issues: JiraIssue[];
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: string | null;
  };
}

interface JiraTransitionsResponse {
  transitions: { id: string; name: string }[];
}

interface JiraComment {
  id: string;
  author: { name: string; displayName: string };
  body: string;
  created: string;
}

interface JiraCommentsResponse {
  comments: JiraComment[];
}

export function createJiraProvider(config: JiraProviderConfig, logger?: Logger): TicketProvider {
  const log = logger?.child("jira");
  const username = process.env.JIRA_USERNAME;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!username || !apiToken) {
    throw new Error("JIRA_USERNAME and JIRA_API_TOKEN environment variables are required for Jira provider");
  }

  const baseUrl = config.base_url.replace(/\/+$/, "");
  const authHeader = "Basic " + btoa(`${username}:${apiToken}`);

  async function jiraFetch(path: string, options?: RequestInit): Promise<Response> {
    const url = `${baseUrl}/rest/api/2${path}`;
    log?.debug("Jira API request", { method: options?.method ?? "GET", path });
    const start = Date.now();
    const res = await withBackoff(() =>
      fetch(url, {
        ...options,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          ...options?.headers,
        },
      }),
      log
    );
    log?.debug("Jira API response", { path, status: res.status, durationMs: Date.now() - start });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Jira API error ${res.status}: ${text}`);
    }
    return res;
  }

  return {
    async fetchReadyTickets(): Promise<Ticket[]> {
      log?.debug("Fetching ready tickets", { jql: config.jql });
      const jql = encodeURIComponent(config.jql);
      const res = await jiraFetch(`/search?jql=${jql}&maxResults=1`);
      const data = (await res.json()) as JiraSearchResponse;

      const tickets = data.issues.map((issue) => ({
        id: issue.id,
        identifier: issue.key,
        title: issue.fields.summary,
        description: issue.fields.description ?? undefined,
      }));
      log?.debug("Fetched ready tickets", { count: tickets.length });
      return tickets;
    },

    async fetchTicketsByStatus(statusName: string): Promise<Ticket[]> {
      log?.debug("Fetching tickets by status", { status: statusName });
      const jql = encodeURIComponent(config.jql.replace(/status\s*=\s*'[^']*'/, `status = '${statusName}'`));
      const res = await jiraFetch(`/search?jql=${jql}&maxResults=50`);
      const data = (await res.json()) as JiraSearchResponse;

      const tickets = data.issues.map((issue) => ({
        id: issue.id,
        identifier: issue.key,
        title: issue.fields.summary,
        description: issue.fields.description ?? undefined,
      }));
      log?.debug("Fetched tickets by status", { status: statusName, count: tickets.length });
      return tickets;
    },

    async transitionStatus(ticketId: string, statusName: string): Promise<void> {
      log?.debug("Transitioning ticket status", { ticketId, to: statusName });
      const res = await jiraFetch(`/issue/${ticketId}/transitions`);
      const data = (await res.json()) as JiraTransitionsResponse;
      const transition = data.transitions.find((t) => t.name === statusName);
      if (!transition) {
        throw new Error(`Jira transition "${statusName}" not found for issue ${ticketId}. Available: ${data.transitions.map((t) => t.name).join(", ")}`);
      }

      await jiraFetch(`/issue/${ticketId}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: transition.id } }),
      });
      log?.debug("Ticket status transitioned", { ticketId, to: statusName });
    },

    async postComment(ticketId: string, body: string): Promise<void> {
      log?.debug("Posting comment", { ticketId, bodyLength: body.length });
      await jiraFetch(`/issue/${ticketId}/comment`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    },

    async fetchComments(ticketId: string, since?: string): Promise<TicketComment[]> {
      log?.debug("Fetching comments", { ticketId, since });
      const params = new URLSearchParams();
      if (since) params.set("since", since);
      const query = params.toString() ? `?${params}` : "";
      const res = await jiraFetch(`/issue/${ticketId}/comment${query}`);
      const data = (await res.json()) as JiraCommentsResponse;

      const results = data.comments.map((c) => ({
        id: c.id,
        author: c.author.displayName || c.author.name,
        body: c.body,
        createdAt: c.created,
      }));
      log?.debug("Fetched comments", { ticketId, count: results.length });
      return results;
    },
  };
}
