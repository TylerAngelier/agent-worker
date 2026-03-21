# Agent Worker

TypeScript CLI built with Bun. Polls ticket providers (Linear, Jira, Plane) and dispatches them to a coding agent (Claude, Codex, OpenCode, Pi). After a task completes, monitors PRs for review feedback and re-runs the agent to address it.

## Stack

- Runtime: Bun
- Language: TypeScript
- Testing: `bun test`
- Dependencies: @linear/sdk, zod, yaml

## Workflow

When solving a ticket:

1. Write the code to solve the ticket
2. Run `bun test` and fix any failures
3. Review your changes for bugs, security issues, and code quality — use CodeRabbit if available
4. Fix any issues found in the review
5. Run `bun test` again to confirm fixes didn't break anything

## Ticket Lifecycle

1. **Ready** — ticket appears in the provider's ready queue
2. **In Progress** — claimed by the scheduler, executor runs the pipeline
3. **Code Review** — executor succeeded, PR created (by post-hooks), ticket awaits review
4. **Verification** — PR merged, ticket transitions automatically
5. **Failed** — executor or pipeline failed after all retries

During Code Review, the feedback poller monitors the PR for comments prefixed with `/agent` (configurable). When actionable feedback is found, the executor re-runs on the existing branch to address it. On success/failure, a comment is posted back to the ticket.

## Module Boundaries

Dependencies flow downward only. Upper layers may import from lower layers; lower layers must never import from upper layers.

### Domain (`src/providers/types.ts`)

Shared types used across the entire codebase.

- `Ticket` — the core data model (id, identifier, title, description)
- `TicketComment` — a comment on a ticket (id, author, body, createdAt)

### Provider SPI (`src/providers/`)

Contract and implementations for fetching tickets from issue trackers.

- `TicketProvider` interface (`types.ts`) — `fetchReadyTickets`, `fetchTicketsByStatus`, `transitionStatus`, `postComment`, `fetchComments`
- `createProvider()` factory (`index.ts`) — selects implementation by config type
- Implementations: `linear.ts`, `jira.ts`, `plane.ts`
- All providers implement exponential backoff with jitter for HTTP 429 / rate-limit errors (shared `withBackoff()` pattern)
- **Rule:** Provider implementations must not import from `pipeline/`, `scm/`, `feedback/`, or application services.

### Executor SPI (`src/pipeline/`)

Contract and implementations for dispatching work to coding agents.

- `CodeExecutor` interface (`executor.ts`) — `name`, `needsWorktree`, `run`
- `ExecutorResult` type (`executor.ts`) — success, output, timedOut, exitCode
- `createExecutor()` factory (`executor.ts`) — selects implementation by config type
- `streamToLines()` utility (`executor.ts`) — shared streaming helper for all executors
- Implementations: `claude-executor.ts`, `codex-executor.ts`, `opencode-executor.ts`, `pi-executor.ts`
- Pipeline orchestration (`pipeline.ts`) — worktree lifecycle (`createWorktree`, `removeWorktree`), pre/post hooks, executor invocation. `createWorktree` accepts `options?: { createBranch?: boolean }` to checkout an existing branch instead of creating a new one.
- Hook execution (`hook-runner.ts`) — runs shell commands sequentially
- Template interpolation (`interpolate.ts`) — replaces template variables in hook commands: `{id}`, `{title}`, `{raw_title}`, `{branch}`, `{worktree}`, `{date}`
- **Rule:** Executor implementations must not import from `scheduler.ts`, `poller.ts`, `feedback/`, or `index.ts`.

### SCM SPI (`src/scm/`)

Contract and implementations for interacting with source control platforms to manage pull requests.

