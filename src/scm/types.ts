/**
 * @module src/scm/types — Domain types and SPI contract for source control management.
 */

/** A pull/merge request from a source control platform. */
export interface PullRequest {
  /** PR number (e.g. 42). */
  number: number;
  /** URL to the PR in the SCM web UI. */
  url: string;
  /** Head branch name the PR is created from. */
  branch: string;
  /** Current state of the PR. */
  state: "open" | "closed" | "merged";
}

/** A comment posted on a pull request. */
export interface PRComment {
  /** Internal comment ID. */
  id: number;
  /** Author username or display name. */
  author: string;
  /** Comment body text (may include markdown). */
  body: string;
  /** ISO 8601 timestamp of when the comment was created. */
  createdAt: string;
  /** Whether this comment is an issue-level comment or a review (inline code) comment. */
  commentType: "issue" | "review";
}

/** Metadata about a PR's merge commit. */
export interface MergeInfo {
  /** URL to the merge commit. */
  url: string;
  /** SHA of the merge commit. */
  sha: string;
  /** First line of the merge commit message. */
  summary: string;
}

/**
 * SPI contract for source control management providers.
 *
 * Implementations must not import from `pipeline/`, `feedback/`, `scheduler.ts`, `poller.ts`, or `index.ts`.
 */
export interface ScmProvider {
  /**
   * Finds a pull request by its head branch name.
   * @param branch - The head branch name to search for.
   * @returns The matching PR, or `null` if none exists.
   */
  findPullRequest(branch: string): Promise<PullRequest | null>;

  /**
   * Fetches comments on a pull request, optionally filtered to those created after `since`.
   * @param prNumber - The PR number.
   * @param since - ISO 8601 timestamp. When provided, only comments created after this time are returned.
   */
  getPRComments(prNumber: number, since?: string): Promise<PRComment[]>;

  /**
   * Checks whether a pull request has been merged.
   * @param prNumber - The PR number.
   */
  isPRMerged(prNumber: number): Promise<boolean>;

  /**
   * Retrieves merge metadata for a pull request.
   * @param prNumber - The PR number.
   * @returns Merge info if the PR was merged, or `null` otherwise.
   */
  getPRMergeInfo(prNumber: number): Promise<MergeInfo | null>;

  /**
   * Checks whether a specific reaction has been added to a comment.
   * @param commentId - The comment ID.
   * @param commentType - Whether the comment is an issue-level or review-level comment.
   * @param reaction - The reaction content string (e.g. "eyes", "thumbs_up").
   * @param prNumber - Optional PR number. Required by some SCM providers (e.g. Bitbucket Server).
   */
  hasCommentReaction(commentId: number, commentType: "issue" | "review", reaction: string, prNumber?: number): Promise<boolean>;

  /**
   * Adds a reaction to a comment (best-effort).
   * @param commentId - The comment ID.
   * @param commentType - Whether the comment is an issue-level or review-level comment.
   * @param reaction - The reaction content string (e.g. "eyes", "thumbs_up").
   * @param prNumber - Optional PR number. Required by some SCM providers (e.g. Bitbucket Server).
   */
  addCommentReaction(commentId: number, commentType: "issue" | "review", reaction: string, prNumber?: number): Promise<void>;

  /**
   * Replies to a comment on a pull request.
   * @param prNumber - The PR number.
   * @param commentId - The comment ID to reply to.
   * @param commentType - Whether the comment is an issue-level or review-level comment.
   * @param body - The reply body text.
   */
  replyToComment(prNumber: number, commentId: number, commentType: "issue" | "review", body: string): Promise<void>;
}
