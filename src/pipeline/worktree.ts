/**
 * @module src/pipeline/worktree — Git worktree lifecycle: creation and removal with branch management.
 */
import { join } from "path";
import { tmpdir } from "os";
import { log } from "../logger.ts";

/** Options for {@link createWorktree}. */
export type WorktreeCreateOptions = {
  /** Whether to create a new branch (default `true`). */
  createBranch?: boolean;
  /** Source ref when creating a new branch (default `"main"`). */
  baseBranch?: string;
};

/** Options for {@link removeWorktree}. */
export type WorktreeRemoveOptions = {
  /** Whether to delete the associated branch after removal.
   *  Defaults to `handle.createdBranch` if not specified. */
  deleteBranch?: boolean;
};

/** Opaque handle returned by {@link createWorktree}. */
export type WorktreeHandle = {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Branch name used for the worktree. */
  branch: string;
  /** Whether a new branch was created (as opposed to checking out an existing one). */
  createdBranch: boolean;
};

/**
 * Creates an isolated git worktree in the temp directory.
 * Defaults to creating a new branch from the specified base branch.
 * @param repoPath - Path to the git repository.
 * @param branch - Name for the worktree branch.
 * @param options - Creation options (createBranch, baseBranch).
 * @returns A {@link WorktreeHandle} with the worktree path and metadata.
 * @throws Error if git worktree add fails.
 */
export async function createWorktree(
  repoPath: string,
  branch: string,
  options?: WorktreeCreateOptions,
): Promise<WorktreeHandle> {
  const worktreePath = join(tmpdir(), `agent-worker-${branch}`);
  const createBranch = options?.createBranch !== false;
  const baseBranch = options?.baseBranch ?? "main";

  log.info("Creating worktree", { worktreePath, branch, createBranch, baseBranch });

  const spawnArgs = createBranch
    ? ["git", "worktree", "add", "-b", branch, worktreePath, baseBranch]
    : ["git", "worktree", "add", worktreePath, branch];

  const proc = Bun.spawn(spawnArgs, {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, _, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`Failed to create worktree: ${stderr.trim()}`);
  }

  return { path: worktreePath, branch, createdBranch: createBranch };
}

/**
 * Removes a git worktree and optionally deletes the associated branch.
 * Logs warnings on failure but does not throw.
 * @param repoPath - Path to the git repository.
 * @param handle - The {@link WorktreeHandle} returned by {@link createWorktree}.
 * @param options - Removal options (deleteBranch overrides handle.createdBranch default).
 */
export async function removeWorktree(
  repoPath: string,
  handle: WorktreeHandle,
  options?: WorktreeRemoveOptions,
): Promise<void> {
  const deleteBranch = options?.deleteBranch ?? handle.createdBranch;
  log.info("Removing worktree", { worktreePath: handle.path, deleteBranch });

  const proc = Bun.spawn(["git", "worktree", "remove", "--force", handle.path], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, _, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    log.warn("Failed to remove worktree", { worktreePath: handle.path, error: stderr.trim() });
    return;
  }

  // Only delete the branch when deleteBranch is true.
  if (deleteBranch) {
    const deleteProc = Bun.spawn(["git", "branch", "-D", handle.branch], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [deleteExitCode, , deleteErr] = await Promise.all([
      deleteProc.exited,
      new Response(deleteProc.stdout).text(),
      new Response(deleteProc.stderr).text(),
    ]);

    if (deleteExitCode !== 0) {
      log.warn("Failed to delete branch", { branch: handle.branch, error: deleteErr.trim() });
    }
  }
}
