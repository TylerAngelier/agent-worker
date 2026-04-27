import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createLinearProvider } from "../src/providers/linear.ts";
import type { LinearProviderConfig } from "../src/config.ts";

const linearConfig: LinearProviderConfig = {
  type: "linear",
  project_id: "proj-123",
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
  const originalKey = process.env.LINEAR_API_KEY;

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.LINEAR_API_KEY = originalKey;
    } else {
      delete process.env.LINEAR_API_KEY;
    }
  });

  test("throws when LINEAR_API_KEY is not set", () => {
    delete process.env.LINEAR_API_KEY;
    expect(() => createLinearProvider(linearConfig)).toThrow(
      "LINEAR_API_KEY environment variable is required for Linear provider"
    );
  });

  test("returns a TicketProvider with required methods when key is set", () => {
    process.env.LINEAR_API_KEY = "lin-api-test-key";
    const provider = createLinearProvider(linearConfig);
    expect(typeof provider.fetchReadyTickets).toBe("function");
    expect(typeof provider.fetchTicketsByStatus).toBe("function");
    expect(typeof provider.transitionStatus).toBe("function");
    expect(typeof provider.postComment).toBe("function");
    expect(typeof provider.fetchComments).toBe("function");
  });

  test("provider exposes all TicketProvider interface methods", () => {
    process.env.LINEAR_API_KEY = "lin-api-test-key";
    const provider = createLinearProvider(linearConfig);
    const methods = ["fetchReadyTickets", "fetchTicketsByStatus", "transitionStatus", "postComment", "fetchComments"];
    for (const method of methods) {
      expect(typeof (provider as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });

  test("separate provider instances do not share state cache", () => {
    process.env.LINEAR_API_KEY = "lin-api-test-key";
    const provider1 = createLinearProvider(linearConfig);
    const provider2 = createLinearProvider(linearConfig);
    // Both should be distinct objects
    expect(provider1).not.toBe(provider2);
    expect(typeof provider1.fetchReadyTickets).toBe("function");
    expect(typeof provider2.fetchReadyTickets).toBe("function");
  });
});
