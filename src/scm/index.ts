/**
 * @module src/scm/index — SCM provider factory.
 */

import type { ScmProvider } from "./types.ts";
import type { ScmConfig } from "../config.ts";
import { createGitHubProvider } from "./github.ts";
import { createBitbucketServerProvider } from "./bitbucket-server.ts";

/**
 * Creates an SCM provider based on the configured type.
 * @param config - SCM configuration including the `type` field ("github" | "bitbucket_server").
 * @returns A {@link ScmProvider} implementation for the specified type.
 * @throws Error if `config.type` does not match a known SCM provider.
 */
export function createScmProvider(config: ScmConfig): ScmProvider {
  switch (config.type) {
    case "github":
      return createGitHubProvider(config);
    case "bitbucket_server":
      return createBitbucketServerProvider(config);
  }
}
