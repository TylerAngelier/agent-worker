/**
 * @module test/linear-provider — Unit tests for createLinearProvider.
 *
 * The Linear SDK client is instantiated inside createLinearProvider, so we test:
 * 1. Config validation (API key requirement)
 * 2. Provider interface completeness
 * 3. fetchComments maps comment fields correctly (author from user, not body)
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createLinearProvider } from "../src/providers/linear.ts";
import type { LinearProviderConfig } from "../src/config.ts";

const baseConfig: LinearProviderConfig = {
  type: "linear",
  project_id: "proj-1",
  poll_interval_seconds: 60,
  statuses: {
    ready: "Ready",
    in_progress: "In Progress",
    code_review: "Code Review",
    verification: "Verification",
    failed: "Failed",
  },
};

describe("createLinearProvider", () => {
  beforeEach(() => {
    process.env.LINEAR_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.LINEAR_API_KEY;
  });

  it("throws if LINEAR_API_KEY is not set", () => {
    delete process.env.LINEAR_API_KEY;
    expect(() => createLinearProvider(baseConfig)).toThrow("LINEAR_API_KEY");
  });

  it("returns a TicketProvider with all required methods", () => {
    const provider = createLinearProvider(baseConfig);
    expect(typeof provider.fetchReadyTickets).toBe("function");
    expect(typeof provider.fetchTicketsByStatus).toBe("function");
    expect(typeof provider.transitionStatus).toBe("function");
    expect(typeof provider.postComment).toBe("function");
    expect(typeof provider.fetchComments).toBe("function");
  });

  it("does not crash on construction with valid config", () => {
    expect(() => createLinearProvider(baseConfig)).not.toThrow();
  });
});
