/**
 * @module src/providers/jira — Jira ticket provider implementation using REST API v2.
 */
import type { Ticket, TicketComment, TicketProvider } from "./types.ts";
import type { JiraProviderConfig } from "../config.ts";
import { log } from "../logger.ts";
import { createHttpClient, type HttpClient } from "../internal/http.ts";

/** Jira search API response shape for issue queries. */
interface JiraSearchResponse {
  issues: JiraIssue[];
}

/** Individual issue returned by the Jira search API. */
interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: string | null;
  };
}

/** Jira available transitions response shape. */
interface JiraTransitionsResponse {
  transitions: { id: string; name: string }[];
}

/** Jira comment with author display information. */
interface JiraComment {
  id: string;
  author: { name: string; displayName: string };
  body: string;
  created: string;
}

/** Paginated Jira comments response shape. */
interface JiraCommentsResponse {
  comments: JiraComment[];
}

/**
 * Creates a Jira ticket provider using the Jira REST API v2 with HTTP Basic auth.
 *
 * Requires the `JIRA_USERNAME` and `JIRA_API_TOKEN` environment variables.
 * The provider uses the configured `jql` query to fetch ready tickets and
 * dynamically replaces the status clause for status-based queries.
 *
 * @param config - Provider configuration including `base_url`, `jql`, and status name mappings.
 * @returns A {@link TicketProvider} instance.
 * @throws Error if `JIRA_USERNAME` or `JIRA_API_TOKEN` is not set in the environment.
 */
export function createJiraProvider(config: JiraProviderConfig): TicketProvider {
  const logger = log.child("jira");
  const username = process.env.JIRA_USERNAME;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!username || !apiToken) {
    throw new Error("JIRA_USERNAME and JIRA_API_TOKEN environment variables are required for Jira provider");
  }

  const baseUrl = config.base_url.replace(/\/+$/, "");
  const authHeader = "Basic " + btoa(`${username}:${apiToken}`);

  const http: HttpClient = createHttpClient({
    baseUrl: `${baseUrl}/rest/api/2`,
    defaultHeaders: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    componentName: "jira",
    backoff: {},
  });

  return {
    async fetchReadyTickets(): Promise<Ticket[]> {
      logger.debug("Fetching ready tickets", { jql: config.jql });
      const jql = encodeURIComponent(config.jql);
      const { data } = await http.request<JiraSearchResponse>({ path: `/search?jql=${jql}&maxResults=1` });

      const tickets = data.issues.map((issue) => ({
        id: issue.id,
        identifier: issue.key,
        title: issue.fields.summary,
        description: issue.fields.description ?? undefined,
      }));
      logger.debug("Fetched ready tickets", { count: tickets.length });
      return tickets;
    },

    async fetchTicketsByStatus(statusName: string): Promise<Ticket[]> {
      logger.debug("Fetching tickets by status", { status: statusName });
      const jql = encodeURIComponent(config.jql.replace(/status\s*=\s*'[^']*'/, `status = '${statusName}'`));
      const { data } = await http.request<JiraSearchResponse>({ path: `/search?jql=${jql}&maxResults=50` });

      const tickets = data.issues.map((issue) => ({
        id: issue.id,
        identifier: issue.key,
        title: issue.fields.summary,
        description: issue.fields.description ?? undefined,
      }));
      logger.debug("Fetched tickets by status", { status: statusName, count: tickets.length });
      return tickets;
    },

    async transitionStatus(ticketId: string, statusName: string): Promise<void> {
      logger.debug("Transitioning ticket status", { ticketId, to: statusName });
      const { data: transData } = await http.request<JiraTransitionsResponse>({ path: `/issue/${ticketId}/transitions` });
      const transition = transData.transitions.find((t) => t.name === statusName);
      if (!transition) {
        throw new Error(`Jira transition "${statusName}" not found for issue ${ticketId}. Available: ${transData.transitions.map((t) => t.name).join(", ")}`);
      }

      await http.request({
        method: "POST",
        path: `/issue/${ticketId}/transitions`,
        body: { transition: { id: transition.id } },
      });
      logger.debug("Ticket status transitioned", { ticketId, to: statusName });
    },

    async postComment(ticketId: string, body: string): Promise<void> {
      logger.debug("Posting comment", { ticketId, bodyLength: body.length });
      await http.request({
        method: "POST",
        path: `/issue/${ticketId}/comment`,
        body: { body },
      });
    },

    async fetchComments(ticketId: string, since?: string): Promise<TicketComment[]> {
      logger.debug("Fetching comments", { ticketId, since });
      const params = new URLSearchParams();
      if (since) params.set("since", since);
      const query = params.toString() ? `?${params}` : "";
      const { data } = await http.request<JiraCommentsResponse>({ path: `/issue/${ticketId}/comment${query}` });

      const results = data.comments.map((c) => ({
        id: c.id,
        author: c.author.displayName || c.author.name,
        body: c.body,
        createdAt: c.created,
      }));
      logger.debug("Fetched comments", { ticketId, count: results.length });
      return results;
    },
  };
}
