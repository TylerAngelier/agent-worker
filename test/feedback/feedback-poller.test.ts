import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { hasAgentReaction } from "../../src/feedback/feedback-poller.ts";
import { initLogger } from "../../src/logger.ts";
import type { ScmProvider } from "../../src/scm/types.ts";

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
  initLogger({ level: "error" });
});

afterEach(() => {
  (console.log as ReturnType<typeof spyOn>).mockRestore();
});

function createMockScm(reactions: Record<string, boolean>): ScmProvider {
  return {
    findPullRequest: async () => null,
    getPRComments: async () => [],
    isPRMerged: async () => false,
    getPRMergeInfo: async () => null,
    hasCommentReaction: async (_commentId, _commentType, reaction) => {
      return reactions[reaction] ?? false;
    },
    addCommentReaction: async () => {},
    replyToComment: async () => {},
  };
}

describe("hasAgentReaction", () => {
  test("returns true when comment has eyes reaction", async () => {
    const scm = createMockScm({ eyes: true });
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(true);
  });

  test("returns true when comment has +1 reaction", async () => {
    const scm = createMockScm({ "+1": true });
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(true);
  });

  test("returns true when comment has -1 reaction", async () => {
    const scm = createMockScm({ "-1": true });
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(true);
  });

  test("returns false when no agent reactions are present", async () => {
    const scm = createMockScm({});
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(false);
  });

  test("returns false when only non-agent reactions are present", async () => {
    const scm = createMockScm({ rocket: true, laugh: true });
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(false);
  });

  test("returns true when multiple agent reactions are present", async () => {
    const scm = createMockScm({ eyes: true, "+1": true });
    expect(await hasAgentReaction(scm, 1, "review", 42)).toBe(true);
  });

  test("passes commentType and prNumber through to SCM provider", async () => {
    let receivedType: string | undefined;
    let receivedPrNumber: number | undefined;
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async (_commentId, commentType, _reaction, prNumber) => {
        receivedType = commentType;
        receivedPrNumber = prNumber;
        return false;
      },
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    await hasAgentReaction(scm, 99, "review", 123);
    expect(receivedType).toBe("review");
    expect(receivedPrNumber).toBe(123);
  });

  test("returns false when SCM provider throws for all reactions", async () => {
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async () => {
        throw new Error("API error");
      },
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(false);
  });

  test("returns true when one reaction throws but another succeeds with true", async () => {
    let callCount = 0;
    const scm: ScmProvider = {
      findPullRequest: async () => null,
      getPRComments: async () => [],
      isPRMerged: async () => false,
      getPRMergeInfo: async () => null,
      hasCommentReaction: async (_commentId, _commentType, reaction) => {
        callCount++;
        if (reaction === "eyes") throw new Error("API error");
        return reaction === "+1";
      },
      addCommentReaction: async () => {},
      replyToComment: async () => {},
    };

    // eyes throws, +1 returns true
    expect(await hasAgentReaction(scm, 1, "issue", 42)).toBe(true);
    expect(callCount).toBe(3); // All three reactions are checked in parallel
  });
});
