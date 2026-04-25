# Subagent Execution Strategy

Branch: `plan/deepen-modules-and-fixes`
Date: 2026-04-24

This document describes how to use pi subagents to implement the plan in `docs/plan.md`.

---

## Execution Principles

1. **Implement → Review → Fix loop** — every worker task is followed by a `reviewer`, then a second `worker` to address feedback.
2. **Single-writer by default** — one `worker` agent edits files at a time to avoid conflicts.
3. **Sequential phases with dependencies** — each phase waits for the previous one to pass `bun typecheck && bun test`.
4. **Parallel where safe** — independent bug fixes and independent phases can run concurrently.
5. **Validate after each phase** — `worker` runs `bun typecheck && bun test` before finishing.
6. **Document at the end** — after all implementation commits, a `doc-writer` updates README, AGENTS.md, and inline docs.

---

## Per-Phase Workflow Pattern

Every phase follows this chain pattern:

```
worker (implement) → reviewer (review) → worker (fix feedback if any)
```

```typescript
subagent({
  chain: [
    {
      agent: "worker",
      task: `<implementation task>`
    },
    {
      agent: "reviewer",
      task: `Review the implementation from {previous}. Check for:
        1. Bugs and logic errors
        2. Missing or incorrect tests
        3. Type safety issues
        4. Code quality (naming, structure, duplication)
        5. Adherence to AGENTS.md module boundaries
        6. Security concerns (command injection, credential leaks)
        
        Be specific. List each issue with file, line, and what to fix.
        If everything looks good, say "LGTM" with a brief summary.`
    },
    {
      agent: "worker",
      task: `The reviewer found the following issues in {previous}.
        Fix every issue listed. If the reviewer said LGTM, just run
        bun typecheck && bun test and confirm everything passes.
        Do NOT introduce new features or refactors beyond what the reviewer flagged.`
    }
  ]
})
```

The reviewer runs in `fork` context so it has full visibility into the parent session's accumulated changes.

---

## Phase 0: Bug Fixes

### Execution: Two parallel chains (BF1+BF2 sequential, BF3 parallel)

BF1 and BF2 both touch `pipeline.ts` so they must be sequential. BF3 touches different files.

```typescript
subagent({
  tasks: [
    // Chain A: BF1 + BF2 (both touch pipeline.ts)
    {
      agent: "worker",
      task: `
        Bug Fix 1 + Bug Fix 2 (sequentially).

        BF1: Stop shell-invoking git worktree commands.
        In src/pipeline/pipeline.ts, replace all Bun.spawn(["sh", "-c", ...]) calls
        with direct argv arrays:
        - createWorktree(): Bun.spawn(["git", "worktree", "add", "-b", branch, worktreePath, "main"])
          for create, Bun.spawn(["git", "worktree", "add", worktreePath, branch]) for checkout.
        - removeWorktree(): Bun.spawn(["git", "worktree", "remove", "--force", worktreePath])
          and Bun.spawn(["git", "branch", "-D", branch]).

        BF2: Do not delete existing PR branches after feedback work.
        On top of BF1 changes, update removeWorktree signature to accept
        options?: { deleteBranch?: boolean } (default true).
        Only run git branch -D when deleteBranch !== false.
        In src/feedback/feedback-handler.ts finally block, pass { deleteBranch: false }.

        Update tests in test/pipeline.test.ts and test/feedback/feedback-handler.test.ts.
        Run bun typecheck && bun test.`
    },
    // Chain B: BF3 (independent files)
    {
      agent: "worker",
      task: `
        Bug Fix 3: Fix container permissions flag wiring.

        1. In src/pipeline/executor.ts, createExecutor() case "container":
           Pass permissions_flag from executorConfig to createDockerExecutor.
        2. In src/pipeline/docker-executor.ts:
           - Replace dangerously_skip_permissions?: boolean with permissions_flag?: string
           - In command construction: if (config.permissions_flag) { command.push(config.permissions_flag); }

        Update test/docker-executor.test.ts.
        Run bun typecheck && bun test.`
    }
  ],
  worktree: true
})
```

