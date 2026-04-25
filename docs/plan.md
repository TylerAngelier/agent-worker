# Implementation Plan: Deepen Modules, Fix Bugs, Add Features

Branch: `plan/deepen-modules-and-fixes`
Date: 2026-04-24

## Status: ✅ Complete (all phases implemented, 282 tests passing)

| Phase | Status |
|-------|--------|
| Phase 0 — Bug Fixes 1, 2, 3 | ✅ Complete |
| Phase 1 — Worktree Module | ✅ Complete |
| Phase 2 — Configurable Base Branch / Branch Template | ✅ Complete |
| Phase 3 — Shared HTTP/Backoff Module | ✅ Complete |
| Phase 4 — Persistent PR Tracking | ✅ Complete |
| Phase 5 — Feedback Concurrency Controls | ✅ Complete |
| Phase 6 — Feedback State Machine | ✅ Complete |

---

## Phase 0 — Bug Fixes (No new modules, minimal risk)

Three independent fixes, each self-contained and mergeable individually.

### Bug Fix 1: Stop shell-invoking git worktree commands

**Problem:** `createWorktree` and `removeWorktree` in `src/pipeline/pipeline.ts` use `Bun.spawn(["sh", "-c", cmd])` with interpolated branch/worktree paths. Command-injection-prone and breaks on spaces.

**Files:** `src/pipeline/pipeline.ts`

**Changes:**
- `createWorktree()` — Replace string templates with argv form:
  ```ts
  Bun.spawn(
    createBranch
      ? ["git", "worktree", "add", "-b", branch, worktreePath, "main"]
      : ["git", "worktree", "add", worktreePath, branch],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" }
  )
  ```
- `removeWorktree()` — Same argv treatment for both `git worktree remove --force` and `git branch -D`.

**Tests:** Update `test/pipeline.test.ts` to verify argv arrays.

---

### Bug Fix 2: Do not delete existing PR branches after feedback work

**Problem:** `feedback-handler.ts` calls `createWorktree(..., { createBranch: false })` for existing PR branches, but `removeWorktree()` always runs `git branch -D`.

**Files:** `src/pipeline/pipeline.ts`, `src/feedback/feedback-handler.ts`

**Changes:**
- `removeWorktree` gains `options?: { deleteBranch?: boolean }` (defaults `true`).
- Only runs `git branch -D` when `deleteBranch !== false`.
- `feedback-handler.ts` finally block passes `{ deleteBranch: false }`.

**Tests:** Add coverage in `test/feedback/feedback-handler.test.ts` and `test/pipeline.test.ts`.

---

### Bug Fix 3: Fix container permissions flag wiring

**Problem:** `ContainerExecutorConfig` has `permissions_flag` but `createExecutor()` never passes it. Docker executor checks `dangerously_skip_permissions` instead.

**Files:** `src/pipeline/executor.ts`, `src/pipeline/docker-executor.ts`

**Changes:**
- `createExecutor()` container case passes `permissions_flag` from config.
- `DockerExecutorConfig` replaces `dangerously_skip_permissions?: boolean` with `permissions_flag?: string`.
- Command construction uses `config.permissions_flag` instead of hardcoded flag.

**Tests:** Update `test/docker-executor.test.ts`.

---

## Phase 1 — Deepen the Worktree Module

**Goal:** Extract worktree lifecycle into `src/pipeline/worktree.ts` with argv-based git, explicit options, and branch-ownership tracking.

**New file:** `src/pipeline/worktree.ts`

```ts
export interface WorktreeCreateOptions {
  createBranch?: boolean;       // default true
  baseBranch?: string;          // default "main"
}

export interface WorktreeRemoveOptions {
  deleteBranch?: boolean;       // default true
}

export interface WorktreeHandle {
  path: string;                 // absolute worktree path
  branch: string;
  createdBranch: boolean;       // true when this handle created the branch
}

export function createWorktree(
  repoPath: string, branch: string, options?: WorktreeCreateOptions
): Promise<WorktreeHandle>;

export function removeWorktree(
  repoPath: string, handle: WorktreeHandle, options?: WorktreeRemoveOptions
): Promise<void>;
```

**Design decisions:**
- `WorktreeHandle.createdBranch` replaces the separate `createBranch` boolean tracked by callers.
- `removeWorktree` defaults `deleteBranch` to `handle.createdBranch` (override via explicit option).
- All git commands use argv arrays.
- `baseBranch` is parameterized (feeds into Phase 2 config).

**Modified files:**
- `src/pipeline/pipeline.ts` — Delete old functions, import from `./worktree.ts`. `executePipeline` uses `WorktreeHandle`.
- `src/feedback/feedback-handler.ts` — Import from `../pipeline/worktree.ts`. Pass handle to `removeWorktree` (auto-skips branch deletion since `createdBranch = false`).

