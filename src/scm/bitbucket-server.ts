/**
 * @module src/scm/bitbucket-server — Bitbucket Server SCM provider (REST API v1)
 */
import type { ScmProvider, PullRequest, PRComment } from "./types.ts";
import type { BitbucketServerScmConfig } from "../config.ts";
import { log } from "../logger.ts";

/**
 * Creates a Bitbucket Server SCM provider using REST API v1.
 * Requires the BITBUCKET_TOKEN environment variable. Uses Bearer token auth.
 * @param config - Bitbucket Server SCM config containing base_url, project, and repo
 * @returns ScmProvider instance
 * @throws Error if BITBUCKET_TOKEN environment variable is not set
 */
export function createBitbucketServerProvider(config: BitbucketServerScmConfig): ScmProvider {
  const logger = log.child("bitbucket");
  const token = process.env.BITBUCKET_TOKEN;
  if (!token) {
    throw new Error("BITBUCKET_TOKEN environment variable is required for BitBucket Server SCM provider");
  }

  const baseUrl = config.base_url.replace(/\/+$/, "");
  const { project, repo } = config;

  /**
   * Wrapper for Bitbucket Server API requests.
   * Injects auth header. Logs request/response timing.
   * @param path - API path appended to /rest/api/1.0
   * @returns Fetch Response
   * @throws Error on non-OK status
   */
  async function bbFetch(path: string): Promise<Response> {
    const url = `${baseUrl}/rest/api/1.0${path}`;
    logger.debug("Bitbucket API request", { path });
    const start = Date.now();
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    logger.debug("Bitbucket API response", { path, status: res.status, durationMs: Date.now() - start });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`BitBucket Server API error ${res.status}: ${text}`);
    }
    return res;
  }

  /**
   * Maps GitHub reaction names to Bitbucket Server emoticon names.
   */
  function mapReactionToEmoticon(reaction: string): string {
    switch (reaction) {
      case "eyes":
        return "eyes";
      case "white_check_mark":
        return "thumbsup";
      case "thumbs_down":
        return "thumbsdown";
      default:
        return reaction;
    }
  }

  return {
    async findPullRequest(branch: string): Promise<PullRequest | null> {
      logger.debug("Finding pull request", { branch });
      const res = await bbFetch(
        `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests?at=refs/heads/${encodeURIComponent(branch)}&state=ALL&limit=5`
      );
      const data = (await res.json()) as Record<string, unknown>;
      const values = data.values as Record<string, unknown>[] | undefined;

      if (!Array.isArray(values) || values.length === 0) {
        logger.debug("No pull request found", { branch });
        return null;
      }

      // Prefer open PRs; fall back to most recent merged/closed
      const sorted = values.sort((a, b) => {
        const aOpen = a.state === "OPEN" ? 0 : 1;
        const bOpen = b.state === "OPEN" ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return new Date(b.createdDate as string).getTime() - new Date(a.createdDate as string).getTime();
      });
      const pr = sorted[0]!;
      const bbState = pr.state as string;
      const state: PullRequest["state"] = bbState === "MERGED" ? "merged" : bbState === "OPEN" ? "open" : "closed";
      logger.debug("Found pull request", { branch, prNumber: pr.id, state });
      return {
        number: pr.id as number,
        url: `${baseUrl}/projects/${project}/repos/${repo}/pull-requests/${pr.id}`,
        branch,
        state,
      };
    },

    async getPRComments(prNumber: number, since?: string): Promise<PRComment[]> {
      logger.debug("Fetching PR comments", { prNumber, since });
      const res = await bbFetch(
        `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${prNumber}/activities?limit=100`
      );
      const data = (await res.json()) as Record<string, unknown>;
      const activities = data.values as Record<string, unknown>[] | undefined;

      if (!Array.isArray(activities)) return [];

      const results = activities
        .filter((a) => a.action === "COMMENTED")
        .filter((a) => {
          if (!since) return true;
          const commentDate = new Date(a.createdDate as string);
          return commentDate > new Date(since);
        })
        .map((a) => {
          const comment = a.comment as Record<string, unknown>;
          const author = comment.author as Record<string, unknown>;
          return {
            id: comment.id as number,
            author: (author.displayName as string) ?? (author.name as string) ?? "unknown",
            body: comment.text as string,
            createdAt: a.createdDate as string,
            commentType: "review" as const,
          };
        });
      logger.debug("Fetched PR comments", { prNumber, count: results.length });
      return results;
    },

    async isPRMerged(prNumber: number): Promise<boolean> {
      logger.debug("Checking if PR is merged", { prNumber });
      try {
        const res = await bbFetch(
          `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${prNumber}`
        );
        const data = (await res.json()) as Record<string, unknown>;
        const merged = data.state === "MERGED";
        logger.debug("PR merge check", { prNumber, merged });
        return merged;
      } catch {
        logger.debug("PR merge check failed", { prNumber, merged: false });
        return false;
      }
    },

    async getPRMergeInfo(prNumber: number): Promise<{ url: string; sha: string; summary: string } | null> {
      logger.debug("Fetching PR merge info", { prNumber });
      try {
        const res = await bbFetch(
          `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${prNumber}`
        );
        const data = (await res.json()) as Record<string, unknown>;
        const mergeCommit = data.mergeCommit as Record<string, unknown> | null | undefined;

        if (!mergeCommit?.id) {
          logger.debug("No merge commit found on PR", { prNumber });
          return null;
        }

        const sha = mergeCommit.id as string;
        const selfLink = ((data.links as Record<string, unknown>)?.self as Record<string, unknown>[])?.[0]?.href as string;
        const url = selfLink ?? `${baseUrl}/projects/${project}/repos/${repo}/pull-requests/${prNumber}`;

        let summary = "";
        try {
          const commitRes = await bbFetch(
            `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/commits/${sha}`
          );
          const commitData = (await commitRes.json()) as Record<string, unknown>;
          const message = (commitData.message as string) ?? "";
          summary = message.split("\n")[0] ?? "";
        } catch {
          logger.debug("Failed to fetch merge commit message", { prNumber, sha });
        }

        logger.debug("PR merge info", { prNumber, sha, summary });
        return { url, sha, summary };
      } catch (err) {
        logger.debug("Failed to fetch PR merge info", {
          prNumber,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },

    async hasCommentReaction(commentId: number, _commentType: "issue" | "review", reaction: string, prNumber?: number): Promise<boolean> {
      logger.debug("Checking comment reaction", { commentId, reaction, prNumber });
      if (!prNumber) {
        logger.debug("Cannot check reaction without prNumber, returning false", { commentId });
        return false;
      }
      try {
        const res = await bbFetch(
          `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${prNumber}/comments/${commentId}`
        );
        const data = (await res.json()) as Record<string, unknown>;
        const emoticon = mapReactionToEmoticon(reaction);

        // Check if reactions are embedded in the comment properties
        const properties = data.properties as Record<string, unknown>[] | undefined;
        if (Array.isArray(properties)) {
          const hasReaction = properties.some((p) => p.key === "reactions" && String(p.value).includes(emoticon));
          if (hasReaction) {
            logger.debug("Comment reaction found", { commentId, emoticon });
            return true;
          }
        }

        logger.debug("Comment reaction not found", { commentId, emoticon });
        return false;
      } catch (err) {
        logger.debug("Failed to check comment reaction, returning false", {
          commentId,
          reaction,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },

    async addCommentReaction(commentId: number, _commentType: "issue" | "review", reaction: string, prNumber?: number): Promise<void> {
      logger.debug("Adding comment reaction", { commentId, reaction, prNumber });
      if (!prNumber) {
        logger.warn("Cannot add reaction without prNumber (best-effort)", { commentId, reaction });
        return;
      }
      try {
        const emoticon = mapReactionToEmoticon(reaction);
        const url = `${baseUrl}/rest/comment-likes/latest/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${prNumber}/comments/${commentId}/reactions/${encodeURIComponent(emoticon)}`;
        logger.debug("Bitbucket reaction API request", { url });
        const start = Date.now();
        const res = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        logger.debug("Bitbucket reaction API response", { status: res.status, durationMs: Date.now() - start });

        if (res.status === 409) {
          logger.debug("Reaction already exists", { commentId, emoticon });
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Bitbucket reaction API error ${res.status}: ${text}`);
        }
        logger.debug("Comment reaction added", { commentId, emoticon });
      } catch (err) {
        logger.warn("Failed to add comment reaction (best-effort)", {
          commentId,
          reaction,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async replyToComment(prNumber: number, commentId: number, _commentType: "issue" | "review", body: string): Promise<void> {
      logger.debug("Replying to comment", { prNumber, commentId });
      try {
        const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${prNumber}/comments`;
        const start = Date.now();
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: body,
            parent: {
              id: commentId,
            },
          }),
        });
        logger.debug("Bitbucket reply API response", { status: res.status, durationMs: Date.now() - start });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Bitbucket reply API error ${res.status}: ${text}`);
        }
        logger.debug("Comment reply posted", { prNumber, commentId });
      } catch (err) {
        logger.warn("Failed to reply to comment (best-effort)", {
          prNumber,
          commentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