After both chains complete, run the review loop for each:

```typescript
// Review Chain A (BF1+BF2)
subagent({
  chain: [
    {
      agent: "reviewer",
      task: `Review the BF1+BF2 changes. Focus on:
        1. Are all sh -c calls eliminated from pipeline.ts?
        2. Does removeWorktree correctly guard branch deletion?
        3. Does feedback-handler pass deleteBranch: false?
        4. Are tests updated to cover both paths?
        Be specific about file, line, and what to fix.`
    },
    {
      agent: "worker",
      task: `Fix every issue the reviewer found: {previous}. If LGTM, run bun typecheck && bun test.`
    }
  ]
})

// Review Chain B (BF3)
subagent({
  chain: [
    {
      agent: "reviewer",
      task: `Review the BF3 changes. Focus on:
        1. Does createExecutor pass permissions_flag?
        2. Does docker-executor use permissions_flag instead of dangerously_skip_permissions?
        3. Is backward compat maintained (no flag = no injection)?
        4. Are tests updated?
        Be specific.`
    },
    {
      agent: "worker",
      task: `Fix every issue the reviewer found: {previous}. If LGTM, run bun typecheck && bun test.`
    }
  ]
})
```

Merge both worktree branches, resolve any conflict, validate, commit.

---

## Phase 1: Worktree Module

Depends on: Phase 0

```typescript
subagent({
  chain: [
    {
      agent: "worker",
      task: `
        Phase 1: Extract worktree lifecycle into src/pipeline/worktree.ts.
        Read docs/plan.md Phase 1 for full details.

        1. Create src/pipeline/worktree.ts with:
           - WorktreeCreateOptions { createBranch?: boolean; baseBranch?: string; }
           - WorktreeRemoveOptions { deleteBranch?: boolean; }
           - WorktreeHandle { path: string; branch: string; createdBranch: boolean; }
           - createWorktree(repoPath, branch, options?) → Promise<WorktreeHandle>
             Uses argv-based Bun.spawn (not sh -c).
             Sets handle.createdBranch from options.createBranch (default true).
             Uses options.baseBranch (default "main") for the source ref.
           - removeWorktree(repoPath, handle, options?) → Promise<void>
             Defaults deleteBranch to handle.createdBranch (can override).
             Only runs git branch -D when deleteBranch is true.
             Uses argv-based Bun.spawn.

        2. Update src/pipeline/pipeline.ts:
           Remove old createWorktree and removeWorktree functions.
           Import from ./worktree.ts.
           executePipeline: use WorktreeHandle, pass to removeWorktree.

        3. Update src/feedback/feedback-handler.ts:
           Import from ../pipeline/worktree.ts.
           Use WorktreeHandle; removeWorktree auto-skips branch deletion (createdBranch=false).

        4. Create test/pipeline/worktree.test.ts.
        5. Update existing tests in test/pipeline.test.ts and test/feedback/feedback-handler.test.ts.

        Run bun typecheck && bun test.`
    },
    {
      agent: "reviewer",
      task: `Review the Phase 1 worktree module changes: {previous}. Check:
        1. Does WorktreeHandle correctly track branch ownership?
        2. Are all git commands using argv arrays (no sh -c)?
        3. Is removeWorktree's default logic correct (defaults to handle.createdBranch)?
        4. Does executePipeline properly create and clean up WorktreeHandle?
        5. Does feedback-handler no longer delete PR branches?
        6. Are tests comprehensive for both create/remove paths?
        7. Does the module respect AGENTS.md boundary rules (no imports from upper layers)?
        Be specific about any issues.`
    },
    {
      agent: "worker",
      task: `Fix every issue the reviewer found: {previous}. If LGTM, run bun typecheck && bun test.`
    }
  ]
})
```

---

## Phase 2: Configurable Base Branch and Branch Template

Depends on: Phase 1

