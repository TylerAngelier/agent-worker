import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Regression tests for the Linear provider.
 *
 * The Linear SDK client is constructed internally, making unit testing
 * without dependency injection difficult. These tests focus on:
 * 1. Source-level regression guards (catches copy-paste bugs)
 * 2. Provider construction validation
 * 3. Contract shape checks
 */

// Re-import to verify module loads cleanly
import { createLinearProvider } from "../src/providers/linear.ts";

const linearConfig = {
  type: "linear" as const,
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
  test("throws when LINEAR_API_KEY is not set", () => {
    delete process.env.LINEAR_API_KEY;
    expect(() => createLinearProvider(linearConfig)).toThrow(
      "LINEAR_API_KEY environment variable is required"
    );
  });

  test("returns a TicketProvider with all required methods", () => {
    process.env.LINEAR_API_KEY = "lin_api_test123";
    const provider = createLinearProvider(linearConfig);
    expect(typeof provider.fetchReadyTickets).toBe("function");
    expect(typeof provider.fetchTicketsByStatus).toBe("function");
    expect(typeof provider.transitionStatus).toBe("function");
    expect(typeof provider.postComment).toBe("function");
    expect(typeof provider.fetchComments).toBe("function");
    delete process.env.LINEAR_API_KEY;
  });
});

describe("Linear fetchComments author mapping (regression)", () => {
  test("author is mapped to userId, not body", () => {
    // Regression guard: a previous bug set author to c.body instead of c.userId.
    // We check the source to ensure the mapping is correct.
    const src = readFileSync(
      resolve(__dirname, "../src/providers/linear.ts"),
      "utf-8"
    );

    // Find the fetchComments mapping block
    const authorLine = src.match(/author:\s*c\.(\w+)/);
    expect(authorLine).not.toBeNull();
    expect(authorLine![1]).toBe("userId");
    expect(authorLine![1]).not.toBe("body");
  });
});
