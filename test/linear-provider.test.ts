import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createLinearProvider } from "../src/providers/linear.ts";
import type { LinearProviderConfig } from "../src/config.ts";

const linearConfig: LinearProviderConfig = {
  type: "linear",
  project_id: "proj-123",
  poll_interval_seconds: 60,
  statuses: {
    ready: "Todo",
    in_progress: "In Progress",
    code_review: "In Review",
    verification: "Done",
    failed: "Canceled",
  },
};

describe("createLinearProvider", () => {
  beforeEach(() => {
    process.env.LINEAR_API_KEY = "lin_api_testkey";
  });

  afterEach(() => {
    delete process.env.LINEAR_API_KEY;
  });

  test("throws when LINEAR_API_KEY is not set", () => {
    delete process.env.LINEAR_API_KEY;
    expect(() => createLinearProvider(linearConfig)).toThrow(
      "LINEAR_API_KEY environment variable is required"
    );
  });

  test("returns a TicketProvider with required methods", () => {
    const provider = createLinearProvider(linearConfig);
    expect(typeof provider.fetchReadyTickets).toBe("function");
    expect(typeof provider.fetchTicketsByStatus).toBe("function");
    expect(typeof provider.transitionStatus).toBe("function");
    expect(typeof provider.postComment).toBe("function");
    expect(typeof provider.fetchComments).toBe("function");
  });
});