```typescript
subagent({
  chain: [
    {
      agent: "worker",
      task: `
        Phase 2: Add configurable base branch and branch template.
        Read docs/plan.md Phase 2 for full details.

        1. Update src/config.ts RepoSchema:
           Add base_branch: z.string().default("main"),
           Add branch_template: z.string().default("agent/task-{id}").
        2. Update src/pipeline/interpolate.ts buildTaskVars:
           Add branchTemplate parameter (default "agent/task-{id}").
           Use template.replace("{id}", ticket.identifier) for branch.
        3. Update src/pipeline/pipeline.ts executePipeline:
           Pass config.repo.base_branch to createWorktree.
           Pass config.repo.branch_template to buildTaskVars.
        4. Update src/feedback/feedback-handler.ts:
           Pass config.repo.branch_template to buildTaskVars.
        5. Update src/feedback/feedback-poller.ts:
           Replace hardcoded "agent/task-${ticket.identifier}" with buildTaskVars(ticket, "", config.repo.branch_template).branch.
        6. Update src/scheduler.ts:
           Pass config.repo.branch_template to buildTaskVars.
        7. Update tests: test/interpolate.test.ts, test/config.test.ts.

        Run bun typecheck && bun test.`
    },
    {
      agent: "reviewer",
      task: `Review the Phase 2 branch template changes: {previous}. Check:
        1. Are base_branch and branch_template optional with correct defaults?
        2. Is "main" still the effective default when not configured?
        3. Is "agent/task-{id}" still the effective default branch name?
        4. Are all call sites updated (pipeline, feedback-handler, feedback-poller, scheduler)?
        5. Are template tokens beyond {id} handled gracefully (not replaced → left as-is)?
        6. Do existing tests still pass without config changes?
        Be specific.`
    },
    {
      agent: "worker",
      task: `Fix every issue the reviewer found: {previous}. If LGTM, run bun typecheck && bun test.`
    }
  ]
})
```

---

## Phase 3: Shared HTTP/Backoff Module

Depends on: Phase 0 (independent of Phases 1-2)

```typescript
subagent({
  chain: [
    {
      agent: "scout",
      task: `
        Analyze the duplicated HTTP/backoff patterns across these files:
        - src/providers/linear.ts (withBackoff)
        - src/providers/jira.ts (withBackoff, jiraFetch)
        - src/providers/plane.ts (withBackoff, planeFetch)
        - src/providers/github.ts (withBackoff, graphqlFetch, restFetch)
        - src/scm/github.ts (ghFetch, ghPost)
        - src/scm/bitbucket-server.ts (bbFetch)

        For each file, identify:
        1. The exact withBackoff function signature and behavior
        2. The fetch wrapper function signatures and their auth/header patterns
        3. Error handling patterns (status code checks, allowed statuses)
        4. Logging patterns
        5. Any unique behavior that shouldn't be generalized

        Output a structured summary of common vs unique patterns.`
    },
    {
      agent: "worker",
      task: `
        Phase 3: Create shared HTTP module and migrate all adapters.
        Read docs/plan.md Phase 3 for full details.
        Based on the scout analysis in {previous}:

        1. Create src/internal/http.ts with:
           HttpClientOptions, HttpRequestOptions, HttpClient interfaces.
           createHttpClient factory with shared backoff, logging, error handling.
           Export withBackoff for edge cases.

        2. Migrate each adapter ONE AT A TIME
           (order: linear, jira, plane, github-provider, github-scm, bitbucket-scm):
           Remove local withBackoff. Remove local fetch wrapper.
           Use createHttpClient from internal/http.ts.
           Keep unique behavior (e.g. Linear SDK wrapping, GitHub GraphQL).

        3. Create test/internal/http.test.ts.
        4. Update all affected test files.

        Run bun typecheck && bun test after each migration.`
    },
    {
      agent: "reviewer",
      task: `Review the Phase 3 HTTP module and adapter migrations: {previous}. Check:
        1. Does createHttpClient handle all auth patterns (Bearer, Basic, x-api-key)?
        2. Is backoff behavior identical to the original per-file implementations?
        3. Are allowed statuses handled correctly (204 for merges, 201 for creates)?
        4. Is logging preserved (component tags, timing, request/response)?
        5. Does the Linear provider still work with the SDK (not raw fetch)?
        6. Does GitHub provider handle both GraphQL and REST correctly?
        7. Are all tests updated to mock the new HttpClient?
        8. Does the internal/ module respect AGENTS.md boundary rules?
        Be specific.`
    },
    {
      agent: "worker",
      task: `Fix every issue the reviewer found: {previous}. If LGTM, run bun typecheck && bun test.`
    }
  ]
})
```