- `ScmProvider` interface (`types.ts`) — `findPullRequest(branch)`, `getPRComments(prNumber, since?)`, `isPRMerged(prNumber)`
- `PullRequest` type (`types.ts`) — number, url, branch, state
- `PRComment` type (`types.ts`) — id, author, body, createdAt
- `createScmProvider()` factory (`index.ts`) — selects implementation by `config.scm.type`
- Implementations: `github.ts` (REST API, `GITHUB_TOKEN` env var), `bitbucket-server.ts` (REST API, `BITBUCKET_TOKEN` env var)
- **Rule:** SCM implementations must not import from `pipeline/`, `feedback/`, `scheduler.ts`, `poller.ts`, or `index.ts`.

### Application Services (`src/`)

Orchestration logic that coordinates providers, executors, and SCM.

- `scheduler.ts` — claims a ticket, runs the pipeline with retries, updates ticket status, posts structured comments to the ticket (success → "In Code Review" with last 50 lines of output; failure → structured error). Returns `ProcessTicketResult` discriminated union (`{ outcome: "code_review", ticketId, branch }` | `{ outcome: "failed" }`).
- `poller.ts` — polling loop with interruptible sleep and signal handling. Processes one ticket per cycle.
- `feedback/tracking.ts` — `PRTracker` interface and `createPRTracker()` — in-memory map of ticketId → PR metadata (prNumber, branch, lastCommentCheck).
- `feedback/comment-filter.ts` — `FeedbackEvent` type and `findActionableComments()` — filters comments by a configurable prefix and excludes self-authored comments.
- `feedback/feedback-handler.ts` — `processFeedback()` — checks out the existing PR branch via worktree, runs the executor with a feedback prompt, runs post-hooks, and posts results back to the ticket.
- `feedback/feedback-poller.ts` — `createFeedbackPoller()` — long-running poll loop that discovers PRs for tickets in code_review status, checks for PR merges (transitions ticket to verification), fetches actionable comments from both PR and ticket, and dispatches them to `processFeedback()`.
- **Rule:** Feedback modules may import from `pipeline/` (worktree lifecycle, hooks, interpolation, executor factory), `providers/` (ticket types), and `scm/` (PR types). They must not import from `scheduler.ts`, `poller.ts`, or `index.ts`.

### Infrastructure (`src/`)

Cross-cutting concerns with no domain logic.

- `config.ts` — YAML config loading and Zod validation. Config sections: `provider`, `repo`, `hooks`, `executor`, `log`, `scm`, `feedback`. Status schema includes: `ready`, `in_progress`, `code_review`, `verification`, `failed`.
- `logger.ts` — structured logging (TTY-aware, optional file output)
- `format.ts` — terminal colors and splash banner

### Entry Point (`src/index.ts`)

Wires all components together. Parses CLI args (`--config <path>`, `--version`), loads config, creates provider/poller/logger/SCM provider/PR tracker/feedback poller, handles `SIGINT` and `SIGTERM`, starts both the main poller and feedback poller concurrently. Seeds the PR tracker when a ticket reaches code_review. This is the only file that should know about every other module.

## Config Reference

Key config sections validated by Zod in `src/config.ts`:

| Section | Required | Description |
|---|---|---|
| `provider` | Yes | Ticket provider config (type, credentials, poll interval, statuses) |
| `repo` | Yes | Local repo path (`path`) |
| `hooks` | No | Pre/post shell commands (`pre[]`, `post[]`) |
| `executor` | No | Executor type, timeout, retries. Defaults: claude, 300s, 0 retries |
| `log` | No | Log level and optional file path |
| `scm` | Yes | SCM provider config (`type: "github" \| "bitbucket_server"` + provider-specific fields) |
| `feedback` | No | Feedback processing config. `comment_prefix` (default `"/agent"`), `poll_interval_seconds` (default `120`) |

## Conventions

- No classes — use plain functions and interfaces
- Validate config with zod schemas (`src/config.ts`)
- Executors implement the `CodeExecutor` interface (`src/pipeline/executor.ts`)
- Providers implement the `TicketProvider` interface (`src/providers/types.ts`)
- SCM providers implement the `ScmProvider` interface (`src/scm/types.ts`)
- Hooks are shell commands run via `src/pipeline/hook-runner.ts`
- Tests live in `test/` mirroring `src/` structure
