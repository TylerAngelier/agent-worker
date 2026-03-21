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

describe("loadConfig", () => {
  const validLinearYaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
`;

  test("parses valid linear config with defaults", () => {
    const config = loadConfig(writeConfig(validLinearYaml));

    expect(config.provider.type).toBe("linear");
    expect(config.provider.project_id).toBe("proj-123");
    expect(config.provider.poll_interval_seconds).toBe(60);
    expect(config.provider.statuses.ready).toBe("Todo");
    expect(config.repo.path).toBe("/tmp/repo");
    expect(config.hooks.pre).toEqual([]);
    expect(config.hooks.post).toEqual([]);
    expect(config.executor.type).toBe("claude");
    expect(config.executor.timeout_seconds).toBe(300);
    expect(config.executor.retries).toBe(0);
    expect(config.log.level).toBe("info");
  });

  test("parses linear config with all fields set", () => {
    const fullYaml = `
provider:
  type: linear
  project_id: "proj-456"
  poll_interval_seconds: 30
  statuses:
    ready: "Ready"
    in_progress: "Working"
    done: "Complete"
    failed: "Failed"
repo:
  path: "/home/user/project"
hooks:
  pre:
    - "git pull"
    - "git checkout -b feature"
  post:
    - "npm test"
executor:
  type: claude
  timeout_seconds: 600
  retries: 2
log:
  file: "./test.log"
`;
    const config = loadConfig(writeConfig(fullYaml));

    expect(config.provider.poll_interval_seconds).toBe(30);
    expect(config.hooks.pre).toEqual(["git pull", "git checkout -b feature"]);
    expect(config.hooks.post).toEqual(["npm test"]);
    expect(config.executor.type).toBe("claude");
    expect(config.executor.timeout_seconds).toBe(600);
    expect(config.executor.retries).toBe(2);
    expect(config.log.file).toBe("./test.log");
  });

  test("parses jira config", () => {
    const yaml = `
provider:
  type: jira
  base_url: "https://jira.example.com"
  poll_interval_seconds: 45
  jql: "project = FOO AND status = 'Todo'"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.provider.type).toBe("jira");
    expect(config.provider.base_url).toBe("https://jira.example.com");
    expect(config.provider.jql).toBe("project = FOO AND status = 'Todo'");
    expect(config.provider.poll_interval_seconds).toBe(45);
  });

  test("parses plane config", () => {
    const yaml = `
provider:
  type: plane
  base_url: "https://plane.example.com"
  workspace_slug: "my-workspace"
  project_id: "proj-uuid"
  query: "state_group: backlog"
  statuses:
    ready: "Backlog"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.provider.type).toBe("plane");
    expect(config.provider.base_url).toBe("https://plane.example.com");
    expect(config.provider.workspace_slug).toBe("my-workspace");
    expect(config.provider.project_id).toBe("proj-uuid");
    expect(config.provider.query).toBe("state_group: backlog");
  });

  test("parses opencode executor", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
executor:
  type: opencode
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.executor.type).toBe("opencode");
  });

  test("parses pi executor", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
executor:
  type: pi
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.executor.type).toBe("pi");
  });

  test("backward compat: maps old linear: key to provider", () => {
    const yaml = `
linear:
  project_id: "proj-123"
  poll_interval_seconds: 30
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.provider.type).toBe("linear");
    expect(config.provider.project_id).toBe("proj-123");
    expect(config.provider.poll_interval_seconds).toBe(30);
  });

  test("backward compat: maps claude key to executor", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
claude:
  timeout_seconds: 600
  retries: 2
`;
    const config = loadConfig(writeConfig(yaml));
    expect(config.executor.type).toBe("claude");
    expect(config.executor.timeout_seconds).toBe(600);
    expect(config.executor.retries).toBe(2);
  });

  test("throws on missing project_id for linear", () => {
    const yaml = `
provider:
  type: linear
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
`;
    expect(() => loadConfig(writeConfig(yaml))).toThrow();
  });

  test("throws on missing statuses", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
repo:
  path: "/tmp/repo"
`;
    expect(() => loadConfig(writeConfig(yaml))).toThrow();
  });

  test("throws on missing repo path", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
`;
    expect(() => loadConfig(writeConfig(yaml))).toThrow();
  });

  test("rejects retries greater than 3", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
executor:
  retries: 5
`;
    expect(() => loadConfig(writeConfig(yaml))).toThrow();
  });

  test("rejects negative poll interval", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
  poll_interval_seconds: -1
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
`;
    expect(() => loadConfig(writeConfig(yaml))).toThrow();
  });

  test("rejects invalid executor type", () => {
    const yaml = `
provider:
  type: linear
  project_id: "proj-123"
  statuses:
    ready: "Todo"
    in_progress: "In Progress"
    done: "Done"
    failed: "Canceled"
repo:
  path: "/tmp/repo"
executor:
  type: invalid
`;
    expect(() => loadConfig(writeConfig(yaml))).toThrow();
  });

  test("rejects invalid provider type", () => {
    const yaml = `
provider:
  type: github
repo:
  path: "/tmp/repo"
`;
    expect(() => loadConfig(writeConfig(yaml))).toThrow();
  });
});
