import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { createWorktree, removeWorktree } from "../../src/pipeline/worktree.ts";
import { initLogger } from "../../src/logger.ts";
import type { WorktreeHandle } from "../../src/pipeline/worktree.ts";

beforeEach(() => {
  initLogger({ level: "error" });
});

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-worker-wt-test-"));
  execSync("git init -b main && git commit --allow-empty -m 'init'", { cwd: dir });
  return dir;
}

describe("createWorktree", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
  });

  afterEach(() => {
    try {
      execSync("git worktree prune", { cwd: repoDir });
    } catch {}
    rmSync(repoDir, { recursive: true, force: true });
  });

  test("creates a branch and returns WorktreeHandle with createdBranch=true", async () => {
    const handle = await createWorktree(repoDir, "test-new-branch");

    expect(handle.path).toContain("agent-worker-test-new-branch");
    expect(handle.branch).toBe("test-new-branch");
    expect(handle.createdBranch).toBe(true);
    expect(existsSync(handle.path)).toBe(true);

    // Branch should exist
    const branches = execSync("git branch --list test-new-branch", { cwd: repoDir }).toString().trim();
    expect(branches).toContain("test-new-branch");

    // Clean up
    execSync(`git worktree remove --force ${handle.path}`, { cwd: repoDir });
    execSync("git branch -D test-new-branch", { cwd: repoDir });
  });

  test("with createBranch=false returns handle with createdBranch=false", async () => {
    // Create the branch first so we can check it out without creating
    execSync("git branch existing-branch", { cwd: repoDir });

    const handle = await createWorktree(repoDir, "existing-branch", {
      createBranch: false,
    });

    expect(handle.createdBranch).toBe(false);
    expect(handle.branch).toBe("existing-branch");
    expect(existsSync(handle.path)).toBe(true);

    // Clean up
    execSync(`git worktree remove --force ${handle.path}`, { cwd: repoDir });
  });

  test("with custom baseBranch creates branch from specified ref", async () => {
    // Create a commit on a feature branch
    execSync("git checkout -b feature-base", { cwd: repoDir });
    execSync("git commit --allow-empty -m 'feature commit'", { cwd: repoDir });
    execSync("git checkout main", { cwd: repoDir });

    const handle = await createWorktree(repoDir, "test-from-feature", {
      baseBranch: "feature-base",
    });

    expect(handle.createdBranch).toBe(true);
    expect(existsSync(handle.path)).toBe(true);

    // The new branch should be based on feature-base (has the feature commit)
    const logOutput = execSync("git log --oneline", { cwd: handle.path }).toString();
    expect(logOutput).toContain("feature commit");

    // Clean up
    execSync(`git worktree remove --force ${handle.path}`, { cwd: repoDir });
    execSync("git branch -D test-from-feature", { cwd: repoDir });
    execSync("git branch -D feature-base", { cwd: repoDir });
  });

  test("uses main as default baseBranch", async () => {
    // Create an extra branch with a different commit
    execSync("git checkout -b other-base", { cwd: repoDir });
    execSync("git commit --allow-empty -m 'other commit'", { cwd: repoDir });
    execSync("git checkout main", { cwd: repoDir });

    const handle = await createWorktree(repoDir, "test-default-base");

    // Should be based on main, not other-base (won't have "other commit")
    const logOutput = execSync("git log --oneline", { cwd: handle.path }).toString();
    expect(logOutput).not.toContain("other commit");

    // Clean up
    execSync(`git worktree remove --force ${handle.path}`, { cwd: repoDir });
    execSync("git branch -D test-default-base", { cwd: repoDir });
    execSync("git branch -D other-base", { cwd: repoDir });
  });

  test("throws on invalid baseBranch", async () => {
    await expect(
      createWorktree(repoDir, "test-bad-base", { baseBranch: "nonexistent" }),
    ).rejects.toThrow("Failed to create worktree");
  });

  test("throws when branch already exists and createBranch=true", async () => {
    execSync("git branch duplicate-branch", { cwd: repoDir });

    await expect(
      createWorktree(repoDir, "duplicate-branch"),
    ).rejects.toThrow("Failed to create worktree");

    // Clean up
    execSync("git branch -D duplicate-branch", { cwd: repoDir });
  });
});

describe("removeWorktree", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
  });

  afterEach(() => {
    try {
      execSync("git worktree prune", { cwd: repoDir });
    } catch {}
    rmSync(repoDir, { recursive: true, force: true });
  });

  test("with createdBranch=true deletes branch", async () => {
    const handle = await createWorktree(repoDir, "test-auto-delete");

    await removeWorktree(repoDir, handle);

    // Worktree should be gone
    const wtList = execSync("git worktree list", { cwd: repoDir }).toString().trim();
    const wtLines = wtList.split("\n");
    expect(wtLines.length).toBe(1);

    // Branch should be deleted
    const branches = execSync("git branch --list test-auto-delete", { cwd: repoDir }).toString().trim();
    expect(branches).toBe("");
  });

  test("with createdBranch=false does not delete branch", async () => {
    execSync("git branch keep-branch", { cwd: repoDir });
    const handle = await createWorktree(repoDir, "keep-branch", { createBranch: false });

    await removeWorktree(repoDir, handle);

    // Worktree should be gone
    const wtList = execSync("git worktree list", { cwd: repoDir }).toString().trim();
    const wtLines = wtList.split("\n");
    expect(wtLines.length).toBe(1);

    // Branch should still exist
    const branches = execSync("git branch --list keep-branch", { cwd: repoDir }).toString().trim();
    expect(branches).toContain("keep-branch");

    // Clean up branch
    execSync("git branch -D keep-branch", { cwd: repoDir });
  });

  test("with explicit deleteBranch=true overrides createdBranch=false", async () => {
    execSync("git branch override-branch", { cwd: repoDir });
    const handle = await createWorktree(repoDir, "override-branch", { createBranch: false });

    await removeWorktree(repoDir, handle, { deleteBranch: true });

    // Branch should be deleted despite createdBranch=false
    const branches = execSync("git branch --list override-branch", { cwd: repoDir }).toString().trim();
    expect(branches).toBe("");
  });

  test("with explicit deleteBranch=false overrides createdBranch=true", async () => {
    const handle = await createWorktree(repoDir, "preserve-branch");

    await removeWorktree(repoDir, handle, { deleteBranch: false });

    // Branch should still exist
    const branches = execSync("git branch --list preserve-branch", { cwd: repoDir }).toString().trim();
    expect(branches).toContain("preserve-branch");

    // Clean up branch
    execSync("git branch -D preserve-branch", { cwd: repoDir });
  });

  test("logs warning on failure but doesn't throw", async () => {
    // Create a handle with a path that doesn't correspond to an actual worktree
    const fakeHandle: WorktreeHandle = {
      path: "/tmp/nonexistent-worktree-path-xyz",
      branch: "nonexistent-branch",
      createdBranch: true,
    };

    // Should not throw
    await expect(removeWorktree(repoDir, fakeHandle)).resolves.toBeUndefined();
  });
});
