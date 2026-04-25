# Subagent Execution Strategy

Branch: `plan/deepen-modules-and-fixes`
Date: 2026-04-24

This document describes how to use pi subagents to implement the plan in `docs/plan.md`.

---

## Execution Principles

1. **Single-writer by default** — one `worker` agent edits files at a time to avoid conflicts.
2. **Sequential phases with dependencies** — each phase waits for the previous one to pass `bun typecheck && bun test`.
3. **Parallel where safe** — independent bug fixes and independent phases can run concurrently.
4. **Validate after each phase** — `worker` runs `bun typecheck && bun test` before finishing.

---

## Phase 0: Bug Fixes (3 parallel workers)

These are independent — no shared files between BF1/BF3, and BF2 only adds an optional parameter.

### Execution: PARALLEL

```
subagent({
  tasks: [
    {
      agent: "worker",
      task: `
        Bug Fix 1: Stop shell-invoking git worktree commands
        
        In src/pipeline/pipeline.ts, replace all Bun.spawn(["sh", "-c", ...]) calls
        with direct argv arrays:
        
        1. createWorktree(): Replace the string command with:
           - Bun.spawn(["git", "worktree", "add", "-b", branch, worktreePath, "main"]) for create
           - Bun.spawn(["git", "worktree", "add", worktreePath, branch]) for checkout
           
        2. removeWorktree(): Replace with:
           - Bun.spawn(["git", "worktree", "remove", "--force", worktreePath])
           - Bun.spawn(["git", "branch", "-D", branch])
        
        Update tests in test/pipeline.test.ts to verify argv arrays.
        Run bun typecheck && bun test and fix any failures.
      `
    },
    {
      agent: "worker",
      task: `
        Bug Fix 2: Do not delete existing PR branches after feedback work
        
        1. In src/pipeline/pipeline.ts, change removeWorktree signature to:
           removeWorktree(repoPath, worktreePath, branch, options?: { deleteBranch?: boolean })
           Default deleteBranch to true. Only run git branch -D when deleteBranch !== false.
        
        2. In src/feedback/feedback-handler.ts finally block, pass { deleteBranch: false }:
           await removeWorktree(config.repo.path, worktreePath, vars.branch, { deleteBranch: false });
        
        Update tests. Run bun typecheck && bun test.
      `
    },
    {
      agent: "worker",
      task: `
        Bug Fix 3: Fix container permissions flag wiring
        
        1. In src/pipeline/executor.ts, createExecutor() case "container":
           Pass permissions_flag from executorConfig to createDockerExecutor.
        
        2. In src/pipeline/docker-executor.ts:
           - Replace dangerously_skip_permissions?: boolean with permissions_flag?: string
           - In command construction, replace the hardcoded --dangerously-skip-permissions check with:
             if (config.permissions_flag) { command.push(config.permissions_flag); }
        
        Update test/docker-executor.test.ts. Run bun typecheck && bun test.
      `
    }
  ],
  worktree: true
})
```

**Note:** BF1 and BF2 both modify `pipeline.ts`. Since we use worktrees, they won't conflict on disk, but the final merge will need a manual resolve on that file. **Alternative:** run BF1 and BF2 sequentially (BF1 first since BF2 extends its function signature), and only parallelize BF3 alongside them.

**Recommended safe execution:**

```
subagent({
  tasks: [
    {
      agent: "worker",
      task: "Bug Fix 1 + Bug Fix 2 (sequentially in one task)..."
    },
    {
      agent: "worker",
      task: "Bug Fix 3: Fix container permissions flag wiring..."
    }
  ],
  worktree: true
})
```

After both complete, merge the worktree diffs, resolve any pipeline.ts conflict, then validate.

---

## Phase 1: Worktree Module

Depends on: Phase 0 (Bug Fixes 1 & 2)

### Execution: SINGLE worker

```
subagent({
  agent: "worker",
  task: `
    Phase 1: Extract worktree lifecycle into src/pipeline/worktree.ts
    
    1. Create src/pipeline/worktree.ts with:
       - WorktreeCreateOptions { createBranch?: boolean; baseBranch?: string; }
       - WorktreeRemoveOptions { deleteBranch?: boolean; }
       - WorktreeHandle { path: string; branch: string; createdBranch: boolean; }
       - createWorktree(repoPath, branch, options?) → Promise<WorktreeHandle>
         - Uses argv-based Bun.spawn (not sh -c)
         - Sets handle.createdBranch from options.createBranch (default true)
         - Uses options.baseBranch (default "main") for the source ref
       - removeWorktree(repoPath, handle, options?) → Promise<void>
         - Defaults deleteBranch to handle.createdBranch (can override)
         - Only runs git branch -D when deleteBranch is true
         - Uses argv-based Bun.spawn
    
    2. Update src/pipeline/pipeline.ts:
       - Remove old createWorktree and removeWorktree functions
       - Import from ./worktree.ts
       - executePipeline: use WorktreeHandle, pass to removeWorktree
    
    3. Update src/feedback/feedback-handler.ts:
       - Import from ../pipeline/worktree.ts
       - Use WorktreeHandle; removeWorktree auto-skips branch deletion (createdBranch=false)
    
    4. Create test/pipeline/worktree.test.ts with tests for:
       - createWorktree with createBranch=true/false
       - removeWorktree with deleteBranch=true/false
       - removeWorktree defaults deleteBranch to handle.createdBranch
    
    5. Update existing tests in test/pipeline.test.ts and test/feedback/feedback-handler.test.ts
    
    Run bun typecheck && bun test. Fix any failures.
    Read docs/plan.md Phase 1 for full details.
  `
})
```