**Tests:** New `test/pipeline/worktree.test.ts`. Move existing worktree tests from `test/pipeline.test.ts`.

---

## Phase 2 — Configurable Base Branch and Branch Template

**Goal:** Config-driven base branch and branch naming templates instead of hardcoded values.

**Files:** `src/config.ts`, `src/pipeline/interpolate.ts`, `src/pipeline/pipeline.ts`, `src/feedback/feedback-handler.ts`, `src/feedback/feedback-poller.ts`, `src/scheduler.ts`

**Config changes:**
```ts
const RepoSchema = z.object({
  path: z.string(),
  base_branch: z.string().default("main"),
  branch_template: z.string().default("agent/task-{id}"),
});
```

**Code changes:**
- `buildTaskVars(ticket, worktree, branchTemplate)` — accepts optional template, defaults to `"agent/task-{id}"`.
- `createWorktree` receives `baseBranch` from `config.repo.base_branch`.
- `feedback-poller.ts` line ~131 replaces hardcoded branch string with template.
- `scheduler.ts` passes template to `buildTaskVars`.

**Tests:** Update `test/interpolate.test.ts`, `test/config.test.ts`.

---

## Phase 3 — Deepen Shared HTTP/Backoff Behavior

**Goal:** Extract duplicated `withBackoff`, auth, logging, and error handling into a shared HTTP module.

**New file:** `src/internal/http.ts`

```ts
export interface HttpClientOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  componentName: string;
  backoff?: {
    initialDelayMs?: number;   // default 1000
    maxDelayMs?: number;       // default 60000
    jitterMs?: number;         // default 500
    maxRetries?: number;       // default 5
  };
}

export interface HttpRequestOptions {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  allowedStatuses?: number[];  // e.g. [204, 201]
}

export interface HttpClient {
  request<T = unknown>(options: HttpRequestOptions): Promise<{ status: number; data: T }>;
}

export function createHttpClient(options: HttpClientOptions): HttpClient;
```

**Behavior:**
- Wraps `fetch()` with exponential backoff + jitter on 429/rate-limit.
- Injects default headers, logs request/response with timing.
- Parses JSON, throws structured errors.
- Exports `withBackoff` for edge cases (e.g. Linear SDK calls).

**Modified files (migrate one at a time):**
- `src/providers/linear.ts` — Remove local `withBackoff`, import from `internal/http.ts`.
- `src/providers/jira.ts` — Remove `withBackoff` and `jiraFetch`, use `createHttpClient`.
- `src/providers/plane.ts` — Same pattern.
- `src/providers/github.ts` — Remove local `withBackoff`, use `createHttpClient` for REST. GraphQL requests use http client with POST.
- `src/scm/github.ts` — Remove `ghFetch`/`ghPost`, use `createHttpClient`.
- `src/scm/bitbucket-server.ts` — Remove `bbFetch`, use `createHttpClient`.

**Tests:** New `test/internal/http.test.ts`. Update all provider/SCM test files.

---

## Phase 4 — Persistent PR Tracking

**Goal:** File-backed PR tracker so restarts don't lose state.

**Files:** `src/feedback/tracking.ts`, `src/index.ts`

**Changes to `tracking.ts`:**
```ts
export function createPRTracker(options?: { filePath?: string }): PRTracker;
```

- When `filePath` provided: JSON file-backed `Map` with atomic writes (write temp, rename).
- File format: `{ version: 1, entries: { [ticketId]: TrackedPR } }`.
- On startup: load file if exists; if corrupted, log warning, start fresh.
- When `filePath` omitted: current in-memory `Map` (backward compat for tests).

**Changes to `index.ts`:**
```ts
const prTracker = createPRTracker({
  filePath: join(dirname(configPath), ".agent-worker-pr-tracking.json"),
});
```

**Tests:** Update `test/feedback/tracking.test.ts` — test file persistence, atomic writes, corrupted file handling.

---

## Phase 5 — Feedback Concurrency Controls

**Goal:** Prevent multiple `/agent` comments from running conflicting executor work on the same branch.

**Files:** `src/config.ts`, `src/feedback/feedback-poller.ts`

**Config:**
```ts
const FeedbackSchema = z.object({
  comment_prefix: z.string().default("/agent"),
  poll_interval_seconds: z.number().positive().default(120),
  max_concurrent: z.number().int().positive().default(1),
});
```

