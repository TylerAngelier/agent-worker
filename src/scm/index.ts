import type { ScmProvider } from "./types.ts";
import type { ScmConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { createGitHubProvider } from "./github.ts";
import { createBitbucketServerProvider } from "./bitbucket-server.ts";

export function createScmProvider(config: ScmConfig, logger?: Logger): ScmProvider {
  switch (config.type) {
    case "github":
      return createGitHubProvider(config, logger);
    case "bitbucket_server":
      return createBitbucketServerProvider(config, logger);
  }
}