---

## Phase 2: Configurable Base Branch and Branch Template

Depends on: Phase 1

### Execution: SINGLE worker

```
subagent({
  agent: "worker",
  task: `
    Phase 2: Add configurable base branch and branch template
    
    1. Update src/config.ts RepoSchema:
       - Add base_branch: z.string().default("main")
       - Add branch_template: z.string().default("agent/task-{id}")
    
    2. Update src/pipeline/interpolate.ts buildTaskVars:
       - Add branchTemplate parameter (default "agent/task-{id}")
       - Use template.replace("{id}", ticket.identifier) for branch
    
    3. Update src/pipeline/pipeline.ts executePipeline:
       - Pass config.repo.base_branch to createWorktree
       - Pass config.repo.branch_template to buildTaskVars
    
    4. Update src/feedback/feedback-handler.ts:
       - Pass config.repo.branch_template to buildTaskVars
    
    5. Update src/feedback/feedback-poller.ts:
       - Replace hardcoded "agent/task-${ticket.identifier}" with buildTaskVars(ticket).branch
    
    6. Update src/scheduler.ts:
       - Pass config.repo.branch_template to buildTaskVars
    
    7. Update tests: test/interpolate.test.ts, test/config.test.ts
    
    Run bun typecheck && bun test. Fix any failures.
    Read docs/plan.md Phase 2 for full details.
  `
})
```

---

## Phase 3: Shared HTTP/Backoff Module

Depends on: Phase 0 (independent of Phases 1-2)

### Execution: CHAIN (scout → worker)

Scout identifies exact patterns to consolidate, then worker implements.

```
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
        
        Output a structured summary of common vs unique patterns.
      `
    },
    {
      agent: "worker",
      task: `
        Phase 3: Create shared HTTP module and migrate all adapters
        
        Based on the scout analysis in {previous}:
        
        1. Create src/internal/http.ts with:
           - HttpClientOptions, HttpRequestOptions, HttpClient interfaces
           - createHttpClient factory with shared backoff, logging, error handling
           - Export withBackoff for edge cases
        
        2. Migrate each adapter ONE AT A TIME (order: linear, jira, plane, github-provider, github-scm, bitbucket-scm):
           - Remove local withBackoff
           - Remove local fetch wrapper
           - Use createHttpClient from internal/http.ts
           - Keep unique behavior (e.g. Linear SDK wrapping, GitHub GraphQL)
        
        3. Create test/internal/http.test.ts
        
        4. Update all affected test files
        
        Run bun typecheck && bun test after each migration.
        Read docs/plan.md Phase 3 for full details.
      `
    }
  ]
})
```

---

## Phase 4: Persistent PR Tracking

Depends on: Phase 0 (independent of Phases 1-3)

### Execution: SINGLE worker

```
subagent({
  agent: "worker",
  task: `
    Phase 4: Add file-backed PR tracking
    
    1. Update src/feedback/tracking.ts:
       - Change createPRTracker signature to accept options?: { filePath?: string }
       - When filePath provided: JSON file-backed implementation
         - Read file on startup
         - Atomic writes (write temp, rename)
         - File format: { version: 1, entries: { [ticketId]: TrackedPR } }
         - Corrupted file: log warning, start fresh
       - When filePath omitted: keep current in-memory Map (backward compat)
    
    2. Update src/index.ts:
       - Import join, dirname from path
       - Pass filePath to createPRTracker:
         join(dirname(configPath), ".agent-worker-pr-tracking.json")
    
    3. Update test/feedback/tracking.test.ts:
       - Test file persistence (write → read → verify)
       - Test atomic writes
       - Test corrupted file handling
       - Test in-memory mode still works
    
    Run bun typecheck && bun test. Fix any failures.
    Read docs/plan.md Phase 4 for full details.
  `
})
```

---

## Phase 5: Feedback Concurrency Controls

Depends on: Phase 4

### Execution: SINGLE worker

```
subagent({
  agent: "worker",
  task: `
    Phase 5: Add feedback concurrency controls
    
    1. Update src/config.ts FeedbackSchema:
       - Add max_concurrent: z.number().int().positive().default(1)
    
    2. Update src/feedback/feedback-poller.ts:
       - Read config.feedback.max_concurrent
       - Add activeTickets: Map<string, Promise<void>> for per-ticket locking
       - Add activeCount tracking
       - Before dispatching processActionableFeedback:
         - If ticket already in activeTickets: skip with warning log
         - If activeCount >= maxConcurrent: skip with warning log
       - On dispatch: increment activeCount, store promise in activeTickets
       - On resolve/reject: decrement activeCount, remove from activeTickets
    
    3. Update tests:
       - test/feedback/feedback-poller.test.ts: test concurrent dispatch
       - test/config-feedback.test.ts: test max_concurrent config
    
    Run bun typecheck && bun test. Fix any failures.
    Read docs/plan.md Phase 5 for full details.
  `
})
```

---

## Phase 6: Feedback State Machine

Depends on: Phase 5

### Execution: CHAIN (scout → worker)

Scout maps the exact interleaved logic, then worker extracts into state machine.

```
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
        
        Output as a structured state transition table.
      `
    },
    {
      agent: "worker",
      task: `
        Phase 6: Extract feedback processing into a state machine
        
        Based on the scout analysis in {previous}:
        
        1. Create src/feedback/steps.ts with:
           - FeedbackState discriminated union type
           - FeedbackContext interface (bundles provider, scm, prTracker, config, executor)
           - runFeedbackPipeline(ticket, ctx) function
           - Each step is a discrete async function
           - State transitions are explicit and logged
        
        2. Update src/feedback/feedback-poller.ts:
           - Main loop delegates to runFeedbackPipeline(ticket, ctx)
           - Remove the interleaved logic from the poll loop
           - Keep the interruptible sleep and resolved set
        
        3. Create test/feedback/steps.test.ts:
           - Test each step in isolation with mock FeedbackContext
           - Test state transitions
           - Test error handling at each step
        
        4. Update test/feedback/feedback-poller.test.ts
        
        Run bun typecheck && bun test. Fix any failures.
        Read docs/plan.md Phase 6 for full details.
      `
    }
  ]
})
```

