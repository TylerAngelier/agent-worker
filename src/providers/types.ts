/**
 * @module src/providers/types — Domain types and SPI contract for ticket providers.
 */

/** A ticket from an issue tracker. */
export interface Ticket {
  /** Internal provider ID (e.g. Linear UUID, Jira key). */
  id: string;
  /** Human-readable identifier (e.g. "ENG-123"). */
  identifier: string;
  /** Ticket title. */
  title: string;
  /** Ticket description body. `undefined` when the provider has no description set. */
  description: string | undefined;
}

/** A comment posted on a ticket. */
export interface TicketComment {
  /** Internal comment ID. */
  id: string;
  /** Author username or display name. */
  author: string;
  /** Comment body text (may include markdown). */
  body: string;
  /** ISO 8601 timestamp of when the comment was created. */
  createdAt: string;
}

/**
 * SPI contract for ticket providers.
 *
 * Implementations must not import from `pipeline/`, `scm/`, `feedback/`, or
 * application services. All HTTP requests should use exponential backoff with
 * jitter for rate-limit (429) errors.
 */
export interface TicketProvider {
  /** Fetches all tickets currently in the "ready" status configured in the provider. */
  fetchReadyTickets(): Promise<Ticket[]>;

  /**
   * Fetches tickets matching the given status name.
   * @param statusName - The provider-specific status name to filter by.
   */
  fetchTicketsByStatus(statusName: string): Promise<Ticket[]>;

  /**
   * Transitions a ticket to a new status.
   * @param ticketId - Internal ID of the ticket to transition.
   * @param statusName - Target status name.
   */
  transitionStatus(ticketId: string, statusName: string): Promise<void>;

  /**
   * Posts a comment on a ticket.
   * @param ticketId - Internal ID of the ticket.
   * @param body - Comment body text.
   */
  postComment(ticketId: string, body: string): Promise<void>;

  /**
   * Fetches comments for a ticket, optionally filtered to those created after `since`.
   * @param ticketId - Internal ID of the ticket.
   * @param since - ISO 8601 timestamp. When provided, only comments created after this time are returned.
   */
  fetchComments(ticketId: string, since?: string): Promise<TicketComment[]>;
}
