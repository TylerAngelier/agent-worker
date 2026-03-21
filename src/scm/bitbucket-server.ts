import type { ScmProvider, PullRequest, PRComment } from "./types.ts";
import type { BitbucketServerScmConfig } from "../config.ts";

export function createBitbucketServerProvider(config: BitbucketServerScmConfig): ScmProvider {
  const token = process.env.BITBUCKET_TOKEN;
  if (!token) {
    throw new Error("BITBUCKET_TOKEN environment variable is required for BitBucket Server SCM provider");
  }

  const baseUrl = config.base_url.replace(/\/+$/, "");
  const { project, repo } = config;

  async function bbFetch(path: string): Promise<Response> {
    const url = `${baseUrl}/rest/api/1.0${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`BitBucket Server API error ${res.status}: ${text}`);
    }
    return res;
  }

  return {
    async findPullRequest(branch: string): Promise<PullRequest | null> {
      const res = await bbFetch(
        `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests?at=refs/heads/${encodeURIComponent(branch)}&state=OPEN&limit=1`
      );
      const data = (await res.json()) as Record<string, unknown>;
      const values = data.values as Record<string, unknown>[] | undefined;

      if (!Array.isArray(values) || values.length === 0) return null;

      const pr = values[0]!;
      return {
        number: pr.id as number,
        url: `${baseUrl}/projects/${project}/repos/${repo}/pull-requests/${pr.id}`,
        branch,
        state: "open",
      };
    },

    async getPRComments(prNumber: number, since?: string): Promise<PRComment[]> {
      const res = await bbFetch(
        `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${prNumber}/activities?limit=100`
      );
      const data = (await res.json()) as Record<string, unknown>;
      const activities = data.values as Record<string, unknown>[] | undefined;

      if (!Array.isArray(activities)) return [];

      return activities
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
          };
        });
    },

    async isPRMerged(prNumber: number): Promise<boolean> {
      try {
        const res = await bbFetch(
          `/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${prNumber}`
        );
        const data = (await res.json()) as Record<string, unknown>;
        return data.state === "MERGED";
      } catch {
        return false;
      }
    },
  };
}
