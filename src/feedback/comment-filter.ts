/** @module src/feedback/comment-filter — Filters comments by a command prefix to discover actionable review feedback */

/**
 * A comment that matches the agent's command prefix and requires action.
 */
export interface FeedbackEvent {
  /** Where the comment was found: `"pr"` for pull request comments, `"ticket"` for ticket comments. */
  source: "pr" | "ticket";
  /** Unique identifier of the comment on its source platform. */
  commentId: string;
  /** Author username of the comment. */
  author: string;
  /** Full body text of the comment (including the command prefix). */
  body: string;
  /** ISO 8601 timestamp when the comment was created. */
  createdAt: string;
  /** Type of comment: `"issue"` or `"review"` for PR comments, `"ticket"` for ticket provider comments. */
  commentType: "issue" | "review" | "ticket";
}

/**
 * Filters a list of comments to only those that start with the given prefix
 * (e.g. `/agent`) and optionally excludes comments from a specific author.
 * Used to discover review feedback that the agent should address.
 *
 * @param comments - Array of comments with `body`, `id`, `author`, and `createdAt` fields.
 * @param prefix - The command prefix to match (e.g. `"/agent"`). Leading whitespace is trimmed before matching.
 * @param excludeAuthor - Optional author username to exclude (e.g. the agent's own comments).
 * @param commentType - The comment type to tag on returned events (default `"ticket"`).
 * @returns Array of matching comments as {@link FeedbackEvent} objects (without `source`).
 */
export function findActionableComments(
  comments: { body: string; id: string | number; author: string; createdAt: string }[],
  prefix: string,
  excludeAuthor?: string,
  commentType: "issue" | "review" | "ticket" = "ticket",
): Omit<FeedbackEvent, "source">[] {
  return comments
    .filter((c) => c.body.trim().startsWith(prefix))
    .filter((c) => !excludeAuthor || c.author !== excludeAuthor)
    .map((c) => ({
      commentId: String(c.id),
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
      commentType,
    }));
}
