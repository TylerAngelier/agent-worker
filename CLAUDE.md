# Agent Worker

TypeScript CLI built with Bun. Polls ticket providers (Linear, Jira, Plane) and dispatches them to a coding agent (Claude, Codex, OpenCode, Pi).

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

## Module Boundaries

Dependencies flow downward only. Upper layers may import from lower layers; lower layers must never import from upper layers.

### Domain (`src/providers/types.ts`)

Shared types used across the entire codebase.

- `Ticket` — the core data model (id, identifier, title, description)

### Provider SPI (`src/providers/`)

Contract and implementations for fetching tickets from issue trackers.

- `TicketProvider` interface (`types.ts`) — `fetchReadyTickets`, `transitionStatus`, `postComment`
- `createProvider()` factory (`index.ts`) — selects implementation by config type
- Implementations: `linear.ts`, `jira.ts`, `plane.ts`
- **Rule:** Provider implementations must not import from `pipeline/` or application services.

### Executor SPI (`src/pipeline/`)

Contract and implementations for dispatching work to coding agents.

- `CodeExecutor` interface (`executor.ts`) — `name`, `needsWorktree`, `run`
- `ExecutorResult` type (`executor.ts`) — success, output, timedOut, exitCode
- `createExecutor()` factory (`executor.ts`) — selects implementation by config type
- `streamToLines()` utility (`executor.ts`) — shared streaming helper for all executors
- Implementations: `claude-executor.ts`, `codex-executor.ts`, `opencode-executor.ts`, `pi-executor.ts`
- Pipeline orchestration (`pipeline.ts`) — worktree lifecycle, pre/post hooks, executor invocation
- Hook execution (`hook-runner.ts`) — runs shell commands sequentially
- Template interpolation (`interpolate.ts`) — replaces `{id}`, `{title}`, `{branch}` etc. in hook commands
- **Rule:** Executor implementations must not import from `scheduler.ts`, `poller.ts`, or `index.ts`.

### Application Services (`src/`)

Orchestration logic that coordinates providers and executors.

- `scheduler.ts` — claims a ticket, runs the pipeline with retries, updates ticket status
- `poller.ts` — polling loop with interruptible sleep and signal handling

### Infrastructure (`src/`)

Cross-cutting concerns with no domain logic.

- `config.ts` — YAML config loading and Zod validation
- `logger.ts` — structured logging (TTY-aware, optional file output)
- `format.ts` — terminal colors and splash banner

### Entry Point (`src/index.ts`)

Wires all components together. Parses CLI args, loads config, creates provider/poller/logger, handles signals, starts the poll loop. This is the only file that should know about every other module.

## Conventions

- No classes — use plain functions and interfaces
- Validate config with zod schemas (`src/config.ts`)
- Executors implement the `CodeExecutor` interface (`src/pipeline/executor.ts`)
- Providers implement the `TicketProvider` interface (`src/providers/types.ts`)
- Hooks are shell commands run via `src/pipeline/hook-runner.ts`
- Tests live in `test/` mirroring `src/` structure
