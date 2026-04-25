import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpDir: string;

function writeConfig(content: string): string {
  const path = join(tmpDir, "config.yaml");
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agent-worker-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true });
});

describe("config — feedback and SCM sections", () => {
  const baseYaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    code_review: "Code Review"
    verification: "Verification"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
scm:
  type: github
  owner: "myorg"
  repo: "myrepo"
`;

  test("feedback defaults are applied", () => {
    const config = loadConfig(writeConfig(baseYaml));
    expect(config.feedback.comment_prefix).toBe("/agent");
    expect(config.feedback.poll_interval_seconds).toBe(120);
    expect(config.feedback.max_concurrent).toBe(1);
  });

  test("parses feedback config with custom values", () => {
    const yaml = `
${baseYaml}
feedback:
  comment_prefix: "/bot"
  poll_interval_seconds: 300
  max_concurrent: 3
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.feedback.comment_prefix).toBe("/bot");
    expect(config.feedback.poll_interval_seconds).toBe(300);
    expect(config.feedback.max_concurrent).toBe(3);
  });

  test("parses GitHub SCM config", () => {
    const config = loadConfig(writeConfig(baseYaml));
    expect(config.scm.type).toBe("github");
    if (config.scm.type === "github") {
      expect(config.scm.owner).toBe("myorg");
      expect(config.scm.repo).toBe("myrepo");
    }
  });

  test("parses BitBucket Server SCM config", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    code_review: "Code Review"
    verification: "Verification"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
scm:
  type: bitbucket_server
  base_url: "https://bb.example.com"
  project: "PROJ"
  repo: "myrepo"
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.scm.type).toBe("bitbucket_server");
    if (config.scm.type === "bitbucket_server") {
      expect(config.scm.base_url).toBe("https://bb.example.com");
      expect(config.scm.project).toBe("PROJ");
      expect(config.scm.repo).toBe("myrepo");
    }
  });

  test("parses full config with all new fields", () => {
    const yaml = `
provider:
  type: jira
  base_url: "https://jira.example.com"
  jql: "project = FOO AND status = 'Todo'"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    code_review: "Code Review"
    verification: "Verification"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
scm:
  type: github
  owner: "myorg"
  repo: "myrepo"
feedback:
  comment_prefix: "/agent"
  poll_interval_seconds: 60
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.provider.type).toBe("jira");
    expect(config.scm.type).toBe("github");
    expect(config.feedback.comment_prefix).toBe("/agent");
    expect(config.feedback.poll_interval_seconds).toBe(60);
  });
});
