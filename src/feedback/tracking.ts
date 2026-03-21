export interface TrackedPR {
  ticketId: string;
  ticketIdentifier: string;
  prNumber: number;
  branch: string;
  lastCommentCheck: string;
}

export interface PRTracker {
  track(entry: TrackedPR): void;
  untrack(ticketId: string): void;
  get(ticketId: string): TrackedPR | undefined;
  getAll(): TrackedPR[];
}

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
