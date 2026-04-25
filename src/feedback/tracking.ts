/** @module src/feedback/tracking — PR tracker that maps tickets to their associated pull requests */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { log } from "../logger.ts";

/**
 * Record tracking the association between a ticket and its pull request.
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
 * File format for persistent PR tracking.
 */
interface TrackingFile {
  version: 1;
  entries: Record<string, TrackedPR>;
}

/**
 * Store for tracking PRs associated with tickets.
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

/** Load entries from a JSON file. Returns empty map on missing or corrupted file. */
function loadFromFile(filePath: string): Map<string, TrackedPR> {
  if (!existsSync(filePath)) {
    return new Map();
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const data: TrackingFile = JSON.parse(raw);

    if (data.version !== 1 || typeof data.entries !== "object" || data.entries === null) {
      log.warn("PR tracking file has unexpected format, starting fresh", { filePath });
      return new Map();
    }

    // Basic field validation — local operational file so full schema check is overkill,
    // but guard against completely malformed entries.
    const map = new Map<string, TrackedPR>();
    for (const [id, entry] of Object.entries(data.entries)) {
      if (typeof entry === "object" && entry !== null && "ticketId" in entry && "branch" in entry) {
        map.set(id, entry as TrackedPR);
      } else {
        log.warn("Skipping malformed PR tracking entry", { id });
      }
    }
    return map;
  } catch (err) {
    log.warn("Failed to load PR tracking file, starting fresh", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
}

/** Atomically write entries to a JSON file via temp file + rename. */
function saveToFile(filePath: string, tracked: Map<string, TrackedPR>): void {
  const entries: Record<string, TrackedPR> = {};
  for (const [id, entry] of tracked) {
    entries[id] = entry;
  }

  const payload: TrackingFile = { version: 1, entries };
  const json = JSON.stringify(payload, null, 2);

  // Ensure directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write to temp file then rename for atomicity
  const tempPath = join(
    dir,
    `.agent-worker-pr-tracking-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  );

  try {
    writeFileSync(tempPath, json, "utf-8");
    renameSync(tempPath, filePath);
  } catch (err) {
    // Clean up temp file if rename failed
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}

/**
 * Factory that creates a PR tracker.
 * When `filePath` is provided, entries are persisted to a JSON file with atomic writes.
 * When omitted, operates as a pure in-memory store (backward compatible).
 * @param options - Optional configuration. Pass `filePath` for file-backed persistence.
 * @returns A new {@link PRTracker} instance.
 */
export function createPRTracker(options?: { filePath?: string }): PRTracker {
  const tracked = options?.filePath
    ? loadFromFile(options.filePath)
    : new Map<string, TrackedPR>();

  const filePath = options?.filePath;

  const persist = () => {
    if (filePath) {
      saveToFile(filePath, tracked);
    }
  };

  return {
    track(entry) {
      tracked.set(entry.ticketId, entry);
      persist();
    },

    untrack(ticketId) {
      tracked.delete(ticketId);
      persist();
    },

    get(ticketId) {
      return tracked.get(ticketId);
    },

    getAll() {
      return Array.from(tracked.values());
    },
  };
}