**Code changes to `feedback-poller.ts`:**
- Track `activeTickets: Map<string, Promise<void>>` — per-ticket locking.
- Track `activeCount` against `maxConcurrent`.
- Before dispatching: if ticket already in-flight, queue or skip with warning.
- On dispatch: increment counter; on resolve/reject: decrement and clean map.

**Tests:** Update `test/feedback/feedback-poller.test.ts`, `test/config-feedback.test.ts`.

---

## Phase 6 — Deepen Feedback Processing into a State Machine

**Goal:** Model feedback as explicit discrete steps with clear state transitions.

**New file:** `src/feedback/steps.ts`

```ts
export type FeedbackState =
  | { step: "discover_pr"; ticketId: string }
  | { step: "check_merge"; ticketId: string; prNumber: number; branch: string }
  | { step: "collect_feedback"; ticketId: string; prNumber: number; branch: string }
  | { step: "dedupe"; ticketId: string; prNumber: number; comments: FeedbackEvent[] }
  | { step: "process"; ticketId: string; prNumber: number; comments: FeedbackEvent[] }
  | { step: "mark_outcome"; ticketId: string; prNumber: number; results: ProcessResult[] }
  | { step: "done" }
  | { step: "error"; ticketId: string; error: Error };

export interface FeedbackContext {
  provider: TicketProvider;
  scm: ScmProvider;
  prTracker: PRTracker;
  config: Config;
  executor?: CodeExecutor;
}

export async function runFeedbackPipeline(
  ticket: Ticket,
  ctx: FeedbackContext,
): Promise<void>;
```

**Step transitions:**
1. **discover_pr** → lookup PR by branch → **check_merge** (found) or **done** (not found).
2. **check_merge** → if merged, transition ticket, untrack → **done**. Else → **collect_feedback**.
3. **collect_feedback** → fetch PR + ticket comments, filter by prefix → **dedupe**.
4. **dedupe** → filter out agent-reaction-marked comments → **process** (if any) or **mark_outcome** (empty).
5. **process** → call `processFeedback()` per comment, collect results → **mark_outcome**.
6. **mark_outcome** → update `lastCommentCheck` → **done**.

**Modified files:**
- `src/feedback/feedback-poller.ts` — Main loop delegates to `runFeedbackPipeline(ticket, ctx)`.

**Tests:** New `test/feedback/steps.test.ts` — test each step in isolation, state transitions, error handling.

---

## Dependency Graph

```
Phase 0 (Bug Fixes 1, 2, 3) ← independent
    │
    ├─→ Phase 1 (Worktree Module) ← builds on BF 1 & 2
    │       │
    │       └─→ Phase 2 (Base Branch / Template) ← builds on Phase 1
    │
    ├─→ Phase 3 (HTTP Module) ← independent of 1-2
    │
    └─→ Phase 4 (Persistent PR Tracking) ← independent
            │
            └─→ Phase 5 (Feedback Concurrency) ← builds on Phase 4
                    │
                    └─→ Phase 6 (Feedback State Machine) ← builds on Phase 5
```

## Suggested PR Order

| # | PR | Depends On | Estimated Complexity |
|---|----|-----------|---------------------|
| 1 | Bug Fix 1: argv git commands | — | Small |
| 2 | Bug Fix 2: branch deletion guard | — | Small |
| 3 | Bug Fix 3: permissions flag wiring | — | Small |
| 4 | Phase 1: Worktree module | BF 1, 2 | Medium |
| 5 | Phase 3: HTTP module | — | Large (migrate 6 adapters) |
| 6 | Phase 2: Base branch + template | Phase 1 | Small |
| 7 | Phase 4: Persistent PR tracking | — | Medium |
| 8 | Phase 5: Feedback concurrency | Phase 4 | Medium |
| 9 | Phase 6: Feedback state machine | Phase 5 | Large |

## Test Strategy

| Phase | New Test Files | Updated Test Files |
|-------|---------------|-------------------|
| BF 1 | — | `test/pipeline.test.ts` |
| BF 2 | — | `test/pipeline.test.ts`, `test/feedback/feedback-handler.test.ts` |
| BF 3 | — | `test/docker-executor.test.ts` |
| Phase 1 | `test/pipeline/worktree.test.ts` | `test/pipeline.test.ts`, `test/feedback/feedback-handler.test.ts` |
| Phase 2 | — | `test/interpolate.test.ts`, `test/config.test.ts` |
| Phase 3 | `test/internal/http.test.ts` | All provider/SCM test files |
| Phase 4 | — | `test/feedback/tracking.test.ts` |
| Phase 5 | — | `test/feedback/feedback-poller.test.ts`, `test/config-feedback.test.ts` |
| Phase 6 | `test/feedback/steps.test.ts` | `test/feedback/feedback-poller.test.ts` |
