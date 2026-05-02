/**
 * @module src/providers/linear — Linear ticket provider implementation using the Linear SDK.
 */
import { LinearClient } from "@linear/sdk";
import type { Ticket, TicketComment, TicketProvider } from "./types.ts";
import type { LinearProviderConfig } from "../config.ts";
import { log } from "../logger.ts";
import { withBackoff } from "./backoff.ts";

/**
 * Creates a Linear ticket provider backed by the Linear GraphQL SDK.
 *
 * Requires the `LINEAR_API_KEY` environment variable. Workflow states are
 * fetched lazily and cached per team to avoid repeated API calls during
 * status transitions.
 *
 * @param config - Provider configuration including `project_id` and status name mappings.
 * @returns A {@link TicketProvider} instance.
 * @throws Error if `LINEAR_API_KEY` is not set in the environment.
 */
export function createLinearProvider(config: LinearProviderConfig): TicketProvider {
  const logger = log.child("linear");
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY environment variable is required for Linear provider");
  }

  const client = new LinearClient({ apiKey });
  const stateCache = new Map<string, { id: string; name: string }[]>();

  /**
   * Fetches and caches workflow states for a Linear team.
   *
   * Results are cached in-memory by team ID so subsequent calls for the same
   * team return instantly without additional API requests.
   *
   * @param teamId - The Linear team UUID.
   * @returns Array of `{ id, name }` objects representing the team's workflow states.
   */
  async function getTeamStates(teamId: string): Promise<{ id: string; name: string }[]> {
    if (stateCache.has(teamId)) return stateCache.get(teamId)!;
    logger.debug("Fetching team states", { teamId });
    const team = await withBackoff(() => client.team(teamId), "linear");
    const states = await withBackoff(() => team.states(), "linear");
    const nodes = states.nodes.map((s) => ({ id: s.id, name: s.name }));
    stateCache.set(teamId, nodes);
    logger.debug("Cached team states", { teamId, count: nodes.length });
    return nodes;
  }

  return {
    async fetchReadyTickets(): Promise<Ticket[]> {
      logger.debug("Fetching ready tickets", { projectId: config.project_id, status: config.statuses.ready });
      const issues = await withBackoff(() =>
        client.issues({
          filter: {
            project: { id: { eq: config.project_id } },
            state: { name: { eq: config.statuses.ready } },
          },
        }),
        "linear"
      );

      const tickets = issues.nodes.map((issue) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
      }));
      logger.debug("Fetched ready tickets", { count: tickets.length });
      return tickets;
    },

    async fetchTicketsByStatus(statusName: string): Promise<Ticket[]> {
      logger.debug("Fetching tickets by status", { projectId: config.project_id, status: statusName });
      const issues = await withBackoff(() =>
        client.issues({
          filter: {
            project: { id: { eq: config.project_id } },
            state: { name: { eq: statusName } },
          },
        }),
        "linear"
      );

      const tickets = issues.nodes.map((issue) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
      }));
      logger.debug("Fetched tickets by status", { status: statusName, count: tickets.length });
      return tickets;
    },

    async transitionStatus(ticketId: string, statusName: string): Promise<void> {
      logger.debug("Transitioning ticket status", { ticketId, to: statusName });
      const issue = await withBackoff(() => client.issue(ticketId), "linear");
      const team = await issue.team;
      if (!team) throw new Error(`No team found for issue ${ticketId}`);

      const states = await getTeamStates(team.id);
      const target = states.find((s) => s.name === statusName);
      if (!target) throw new Error(`Status "${statusName}" not found on team`);

      await withBackoff(() => client.updateIssue(ticketId, { stateId: target.id }), "linear");
      logger.debug("Ticket status transitioned", { ticketId, to: statusName });
    },

    async postComment(ticketId: string, body: string): Promise<void> {
      logger.debug("Posting comment", { ticketId, bodyLength: body.length });
      await withBackoff(() =>
        client.createComment({ issueId: ticketId, body }),
        "linear"
      );
    },

    async fetchComments(ticketId: string, since?: string): Promise<TicketComment[]> {
      logger.debug("Fetching comments", { ticketId, since });
      const issue = await withBackoff(() => client.issue(ticketId), "linear");
      const connection = await withBackoff(() => issue.comments(), "linear");
      const comments = connection.nodes;

      let results = comments.map((c) => ({
        id: c.id,
        author: c.body ?? "unknown",
        body: c.body,
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
      }));

      if (since) {
        const sinceDate = new Date(since);
        results = results.filter((c) => new Date(c.createdAt) > sinceDate);
      }

      logger.debug("Fetched comments", { ticketId, total: comments.length, filtered: results.length });
      return results;
    },
  };
}