---

## Phase 4: Persistent PR Tracking

Depends on: Phase 0 (independent of Phases 1-3)

```typescript
subagent({
  chain: [
    {
      agent: "worker",
      task: `
        Phase 4: Add file-backed PR tracking.
        Read docs/plan.md Phase 4 for full details.

        1. Update src/feedback/tracking.ts:
           Change createPRTracker to accept options?: { filePath?: string }.
           When filePath provided: JSON file-backed implementation.
           Read file on startup. Atomic writes (write temp, rename).
           File format: { version: 1, entries: { [ticketId]: TrackedPR } }.
           Corrupted file: log warning, start fresh.
           When filePath omitted: keep current in-memory Map.

        2. Update src/index.ts:
           Import { join, dirname } from "path".
           Pass filePath: join(dirname(resolve(configPath)), ".agent-worker-pr-tracking.json").

        3. Update test/feedback/tracking.test.ts:
           Test file persistence, atomic writes, corrupted file, in-memory fallback.

        Run bun typecheck && bun test.`
    },
    {
      agent: "reviewer",
      task: `Review the Phase 4 persistent PR tracking: {previous}. Check:
        1. Are writes truly atomic (write-to-temp + rename)?
        2. Is the file format versioned for future migrations?
        3. Is concurrent write safety handled (two poller cycles writing at once)?
        4. Is corrupted file handling graceful (no crash on bad JSON)?
        5. Does in-memory mode still work (backward compat for tests)?
        6. Is the tracking file path relative to the config file, not CWD?
        7. Should .agent-worker-pr-tracking.json be in .gitignore?
        Be specific.`
    },
    {
      agent: "worker",
      task: `Fix every issue the reviewer found: {previous}. If LGTM, run bun typecheck && bun test.`
    }
  ]
})
```

---

## Phase 5: Feedback Concurrency Controls

Depends on: Phase 4

```typescript
subagent({
  chain: [
    {
      agent: "worker",
      task: `
        Phase 5: Add feedback concurrency controls.
        Read docs/plan.md Phase 5 for full details.

        1. Update src/config.ts FeedbackSchema:
           Add max_concurrent: z.number().int().positive().default(1).

        2. Update src/feedback/feedback-poller.ts:
           Read config.feedback.max_concurrent.
           Add activeTickets: Map<string, Promise<void>> for per-ticket locking.
           Add activeCount tracking.
           Before dispatching: if ticket already in activeTickets, skip with warning.
           If activeCount >= maxConcurrent, skip with warning.
           On dispatch: increment activeCount, store promise.
           On resolve/reject: decrement activeCount, remove from map.

        3. Update tests: test/feedback/feedback-poller.test.ts, test/config-feedback.test.ts.

        Run bun typecheck && bun test.`
    },
    {
      agent: "reviewer",
      task: `Review the Phase 5 feedback concurrency: {previous}. Check:
        1. Is per-ticket locking correct (same ticket never double-dispatched)?
        2. Is activeCount properly decremented on both success and failure?
        3. Does the semaphore correctly limit total concurrent processing?
        4. Are skipped comments logged clearly for debugging?
        5. Is max_concurrent=1 (default) identical to current behavior?
        6. Are there race conditions in the Map mutations?
        Be specific.`
    },
    {
      agent: "worker",
      task: `Fix every issue the reviewer found: {previous}. If LGTM, run bun typecheck && bun test.`
    }
  ]
})
```

---

## Phase 6: Feedback State Machine

Depends on: Phase 5

