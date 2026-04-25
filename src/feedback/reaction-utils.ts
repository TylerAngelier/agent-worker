/** @module src/feedback/reaction-utils — Reaction-based dedup utilities for feedback processing */

import type { ScmProvider } from "../scm/types.ts";

/** Reactions placed by the agent to mark comments as seen or processed. */
export const AGENT_REACTIONS = ["eyes", "+1", "-1"] as const;

/**
 * Checks whether a comment has any agent-placed reaction (eyes, +1, or -1).
 * Used for deduplication so that already-processed comments are not dispatched
 * again after a server restart.
 *
 * @param scm - SCM provider to query for reactions.
 * @param commentId - The comment ID to check.
 * @param commentType - Whether the comment is an issue-level or review-level comment.
 * @param prNumber - Optional PR number required by some SCM providers.
 * @returns `true` if any agent reaction is present, `false` otherwise.
 */
export async function hasAgentReaction(
  scm: ScmProvider,
  commentId: number,
  commentType: "issue" | "review",
  prNumber?: number,
): Promise<boolean> {
  const results = await Promise.all(
    AGENT_REACTIONS.map((reaction) =>
      scm.hasCommentReaction(commentId, commentType, reaction, prNumber).catch(() => false)
    ),
  );
  return results.some(Boolean);
}
