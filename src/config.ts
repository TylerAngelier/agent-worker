/** @module src/config — YAML config loader with Zod validation */
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";

// --- Provider schemas ---

const StatusesSchema = z.object({
  ready: z.string(),
  in_progress: z.string(),
  code_review: z.string(),
  verification: z.string(),
  failed: z.string(),
});

/** Maps ticket lifecycle stages to provider-specific status names. */
export type Statuses = z.infer<typeof StatusesSchema>;

const LinearProviderSchema = z.object({
  type: z.literal("linear"),
  project_id: z.string(),
  poll_interval_seconds: z.number().positive().default(60),
  statuses: StatusesSchema,
});

/** Linear provider config requiring a project ID and status mappings. */
export type LinearProviderConfig = z.infer<typeof LinearProviderSchema>;

const JiraProviderSchema = z.object({
  type: z.literal("jira"),
  base_url: z.string(),
  poll_interval_seconds: z.number().positive().default(60),
  jql: z.string(),
  statuses: StatusesSchema,
});

/** Jira provider config requiring a base URL, JQL query, and status mappings. */
export type JiraProviderConfig = z.infer<typeof JiraProviderSchema>;

const PlaneProviderSchema = z.object({
  type: z.literal("plane"),
  base_url: z.string(),
  workspace_slug: z.string(),
  project_id: z.string(),
  poll_interval_seconds: z.number().positive().default(60),
  query: z.string(),
  statuses: StatusesSchema,
});

/** Plane provider config requiring a workspace slug, project ID, query, and status mappings. */
export type PlaneProviderConfig = z.infer<typeof PlaneProviderSchema>;

const ProviderSchema = z.discriminatedUnion("type", [
  LinearProviderSchema,
  JiraProviderSchema,
  PlaneProviderSchema,
]);

/** Discriminated union of all supported ticket provider configurations. */
export type ProviderConfig = z.infer<typeof ProviderSchema>;

// --- Shared schemas ---

const RepoSchema = z.object({
  path: z.string(),
});

const HooksSchema = z.object({
  pre: z.array(z.string()).default([]),
  post: z.array(z.string()).default([]),
}).default({ pre: [], post: [] });

const ExecutorSchema = z.object({
  type: z.enum(["claude", "codex", "opencode", "pi"]).default("claude"),
  timeout_seconds: z.number().positive().default(300),
  retries: z.number().int().min(0).max(3).default(0),
}).default({ type: "claude", timeout_seconds: 300, retries: 0 });

const LogSchema = z.object({
  file: z.string().optional(),
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  redact: z.array(z.string()).default([]),
}).default({ level: "info", redact: [] });

// --- SCM schemas ---

const GitHubScmSchema = z.object({
  type: z.literal("github"),
  owner: z.string(),
  repo: z.string(),
});

/** GitHub SCM config requiring an owner and repo name. */
export type GitHubScmConfig = z.infer<typeof GitHubScmSchema>;

const BitbucketServerScmSchema = z.object({
  type: z.literal("bitbucket_server"),
  base_url: z.string(),
  project: z.string(),
  repo: z.string(),
});

/** Bitbucket Server SCM config requiring a base URL, project key, and repo name. */
export type BitbucketServerScmConfig = z.infer<typeof BitbucketServerScmSchema>;

const ScmSchema = z.discriminatedUnion("type", [
  GitHubScmSchema,
  BitbucketServerScmSchema,
]);

/** Discriminated union of all supported SCM provider configurations. */
export type ScmConfig = z.infer<typeof ScmSchema>;

// --- Feedback schema ---

const FeedbackSchema = z.object({
  comment_prefix: z.string().default("/agent"),
  poll_interval_seconds: z.number().positive().default(120),
}).default({ comment_prefix: "/agent", poll_interval_seconds: 120 });

/** Config for the feedback polling system, including comment prefix and poll interval. */
export type FeedbackConfig = z.infer<typeof FeedbackSchema>;

const ConfigFileSchema = z.object({
  provider: ProviderSchema,
  repo: RepoSchema,
  hooks: HooksSchema,
  executor: ExecutorSchema,
  log: LogSchema,
  scm: ScmSchema,
  feedback: FeedbackSchema,
});

type ConfigFile = z.infer<typeof ConfigFileSchema>;

/** Top-level application configuration combining all sub-configs. */
export type Config = ConfigFile;

/**
 * Reads a YAML config file and validates it against the full schema.
 * @param filePath - path to the YAML file
 * @returns validated Config object
 * @throws {z.ZodError} if validation fails
 * @throws {Error} if file cannot be read
 */
export function loadConfig(filePath: string): Config {
  const text = readFileSync(filePath, "utf-8");
  const raw = parseYaml(text) as Record<string, unknown>;
  return ConfigFileSchema.parse(raw);
}
