/**
 * @module src/providers/plane — Plane ticket provider implementation using REST API v1.
 */
import type { Ticket, TicketComment, TicketProvider } from "./types.ts";
import type { PlaneProviderConfig } from "../config.ts";
import { log } from "../logger.ts";
import { createHttpClient, type HttpClient } from "../internal/http.ts";

/** Plane API issue shape. */
interface PlaneIssue {
  id: string;
  sequence_id: number;
  name: string;
  description_html: string | null;
  state: string;
}

/** Plane paginated issues response shape. */
interface PlaneIssuesResponse {
  results: PlaneIssue[];
}

/** Plane workflow state shape. */
interface PlaneState {
  id: string;
  name: string;
  group: string;
}

/** Plane paginated states response shape. */
interface PlaneStatesResponse {
  results: PlaneState[];
}

/** Plane comment with actor display name. */
interface PlaneComment {
  id: string;
  created_at: string;
  comment_html: string;
  actor: {
    display_name: string;
  };
}

/** Plane paginated comments response shape. */
interface PlaneCommentsResponse {
  results: PlaneComment[];
}

/**
 * Creates a Plane ticket provider using the Plane REST API v1 with `x-api-key` auth.
 *
 * Requires the `PLANE_API_KEY` environment variable. Workflow states and the
 * project identifier are fetched lazily and cached in-memory to avoid redundant
 * API calls.
 *
 * @param config - Provider configuration including `base_url`, `workspace_slug`, `project_id`, `query`, and status name mappings.
 * @returns A {@link TicketProvider} instance.
 * @throws Error if `PLANE_API_KEY` is not set in the environment.
 */
export function createPlaneProvider(config: PlaneProviderConfig): TicketProvider {
  const logger = log.child("plane");
  const apiKey = process.env.PLANE_API_KEY;
  if (!apiKey) {
    throw new Error("PLANE_API_KEY environment variable is required for Plane provider");
  }
  const key: string = apiKey;

  const baseUrl = config.base_url.replace(/\/+$/, "");
  const { workspace_slug, project_id } = config;

  const http: HttpClient = createHttpClient({
    baseUrl: `${baseUrl}/api/v1/workspaces/${workspace_slug}`,
    defaultHeaders: { "x-api-key": key, "Content-Type": "application/json" },
    componentName: "plane",
    backoff: {},
  });

  const stateCache = new Map<string, PlaneState[]>();
  let projectIdentifier: string | undefined;

  /**
   * Fetches and caches project workflow states.
   *
   * Results are cached in-memory by project ID so subsequent calls return
   * instantly without additional API requests.
   *
   * @returns Array of {@link PlaneState} objects for the configured project.
   */
  async function getStates(): Promise<PlaneState[]> {
    if (stateCache.has(project_id)) return stateCache.get(project_id)!;
    logger.debug("Fetching project states", { projectId: project_id });
    const { data } = await http.request<PlaneStatesResponse>({ path: `/projects/${project_id}/states/` });
    const states = data.results;
    stateCache.set(project_id, states);
    logger.debug("Cached project states", { projectId: project_id, count: states.length });
    return states;
  }

  /**
   * Fetches and caches the project's short identifier (e.g. "ENG").
   *
   * Used to build human-readable issue identifiers like "ENG-42".
   * Cached after the first fetch.
   *
   * @returns The project's short identifier string.
   */
  async function getProjectIdentifier(): Promise<string> {
    if (projectIdentifier) return projectIdentifier;
    logger.debug("Fetching project identifier", { projectId: project_id });
    const { data } = await http.request<{ identifier: string }>({ path: `/projects/${project_id}/` });
    projectIdentifier = data.identifier;
    return projectIdentifier;
  }

  /**
   * Constructs a human-readable issue identifier from a project prefix and sequence number.
   *
   * @param issue - The Plane issue object containing the `sequence_id`.
   * @param identifier - The project's short identifier (e.g. "ENG").
   * @returns A formatted identifier string like "ENG-42".
   */
  function makeIdentifier(issue: PlaneIssue, identifier: string): string {
    return `${identifier}-${issue.sequence_id}`;
  }

  return {
    async fetchReadyTickets(): Promise<Ticket[]> {
      logger.debug("Fetching ready tickets", { projectId: project_id, query: config.query });
      const identifier = await getProjectIdentifier();
      const states = await getStates();
      const readyState = states.find((s) => s.name === config.statuses.ready);
      const readyStateId = readyState?.id;

      const params = new URLSearchParams();
      params.set("query", config.query);
      const { data } = await http.request<PlaneIssuesResponse>({ path: `/projects/${project_id}/issues/?${params}` });

      const tickets = data.results
        .filter((issue) => !readyStateId || issue.state === readyStateId)
        .map((issue) => ({
          id: issue.id,
          identifier: makeIdentifier(issue, identifier),
          title: issue.name,
          description: issue.description_html ?? undefined,
        }));
      logger.debug("Fetched ready tickets", { count: tickets.length });
      return tickets;
    },

    async fetchTicketsByStatus(statusName: string): Promise<Ticket[]> {
      logger.debug("Fetching tickets by status", { projectId: project_id, status: statusName });
      const states = await getStates();
      const target = states.find((s) => s.name === statusName);
      if (!target) return [];

      const identifier = await getProjectIdentifier();
      const params = new URLSearchParams();
      params.set("query", `state:${target.id}`);
      const { data } = await http.request<PlaneIssuesResponse>({ path: `/projects/${project_id}/issues/?${params}` });

      const tickets = data.results
        .filter((issue) => issue.state === target.id)
        .map((issue) => ({
          id: issue.id,
          identifier: makeIdentifier(issue, identifier),
          title: issue.name,
          description: issue.description_html ?? undefined,
        }));
      logger.debug("Fetched tickets by status", { status: statusName, count: tickets.length });
      return tickets;
    },

    async transitionStatus(ticketId: string, statusName: string): Promise<void> {
      logger.debug("Transitioning ticket status", { ticketId, to: statusName });
      const states = await getStates();
      const target = states.find((s) => s.name === statusName);
      if (!target) {
        throw new Error(`Plane state "${statusName}" not found for project ${project_id}. Available: ${states.map((s) => s.name).join(", ")}`);
      }

      await http.request({
        method: "PATCH",
        path: `/projects/${project_id}/issues/${ticketId}/`,
        body: { state: target.id },
      });
      logger.debug("Ticket status transitioned", { ticketId, to: statusName, stateId: target.id });
    },

    async postComment(ticketId: string, body: string): Promise<void> {
      logger.debug("Posting comment", { ticketId, bodyLength: body.length });
      await http.request({
        method: "POST",
        path: `/projects/${project_id}/issues/${ticketId}/comments/`,
        body: { comment_html: body },
      });
    },

    async fetchComments(ticketId: string, since?: string): Promise<TicketComment[]> {
      logger.debug("Fetching comments", { ticketId, since });
      const { data } = await http.request<PlaneCommentsResponse>({ path: `/projects/${project_id}/issues/${ticketId}/comments/` });

      let results = data.results.map((c) => ({
        id: c.id,
        author: c.actor.display_name,
        body: c.comment_html,
        createdAt: c.created_at,
      }));

      if (since) {
        const sinceDate = new Date(since);
        results = results.filter((c) => new Date(c.createdAt) > sinceDate);
      }

      logger.debug("Fetched comments", { ticketId, total: data.results.length, filtered: results.length });
      return results;
    },
  };
}
