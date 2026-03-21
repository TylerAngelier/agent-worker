import { LinearClient } from "@linear/sdk";
import type { Ticket, TicketComment, TicketProvider } from "./types.ts";
import type { LinearProviderConfig } from "../config.ts";

const INITIAL_DELAY_MS = 1000;
const JITTER_MS = 500;
const MAX_DELAY_MS = 60000;
const MAX_BACKOFF_RETRIES = 5;

async function withBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_BACKOFF_RETRIES
): Promise<T> {
  let delay = INITIAL_DELAY_MS;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        (err instanceof Error && err.message.toLowerCase().includes("ratelimit")) ||
        (err instanceof Error && err.message.includes("429"));

      if (!isRateLimit || attempt === maxRetries) throw err;

      const jitter = Math.random() * JITTER_MS;
      await Bun.sleep(delay + jitter);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
  throw new Error("Unreachable");
}

export function createLinearProvider(config: LinearProviderConfig): TicketProvider {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY environment variable is required for Linear provider");
  }

  const client = new LinearClient({ apiKey });
  const stateCache = new Map<string, { id: string; name: string }[]>();

  async function getTeamStates(teamId: string): Promise<{ id: string; name: string }[]> {
    if (stateCache.has(teamId)) return stateCache.get(teamId)!;
    const team = await client.team(teamId);
    const states = await team.states();
    const nodes = states.nodes.map((s) => ({ id: s.id, name: s.name }));
    stateCache.set(teamId, nodes);
    return nodes;
  }

  return {
    async fetchReadyTickets(): Promise<Ticket[]> {
      const issues = await withBackoff(() =>
        client.issues({
          filter: {
            project: { id: { eq: config.project_id } },
            state: { name: { eq: config.statuses.ready } },
          },
        })
      );

      return issues.nodes.map((issue) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
      }));
    },

    async fetchTicketsByStatus(statusName: string): Promise<Ticket[]> {
      const issues = await withBackoff(() =>
        client.issues({
          filter: {
            project: { id: { eq: config.project_id } },
            state: { name: { eq: statusName } },
          },
        })
      );

      return issues.nodes.map((issue) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
      }));
    },

    async transitionStatus(ticketId: string, statusName: string): Promise<void> {
      const issue = await withBackoff(() => client.issue(ticketId));
      const team = await issue.team;
      if (!team) throw new Error(`No team found for issue ${ticketId}`);

      const states = await getTeamStates(team.id);
      const target = states.find((s) => s.name === statusName);
      if (!target) throw new Error(`Status "${statusName}" not found on team`);

      await withBackoff(() => client.updateIssue(ticketId, { stateId: target.id }));
    },

    async postComment(ticketId: string, body: string): Promise<void> {
      await withBackoff(() =>
        client.createComment({ issueId: ticketId, body })
      );
    },

    async fetchComments(ticketId: string, since?: string): Promise<TicketComment[]> {
      const issue = await withBackoff(() => client.issue(ticketId));
      const connection = await withBackoff(() => issue.comments());
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

      return results;
    },
  };
}
