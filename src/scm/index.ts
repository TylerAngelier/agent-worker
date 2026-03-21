import type { ScmProvider } from "./types.ts";
import type { ScmConfig } from "../config.ts";
import { createGitHubProvider } from "./github.ts";
import { createBitbucketServerProvider } from "./bitbucket-server.ts";

export function createScmProvider(config: ScmConfig): ScmProvider {
  switch (config.type) {
    case "github":
      return createGitHubProvider(config);
    case "bitbucket_server":
      return createBitbucketServerProvider(config);
  }
}
