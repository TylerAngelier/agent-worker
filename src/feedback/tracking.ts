/** @module src/feedback/tracking — In-memory PR tracker that maps tickets to their associated pull requests */

/**
 * In-memory record tracking the association between a ticket and its pull request.
 */
export interface TrackedPR {
  /** Internal provider ID of the ticket. */
  ticketId: string;
  /** Human-readable ticket identifier (e.g. "ENG-123"). */
  ticketIdentifier: string;
  /** Pull request number on the SCM platform. `0` if the PR has not yet been discovered. */
  prNumber: number;
  /** Git branch name associated with the pull request. */
  branch: string;
  /** ISO 8601 timestamp of the last time comments were polled for this ticket/PR. */
  lastCommentCheck: string;
}

/**
 * In-memory store for tracking PRs associated with tickets.
 * Provides CRUD operations backed by a `Map<ticketId, TrackedPR>`.
 */
export interface PRTracker {
  /**
   * Registers or updates a tracked PR entry.
   * @param entry - The tracking data to store.
   */
  track(entry: TrackedPR): void;
  /**
   * Removes a ticket from the tracker.
   * @param ticketId - Internal provider ID of the ticket to untrack.
   */
  untrack(ticketId: string): void;
  /**
   * Retrieves the tracked PR entry for a ticket.
   * @param ticketId - Internal provider ID of the ticket.
   * @returns The tracked PR entry, or `undefined` if not tracked.
   */
  get(ticketId: string): TrackedPR | undefined;
  /**
   * Returns all tracked PR entries.
   * @returns Array of all tracked PR records.
   */
  getAll(): TrackedPR[];
}

/**
 * Factory that creates a new in-memory PR tracker backed by a `Map`.
 * @returns A new {@link PRTracker} instance.
 */
export function createPRTracker(): PRTracker {
  const tracked = new Map<string, TrackedPR>();

  return {
    track(entry) {
      tracked.set(entry.ticketId, entry);
    },

    untrack(ticketId) {
      tracked.delete(ticketId);
    },

    get(ticketId) {
      return tracked.get(ticketId);
    },

    getAll() {
      return Array.from(tracked.values());
    },
  };
}