```typescript
subagent({
  chain: [
    {
      agent: "scout",
      task: `
        Analyze the feedback processing logic in src/feedback/feedback-poller.ts
        and src/feedback/feedback-handler.ts.

        Map the current flow as executed in the poller's main loop:
        1. For each ticket in code_review:
           a. PR discovery (if not tracked)
           b. Merge check
           c. PR comment fetch (issue + review)
           d. Ticket comment fetch
           e. Actionable comment filtering (prefix)
           f. Reaction-based dedup
           g. processFeedback dispatch per comment
           h. lastCommentCheck update

        For each step, identify:
        - Entry conditions
        - External dependencies (scm, provider, tracker)
        - Error handling strategy
        - Side effects
        - Exit conditions / next step

        Output as a structured state transition table.`
    },
    {
      agent: "worker",
      task: `
        Phase 6: Extract feedback processing into a state machine.
        Read docs/plan.md Phase 6 for full details.
        Based on the scout analysis in {previous}:

        1. Create src/feedback/steps.ts with:
           FeedbackState discriminated union type.
           FeedbackContext interface (bundles provider, scm, prTracker, config, executor).
           runFeedbackPipeline(ticket, ctx) function.
           Each step is a discrete async function.
           State transitions are explicit and logged.

        2. Update src/feedback/feedback-poller.ts:
           Main loop delegates to runFeedbackPipeline(ticket, ctx).
           Remove the interleaved logic from the poll loop.
           Keep the interruptible sleep and resolved set.

        3. Create test/feedback/steps.test.ts:
           Test each step in isolation with mock FeedbackContext.
           Test state transitions. Test error handling at each step.

        4. Update test/feedback/feedback-poller.test.ts.

        Run bun typecheck && bun test.`
    },
    {
      agent: "reviewer",
      task: `Review the Phase 6 feedback state machine: {previous}. Check:
        1. Are all state transitions explicit and logged?
        2. Is error handling consistent at each step?
        3. Does the poller correctly delegate and handle the resolved set?
        4. Are all side effects (tracker updates, status transitions, comments) preserved?
        5. Is the FeedbackContext interface clean (no leaky abstractions)?
        6. Does the state machine respect the concurrency controls from Phase 5?
        7. Are tests comprehensive for each step and transition?
        8. Does the module respect AGENTS.md boundary rules?
        Be specific.`
    },
    {
      agent: "worker",
      task: `Fix every issue the reviewer found: {previous}. If LGTM, run bun typecheck && bun test.`
    }
  ]
})
```

---

## Final Phase: Documentation

After all implementation phases are complete, committed, and tests pass.

```typescript
subagent({
  chain: [
    {
      agent: "scout",
      task: `
        Survey the final state of the codebase after all 7 phases.
        Identify every documentation artifact that needs updating:

        1. AGENTS.md — Does it reflect the new module structure?
           - New modules: src/pipeline/worktree.ts, src/internal/http.ts, src/feedback/steps.ts
           - Updated interfaces: WorktreeHandle, HttpClient, FeedbackState
           - New config fields: repo.base_branch, repo.branch_template, feedback.max_concurrent
        2. README.md (if exists) — Does it reflect new config options and module structure?
        3. Inline JSDoc — Are all new exports documented?
        4. docs/plan.md — Does it still accurately describe the codebase or does it need a "completed" status?
        5. .gitignore — Should .agent-worker-pr-tracking.json be added?

        Output a structured list of files and sections that need updates,
        with specific content suggestions for each.`
    },
    {
      agent: "doc-writer",
      task: `
        Update all documentation based on the scout's findings: {previous}.

        1. Update AGENTS.md to reflect the new module structure:
           - Add src/pipeline/worktree.ts to Module Boundaries
           - Add src/internal/http.ts as a new Infrastructure module
           - Add src/feedback/steps.ts to the feedback section
           - Update Config Reference table with new fields
           - Update any code examples that reference old interfaces

        2. Update .gitignore if needed (add .agent-worker-pr-tracking.json).

        3. Update docs/plan.md: add a "Status" section at the top marking each phase as completed.

        4. Verify all JSDoc comments on new exports are accurate and complete.
           Do NOT rewrite existing JSDoc that hasn't changed.

        Do NOT modify any source code (.ts files). Only update documentation files.`
    },
    {
      agent: "reviewer",
      task: `Review the documentation updates: {previous}. Check:
        1. Does AGENTS.md accurately reflect the final codebase structure?
        2. Are all new config fields documented with correct defaults?
        3. Are module boundary rules accurate for new modules?
        4. Is .gitignore updated correctly?
        5. Are there any stale references to old patterns (e.g. "sh -c", in-memory-only tracking)?
        6. Is the tone consistent with existing docs?
        Be specific.`
    },
    {
      agent: "worker",
      task: `Fix any documentation issues the reviewer found: {previous}. If LGTM, confirm.`
    }
  ]
})
```