---

## Overall Execution Timeline

```
Time →

T0:  Phase 0 (BF1+BF2) ──────┐
     Phase 0 (BF3)      ──────┤
                               ├→ Merge, validate
T1:  Phase 1 (Worktree) ──────┤
     Phase 3 (HTTP)     ──────┤  ← can run in parallel (independent files)
     Phase 4 (Tracking) ──────┤  ← can run in parallel
                               ├→ Merge, validate each
T2:  Phase 2 (Branch cfg) ────┤  ← depends on Phase 1
     Phase 5 (Concurrency) ───┤  ← depends on Phase 4
                               ├→ Merge, validate each
T3:  Phase 6 (State machine) ─┤  ← depends on Phase 5
                               └→ Final merge, full test suite
```

### Maximum parallelism (4 workers):

At T1, we can run Phase 1, Phase 3, and Phase 4 in parallel since they touch completely different files:
- Phase 1: `src/pipeline/worktree.ts` (new), `src/pipeline/pipeline.ts`, `src/feedback/feedback-handler.ts`
- Phase 3: `src/internal/http.ts` (new), all providers, all SCM
- Phase 4: `src/feedback/tracking.ts`, `src/index.ts`

**However**, to keep the codebase stable and avoid complex merges, the recommended approach is **sequential execution per dependency level**:

```
subagent({ chain: [
  { agent: "worker", task: "Phase 0: Bug Fixes 1+2+3" },
  { agent: "worker", task: "Phase 1: Worktree module" },
  { agent: "worker", task: "Phase 2: Base branch + template" },
  { agent: "worker", task: "Phase 3: HTTP module" },
  { agent: "worker", task: "Phase 4: Persistent PR tracking" },
  { agent: "worker", task: "Phase 5: Feedback concurrency" },
  { agent: "worker", task: "Phase 6: Feedback state machine" },
] })
```

This is the safest approach. Each step's output becomes `{previous}` context for the next, so each worker knows what was already done.

### For speed (parallel where safe):

```
// Step 1: Bug fixes (parallel BF1+BF2 vs BF3)
subagent({ tasks: [
  { agent: "worker", task: "BF1 + BF2" },
  { agent: "worker", task: "BF3" },
], worktree: true })

// Step 2: Merge, then parallel Phase 1 + Phase 3 + Phase 4
subagent({ tasks: [
  { agent: "worker", task: "Phase 1: Worktree module" },
  { agent: "worker", task: "Phase 3: HTTP module" },
  { agent: "worker", task: "Phase 4: Persistent tracking" },
], worktree: true })

// Step 3: Merge, then Phase 2 + Phase 5
subagent({ tasks: [
  { agent: "worker", task: "Phase 2: Base branch + template" },
  { agent: "worker", task: "Phase 5: Feedback concurrency" },
], worktree: true })

// Step 4: Phase 6 (depends on Phase 5)
subagent({ agent: "worker", task: "Phase 6: State machine" })
```
