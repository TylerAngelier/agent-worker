/**
 * @module src/scm/github — GitHub SCM provider (REST API v3)
 */
import type { ScmProvider, PullRequest, PRComment } from "./types.ts";
import type { GitHubScmConfig } from "../config.ts";
import { log } from "../logger.ts";
import { createHttpClient, type HttpClient } from "../internal/http.ts";

const GITHUB_API = "https://api.github.com";

/**
 * Creates a GitHub SCM provider using the REST API v3.
 * Requires the GITHUB_TOKEN environment variable. Uses Bearer token auth.
 * @param config - GitHub SCM config containing owner and repo
 * @returns ScmProvider instance
 * @throws Error if GITHUB_TOKEN environment variable is not set
 */
export function createGitHubProvider(config: GitHubScmConfig): ScmProvider {
  const logger = log.child("github");
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required for GitHub SCM provider");
  }

  const { owner, repo } = config;

  const http: HttpClient = createHttpClient({
    baseUrl: `${GITHUB_API}/repos/${owner}/${repo}`,
    defaultHeaders: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "agent-worker",
    },
    componentName: "github",
    backoff: {},
  });

  return {
    async findPullRequest(branch: string): Promise<PullRequest | null> {
      logger.debug("Finding pull request", { branch });
      const { data: prs } = await http.request<unknown[]>({
        path: `/pulls?head=${owner}:${encodeURIComponent(branch)}&state=all&per_page=5`,
      });

      if (!Array.isArray(prs) || prs.length === 0) {
        logger.debug("No pull request found", { branch });
        return null;
      }

      // Prefer open PRs; fall back to most recent merged/closed
      const sorted = (prs as Record<string, unknown>[]).sort((a, b) => {
        const aOpen = a.state === "open" ? 0 : 1;
        const bOpen = b.state === "open" ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime();
      });
      const pr = sorted[0]!;
      const ghState = pr.state as string;
      const merged = pr.merged_at !== null && pr.merged_at !== undefined;
      const state: PullRequest["state"] = merged ? "merged" : ghState === "open" ? "open" : "closed";
      logger.debug("Found pull request", { branch, prNumber: pr.number, state });
      return {
        number: pr.number as number,
        url: pr.html_url as string,
        branch: branch,
        state,
      };
    },

    async getPRComments(prNumber: number, since?: string): Promise<PRComment[]> {
      logger.debug("Fetching PR comments", { prNumber, since });
      const params = new URLSearchParams();
      params.set("per_page", "100");
      if (since) params.set("since", since);

      // Fetch both review comments (inline code comments) and issue comments
      // (general PR conversation) since /agent feedback can be posted as either.
      const [reviewResult, issueResult] = await Promise.all([
        http.request<unknown[]>({ path: `/pulls/${prNumber}/comments?${params}` }),
        http.request<unknown[]>({ path: `/issues/${prNumber}/comments?${params}` }),
      ]);

      const reviewComments = reviewResult.data;
      const issueComments = issueResult.data;

      const mapComment = (c: unknown, commentType: "issue" | "review"): PRComment => {
        const comment = c as Record<string, unknown>;
        const user = comment.user as Record<string, unknown> | undefined;
        return {
          id: comment.id as number,
          author: user?.login as string ?? "unknown",
          body: comment.body as string,
          createdAt: comment.created_at as string,
          commentType,
        };
      };

      const reviewResults = (Array.isArray(reviewComments) ? reviewComments : []).map((c) => mapComment(c, "review"));
      const issueResults = (Array.isArray(issueComments) ? issueComments : []).map((c) => mapComment(c, "issue"));

      // Deduplicate by ID (safety net for overlapping fetches)
      const seen = new Set<number>();
      const deduped: PRComment[] = [];
      for (const c of [...issueResults, ...reviewResults]) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          deduped.push(c);
        }
      }

      logger.debug("Fetched PR comments", {
        prNumber,
        count: deduped.length,
        reviewCount: reviewResults.length,
        issueCount: issueResults.length,
      });
      return deduped;
    },

    async isPRMerged(prNumber: number): Promise<boolean> {
      logger.debug("Checking if PR is merged", { prNumber });
      try {
        const { status } = await http.request({ path: `/pulls/${prNumber}/merge`, allowedStatuses: [204] });
        const merged = status === 204;
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
        const { data: pr } = await http.request<Record<string, unknown>>({ path: `/pulls/${prNumber}` });
        const mergeCommitSha = pr.merge_commit_sha as string | null;
        const htmlUrl = pr.html_url as string;

        if (!mergeCommitSha) {
          logger.debug("No merge commit SHA found on PR", { prNumber });
          return null;
        }

        let summary = "";
        try {
          const { data: commit } = await http.request<Record<string, unknown>>({ path: `/commits/${mergeCommitSha}` });
          const message = ((commit.commit as Record<string, unknown>)?.message as string) ?? "";
          summary = message.split("\n")[0] ?? "";
        } catch {
          logger.debug("Failed to fetch merge commit message", { prNumber, sha: mergeCommitSha });
        }

        logger.debug("PR merge info", { prNumber, sha: mergeCommitSha, summary });
        return { url: htmlUrl, sha: mergeCommitSha, summary };
      } catch (err) {
        logger.debug("Failed to fetch PR merge info", {
          prNumber,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },

    async hasCommentReaction(commentId: number, commentType: "issue" | "review", reaction: string, _prNumber?: number): Promise<boolean> {
      logger.debug("Checking comment reaction", { commentId, commentType, reaction });
      try {
        const basePath = commentType === "issue"
          ? `/issues/comments/${commentId}/reactions?per_page=100`
          : `/pulls/comments/${commentId}/reactions?per_page=100`;
        const { data: reactions } = await http.request<Record<string, unknown>[]>({ path: basePath });
        const hasReaction = Array.isArray(reactions) && reactions.some((r) => r.content === reaction);
        logger.debug("Comment reaction check", { commentId, commentType, reaction, hasReaction });
        return hasReaction;
      } catch (err) {
        logger.debug("Failed to check comment reaction", {
          commentId,
          commentType,
          reaction,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },

    async addCommentReaction(commentId: number, commentType: "issue" | "review", reaction: string, _prNumber?: number): Promise<void> {
      logger.debug("Adding comment reaction", { commentId, commentType, reaction });
      try {
        const basePath = commentType === "issue"
          ? `/issues/comments/${commentId}/reactions`
          : `/pulls/comments/${commentId}/reactions`;
        await http.request({
          method: "POST",
          path: basePath,
          body: { content: reaction },
          allowedStatuses: [201],
        });
        logger.debug("Comment reaction added", { commentId, commentType, reaction });
      } catch (err) {
        logger.warn("Failed to add comment reaction (best-effort)", {
          commentId,
          commentType,
          reaction,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async replyToComment(prNumber: number, commentId: number, commentType: "issue" | "review", body: string): Promise<void> {
      logger.debug("Replying to comment", { prNumber, commentId, commentType });
      try {
        if (commentType === "issue") {
          // Issue comments: post a standalone comment on the issue/PR
          await http.request({
            method: "POST",
            path: `/issues/${prNumber}/comments`,
            body: { body },
            allowedStatuses: [201],
          });
        } else {
          // Review comments: post a threaded reply to the review comment
          await http.request({
            method: "POST",
            path: `/pulls/${prNumber}/comments/${commentId}/replies`,
            body: { body },
            allowedStatuses: [201],
          });
        }
        logger.debug("Comment reply posted", { prNumber, commentId, commentType });
      } catch (err) {
        logger.warn("Failed to reply to comment (best-effort)", {
          prNumber,
          commentId,
          commentType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