**Note:** The `doc-writer` agent doesn't exist as a builtin. Either:
- Use `worker` with a documentation-focused task prompt (recommended, works now).
- Create a project-scoped `doc-writer` agent:

```typescript
subagent({
  action: "create",
  config: {
    name: "doc-writer",
    description: "Updates documentation to reflect codebase changes",
    systemPrompt: "You are a documentation specialist. You ONLY edit .md, .txt, .gitignore, and YAML config example files. You NEVER modify .ts source files. Your job is to keep documentation accurate, concise, and consistent with the codebase. Follow the project's existing documentation style.",
    systemPromptMode: "replace",
    inheritProjectContext: true,
    inheritSkills: true
  }
})
```

---

## Overall Execution Timeline

```
Time →

T0   Phase 0 Bug Fixes ──── review ──── fix ──┐
                                               ├→ Commit
T1   Phase 1 Worktree  ──── review ──── fix ──┤
     Phase 3 HTTP       ──── review ──── fix ──┤  ← parallel (independent files)
     Phase 4 Tracking   ──── review ──── fix ──┤  ← parallel
                                               ├→ Commit each
T2   Phase 2 Branch cfg ──── review ──── fix ──┤  ← depends on Phase 1
     Phase 5 Concurrency ─── review ──── fix ──┤  ← depends on Phase 4
                                               ├→ Commit each
T3   Phase 6 State machine ── review ──── fix ─┤  ← depends on Phase 5
                                               ├→ Final commit
T4   Doc writer ──── review ──── fix ──────────┘  ← after all commits
```

### Safe sequential execution (recommended):

```typescript
// One chain per phase, each with worker → reviewer → worker
// Run phases in dependency order
// Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Docs
```

### Fast parallel execution:

```typescript
// Round 1: Phase 0 bug fixes (BF1+BF2 chain + BF3 chain, parallel worktrees)
// Round 2: Phase 1 + Phase 3 + Phase 4 (3 parallel chains, independent files)
// Round 3: Phase 2 + Phase 5 (2 parallel chains)
// Round 4: Phase 6 (single chain)
// Round 5: Documentation (single chain)
```

---

## Summary of Agent Calls per Phase

| Phase | Worker | Reviewer | Worker (fix) | Scout | Doc-writer |
|-------|--------|----------|-------------|-------|------------|
| Phase 0 (BF1+2) | ✅ | ✅ | ✅ | — | — |
| Phase 0 (BF3) | ✅ | ✅ | ✅ | — | — |
| Phase 1 | ✅ | ✅ | ✅ | — | — |
| Phase 2 | ✅ | ✅ | ✅ | — | — |
| Phase 3 | ✅ | ✅ | ✅ | ✅ | — |
| Phase 4 | ✅ | ✅ | ✅ | — | — |
| Phase 5 | ✅ | ✅ | ✅ | — | — |
| Phase 6 | ✅ | ✅ | ✅ | ✅ | — |
| Docs | — | ✅ | ✅ | ✅ | ✅ |

**Total subagent calls: ~27** (9 phases × 3 steps + 2 scout steps + 1 doc-writer step)
