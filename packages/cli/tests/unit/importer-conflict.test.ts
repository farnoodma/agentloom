import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureDir,
  readJsonIfExists,
  writeTextAtomic,
} from "../../src/core/fs.js";
import { buildScopePaths } from "../../src/core/scope.js";
import type { AgentsLockFile } from "../../src/types.js";

const promptMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: promptMocks.cancel,
  isCancel: promptMocks.isCancel,
  multiselect: promptMocks.multiselect,
  select: promptMocks.select,
  text: promptMocks.text,
}));

import { importSource } from "../../src/core/importer.js";

const tempDirs: string[] = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  promptMocks.cancel.mockReset();
  promptMocks.isCancel.mockReset();
  promptMocks.isCancel.mockReturnValue(false);
  promptMocks.multiselect.mockReset();
  promptMocks.select.mockReset();
  promptMocks.text.mockReset();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("import source conflict handling", () => {
  it("prompts for agent selection and imports only selected agents", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator.md"),
      `---\nname: Issue Creator\ndescription: Create issues\n---\n\nCreate issues.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review changes\n---\n\nReview changes.\n`,
    );

    promptMocks.multiselect.mockResolvedValueOnce([
      path.join(sourceRoot, "agents", "issue-creator.md"),
    ]);

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: false,
      nonInteractive: false,
      selectionMode: "custom",
    });

    expect(promptMocks.multiselect).toHaveBeenCalledTimes(1);
    expect(promptMocks.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("space select"),
        initialValues: [
          path.join(sourceRoot, "agents", "issue-creator.md"),
          path.join(sourceRoot, "agents", "reviewer.md"),
        ],
      }),
    );
    expect(summary.importedAgents).toHaveLength(1);
    expect(summary.importedAgents[0]).toContain("issue-creator.md");

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries[0]?.requestedAgents).toEqual(["Issue Creator"]);
  });

  it("skips agent selection when --yes is set", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator.md"),
      `---\nname: issue-creator\ndescription: Create issues\n---\n\nCreate issues.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review changes\n---\n\nReview changes.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: false,
    });

    expect(promptMocks.multiselect).not.toHaveBeenCalled();
    expect(summary.importedAgents).toHaveLength(2);
  });

  it("can skip interactive selection for update-style imports", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator.md"),
      `---\nname: issue-creator\ndescription: Create issues\n---\n\nCreate issues.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review changes\n---\n\nReview changes.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      promptForAgentSelection: false,
      yes: false,
      nonInteractive: false,
    });

    expect(promptMocks.multiselect).not.toHaveBeenCalled();
    expect(summary.importedAgents).toHaveLength(2);
  });

  it("re-checks renamed filename and does not overwrite existing files silently", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nNew reviewer instructions.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(paths.agentsDir);

    writeTextAtomic(
      path.join(paths.agentsDir, "reviewer.md"),
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nExisting reviewer instructions.\n`,
    );
    writeTextAtomic(
      path.join(paths.agentsDir, "existing-name.md"),
      `---\nname: existing-name\ndescription: Existing agent\n---\n\nKeep this content.\n`,
    );

    promptMocks.select
      .mockResolvedValueOnce("rename")
      .mockResolvedValueOnce("skip");
    promptMocks.text.mockResolvedValueOnce("existing-name");

    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: false,
      nonInteractive: false,
      selectionMode: "custom",
    });

    expect(promptMocks.select).toHaveBeenCalledTimes(2);
    expect(promptMocks.text).toHaveBeenCalledTimes(1);
    expect(summary.importedAgents).toHaveLength(0);
    expect(
      fs.readFileSync(path.join(paths.agentsDir, "existing-name.md"), "utf8"),
    ).toContain("Keep this content.");
  });

  it("resolves all interactive selections before writing imported commands", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    ensureDir(path.join(sourceRoot, "skills", "release-check"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      "# /review\n\nReview changes.\n",
    );
    writeTextAtomic(
      path.join(sourceRoot, "skills", "release-check", "SKILL.md"),
      `---
name: release-check
description: Validate release readiness
---

Skill body.
`,
    );

    const skillsSelection = deferred<string[]>();
    let skillsPromptOpened = false;
    promptMocks.multiselect
      .mockResolvedValueOnce(["review.md"])
      .mockImplementationOnce(async () => {
        skillsPromptOpened = true;
        return skillsSelection.promise;
      });

    const paths = buildScopePaths(workspaceRoot, "local");
    const importPromise = importSource({
      source: sourceRoot,
      paths,
      yes: false,
      nonInteractive: false,
      selectionMode: "custom",
      importAgents: false,
      importCommands: true,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      promptForCommands: true,
      promptForSkills: true,
    });

    await waitForCondition(() => skillsPromptOpened);
    expect(fs.existsSync(path.join(paths.commandsDir, "review.md"))).toBe(
      false,
    );

    skillsSelection.resolve(["release-check"]);
    const summary = await importPromise;

    expect(summary.importedCommands).toEqual(["commands/review.md"]);
    expect(summary.importedSkills).toEqual(["release-check"]);
    expect(
      fs.existsSync(path.join(paths.skillsDir, "release-check", "SKILL.md")),
    ).toBe(true);
  });

  it("allows skipping skills during interactive import while importing other entities", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    ensureDir(path.join(sourceRoot, "skills", "release-check"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      "# /review\n\nReview changes.\n",
    );
    writeTextAtomic(
      path.join(sourceRoot, "skills", "release-check", "SKILL.md"),
      `---
name: release-check
description: Validate release readiness
---

Skill body.
`,
    );

    promptMocks.select
      .mockResolvedValueOnce("custom")
      .mockResolvedValueOnce("skip");
    promptMocks.multiselect.mockResolvedValueOnce(["review.md"]);

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: false,
      nonInteractive: false,
      importAgents: false,
      importCommands: true,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      promptForCommands: true,
      promptForSkills: true,
    });

    expect(promptMocks.select).toHaveBeenCalledTimes(2);
    expect(promptMocks.select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            value: "skip",
            label: expect.stringContaining("Skip importing"),
          }),
        ]),
      }),
    );
    expect(summary.importedCommands).toEqual(["commands/review.md"]);
    expect(summary.importedSkills).toEqual([]);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries[0]?.selectedSourceCommands).toEqual(["review.md"]);
    expect(lock?.entries[0]?.selectedSourceSkills).toEqual([]);
  });

  it("imports prompts without requiring agents for aggregate-compatible imports", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "prompts"));
    writeTextAtomic(
      path.join(sourceRoot, "prompts", "review.md"),
      `# /review\n\nReview changes.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: false,
      importCommands: true,
      importMcp: true,
      importSkills: true,
    });

    expect(summary.importedAgents).toEqual([]);
    expect(summary.importedCommands).toEqual(["commands/review.md"]);
    expect(promptMocks.multiselect).not.toHaveBeenCalled();

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries[0]?.trackedEntities).toEqual(["command"]);
  });

  it("merges command-only reimports into existing rule-bearing lock entries", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    ensureDir(path.join(sourceRoot, "rules"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      "# /review\n\nReview changes.\n",
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "deploy.md"),
      "# /deploy\n\nDeploy changes.\n",
    );
    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: true,
      importMcp: false,
      importRules: true,
      importSkills: false,
      requireCommands: true,
      requireRules: true,
      commandSelectors: ["review.md"],
    });

    const secondSummary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: true,
      importMcp: false,
      importRules: false,
      importSkills: false,
      requireCommands: true,
      commandSelectors: ["deploy.md"],
    });

    expect(secondSummary.importedCommands).toEqual(["commands/deploy.md"]);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.importedCommands).toEqual([
      "commands/review.md",
      "commands/deploy.md",
    ]);
    expect(lock?.entries[0]?.selectedSourceCommands).toEqual([
      "review.md",
      "deploy.md",
    ]);
    expect(lock?.entries[0]?.importedRules).toEqual(["rules/always-test.md"]);
  });

  it("reuses one lock entry when agent-only imports expand selectors", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator.md"),
      `---\nname: Issue Creator\ndescription: Create issues\n---\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: Reviewer\ndescription: Review changes\n---\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: true,
      importCommands: false,
      importMcp: false,
      importRules: false,
      importSkills: false,
      agents: ["Issue Creator"],
    });
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: true,
      importCommands: false,
      importMcp: false,
      importRules: false,
      importSkills: false,
      agents: ["Reviewer"],
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect([...(lock?.entries[0]?.importedAgents ?? [])].sort()).toEqual([
      "agents/issue-creator.md",
      "agents/reviewer.md",
    ]);
    expect([...(lock?.entries[0]?.requestedAgents ?? [])].sort()).toEqual([
      "Issue Creator",
      "Reviewer",
    ]);
  });

  it("preserves prior agent selectors when command and agent-only entries collapse", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator.md"),
      `---\nname: Issue Creator\ndescription: Create issues\n---\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: Reviewer\ndescription: Review changes\n---\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      "# /review\n",
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: true,
      requireCommands: true,
      importMcp: false,
      importRules: false,
      importSkills: false,
      commandSelectors: ["review"],
    });
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: true,
      importCommands: false,
      importMcp: false,
      importRules: false,
      importSkills: false,
      agents: ["Reviewer"],
    });
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: true,
      importCommands: false,
      importMcp: false,
      importRules: false,
      importSkills: false,
      agents: ["Issue Creator"],
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.importedCommands).toEqual(["commands/review.md"]);
    expect([...(lock?.entries[0]?.importedAgents ?? [])].sort()).toEqual([
      "agents/issue-creator.md",
      "agents/reviewer.md",
    ]);
    expect([...(lock?.entries[0]?.requestedAgents ?? [])].sort()).toEqual([
      "Issue Creator",
      "Reviewer",
    ]);
  });

  it("keeps non-target lockfile state when agent-only imports collapse entries", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: Reviewer\ndescription: Review changes\n---\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(path.dirname(paths.lockPath));
    writeTextAtomic(
      paths.lockPath,
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              source: sourceRoot,
              sourceType: "local",
              resolvedCommit: "old-a",
              importedAt: "2026-01-01T00:00:00.000Z",
              importedAgents: [],
              importedCommands: ["commands/review.md"],
              selectedSourceCommands: ["review.md"],
              importedMcpServers: [],
              importedRules: [],
              importedSkills: [],
              trackedEntities: ["command"],
              contentHash: "hash-a",
            },
            {
              source: sourceRoot,
              sourceType: "local",
              resolvedCommit: "old-b",
              importedAt: "2026-01-02T00:00:00.000Z",
              importedAgents: [],
              importedCommands: [],
              importedMcpServers: ["alpha"],
              selectedSourceMcpServers: ["alpha"],
              importedRules: [],
              importedSkills: [],
              trackedEntities: ["mcp"],
              contentHash: "hash-b",
            },
          ],
        } satisfies AgentsLockFile,
        null,
        2,
      ),
    );

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: true,
      importCommands: false,
      importMcp: false,
      importRules: false,
      importSkills: false,
      agents: ["Reviewer"],
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(2);
    expect(
      lock?.entries.some(
        (entry) =>
          entry.importedCommands.includes("commands/review.md") &&
          (entry.selectedSourceCommands ?? []).includes("review.md"),
      ),
    ).toBe(true);
    expect(
      lock?.entries.some(
        (entry) =>
          entry.importedMcpServers.includes("alpha") &&
          (entry.selectedSourceMcpServers ?? []).includes("alpha"),
      ),
    ).toBe(true);
    expect(
      [
        ...(lock?.entries.flatMap((entry) => entry.importedAgents) ?? []),
      ].sort(),
    ).toEqual(["agents/reviewer.md"]);
  });

  it("reuses one lock entry when mcp-only imports expand selectors", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    writeTextAtomic(
      path.join(sourceRoot, "mcp.json"),
      JSON.stringify(
        {
          version: 1,
          mcpServers: {
            alpha: {
              command: "node",
              args: ["alpha"],
            },
            beta: {
              command: "node",
              args: ["beta"],
            },
          },
        },
        null,
        2,
      ),
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: true,
      requireMcp: true,
      importRules: false,
      importSkills: false,
      mcpSelectors: ["alpha"],
      promptForMcp: false,
    });
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: true,
      requireMcp: true,
      importRules: false,
      importSkills: false,
      mcpSelectors: ["beta"],
      promptForMcp: false,
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect([...(lock?.entries[0]?.importedMcpServers ?? [])].sort()).toEqual([
      "alpha",
      "beta",
    ]);
    expect(
      [...(lock?.entries[0]?.selectedSourceMcpServers ?? [])].sort(),
    ).toEqual(["alpha", "beta"]);
  });

  it("reuses one lock entry when rule-only imports expand selectors", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "rules"));
    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---\nname: Always Test\n---\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "rules", "never-force.md"),
      `---\nname: Never Force Push\n---\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importRules: true,
      requireRules: true,
      importSkills: false,
      ruleSelectors: ["always-test"],
      promptForRules: false,
    });
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importRules: true,
      requireRules: true,
      importSkills: false,
      ruleSelectors: ["never-force"],
      promptForRules: false,
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect([...(lock?.entries[0]?.importedRules ?? [])].sort()).toEqual([
      "rules/always-test.md",
      "rules/never-force.md",
    ]);
    expect([...(lock?.entries[0]?.selectedSourceRules ?? [])].sort()).toEqual([
      "always-test.md",
      "never-force.md",
    ]);
  });

  it("replaces removed agents on all-mode agent-only reimport", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator.md"),
      `---\nname: Issue Creator\ndescription: Create issues\n---\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: Reviewer\ndescription: Review changes\n---\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: true,
      importCommands: false,
      importMcp: false,
      importRules: false,
      importSkills: false,
    });

    fs.rmSync(path.join(sourceRoot, "agents", "issue-creator.md"));

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: true,
      importCommands: false,
      importMcp: false,
      importRules: false,
      importSkills: false,
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.importedAgents).toEqual(["agents/reviewer.md"]);
  });

  it("replaces removed MCP servers on all-mode mcp-only reimport", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    writeTextAtomic(
      path.join(sourceRoot, "mcp.json"),
      JSON.stringify(
        {
          version: 1,
          mcpServers: {
            alpha: {
              command: "node",
              args: ["alpha"],
            },
            beta: {
              command: "node",
              args: ["beta"],
            },
          },
        },
        null,
        2,
      ),
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: true,
      requireMcp: true,
      importRules: false,
      importSkills: false,
    });

    writeTextAtomic(
      path.join(sourceRoot, "mcp.json"),
      JSON.stringify(
        {
          version: 1,
          mcpServers: {
            alpha: {
              command: "node",
              args: ["alpha"],
            },
          },
        },
        null,
        2,
      ),
    );

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: true,
      requireMcp: true,
      importRules: false,
      importSkills: false,
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.importedMcpServers).toEqual(["alpha"]);
  });

  it("replaces removed rules on all-mode rule-only reimport", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "rules"));
    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---\nname: Always Test\n---\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "rules", "never-force.md"),
      `---\nname: Never Force Push\n---\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importRules: true,
      requireRules: true,
      importSkills: false,
    });

    fs.rmSync(path.join(sourceRoot, "rules", "never-force.md"));

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importRules: true,
      requireRules: true,
      importSkills: false,
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.importedRules).toEqual(["rules/always-test.md"]);
  });

  it("replaces removed skills on all-mode skill-only reimport", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "react-best-practices"));
    ensureDir(path.join(sourceRoot, "skills", "composition-patterns"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "react-best-practices", "SKILL.md"),
      "# react\n",
    );
    writeTextAtomic(
      path.join(sourceRoot, "skills", "composition-patterns", "SKILL.md"),
      "# composition\n",
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
    });

    fs.rmSync(path.join(sourceRoot, "skills", "composition-patterns"), {
      recursive: true,
      force: true,
    });

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.importedSkills).toEqual(["react-best-practices"]);
  });

  it("throws a single actionable error when aggregate imports find no entities", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    const paths = buildScopePaths(workspaceRoot, "local");
    await expect(
      importSource({
        source: sourceRoot,
        paths,
        yes: true,
        nonInteractive: true,
        importAgents: true,
        requireAgents: false,
        importCommands: true,
        importMcp: true,
        importSkills: true,
      }),
    ).rejects.toThrow("No importable entities found");
  });

  it("includes the original source input in aggregate no-entities errors", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    const subdir = "empty-subdir";
    ensureDir(path.join(sourceRoot, subdir));

    const paths = buildScopePaths(workspaceRoot, "local");
    await expect(
      importSource({
        source: sourceRoot,
        subdir,
        paths,
        yes: true,
        nonInteractive: true,
        importAgents: true,
        requireAgents: false,
        importCommands: true,
        importMcp: true,
        importSkills: true,
      }),
    ).rejects.toThrow(`source "${sourceRoot} (subdir: ${subdir})"`);
  });

  it("recognizes root SKILL.md sources and imports selected skills natively", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    writeTextAtomic(
      path.join(sourceRoot, "SKILL.md"),
      `---
name: visual-explainer
description: Explain visuals
---

Skill body.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      skillSelectors: ["visual-explainer"],
    });

    expect(summary.importedSkills).toEqual(["visual-explainer"]);
    expect(
      fs.existsSync(path.join(paths.skillsDir, "visual-explainer", "SKILL.md")),
    ).toBe(true);
  });

  it("imports skills from plugin marketplace sources without requiring --subdir", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, ".claude-plugin"));
    ensureDir(
      path.join(sourceRoot, "plugins", "railway", "skills", "use-railway"),
    );
    ensureDir(
      path.join(sourceRoot, "plugins", "railway", "skills", "changelog"),
    );
    writeTextAtomic(
      path.join(sourceRoot, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        plugins: [{ source: "./plugins/railway" }],
      }),
    );
    writeTextAtomic(
      path.join(
        sourceRoot,
        "plugins",
        "railway",
        "skills",
        "use-railway",
        "SKILL.md",
      ),
      `---
name: use-railway
---
`,
    );
    writeTextAtomic(
      path.join(
        sourceRoot,
        "plugins",
        "railway",
        "skills",
        "changelog",
        "SKILL.md",
      ),
      `---
name: changelog
---
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
    });

    expect(summary.importedSkills).toEqual(["changelog", "use-railway"]);
    expect(
      fs.existsSync(path.join(paths.skillsDir, "use-railway", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(paths.skillsDir, "changelog", "SKILL.md")),
    ).toBe(true);
  });

  it("fails fast when plugin sources define colliding skill names", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, ".claude-plugin"));
    ensureDir(path.join(sourceRoot, "plugins", "alpha", "skills", "first"));
    ensureDir(path.join(sourceRoot, "plugins", "beta", "skills", "second"));
    writeTextAtomic(
      path.join(sourceRoot, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        plugins: [{ source: "./plugins/alpha" }, { source: "./plugins/beta" }],
      }),
    );
    writeTextAtomic(
      path.join(sourceRoot, "plugins", "alpha", "skills", "first", "SKILL.md"),
      `---
name: shared-skill
---
`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "plugins", "beta", "skills", "second", "SKILL.md"),
      `---
name: shared-skill
---
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await expect(
      importSource({
        source: sourceRoot,
        paths,
        yes: true,
        nonInteractive: true,
        importAgents: false,
        importCommands: false,
        importMcp: false,
        importSkills: true,
        requireSkills: true,
      }),
    ).rejects.toThrow('Conflicting skill "shared-skill"');
  });

  it("fails fast when a single source defines duplicate canonical skill names", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "first"));
    ensureDir(path.join(sourceRoot, "skills", "second"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "first", "SKILL.md"),
      `---
name: shared-skill
---

first
`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "skills", "second", "SKILL.md"),
      `---
name: shared-skill
---

second
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await expect(
      importSource({
        source: sourceRoot,
        paths,
        yes: true,
        nonInteractive: true,
        importAgents: false,
        importCommands: false,
        importMcp: false,
        importSkills: true,
        requireSkills: true,
      }),
    ).rejects.toThrow('Conflicting skill "shared-skill"');
  });

  it("preserves explicit skill selectors while importing canonical target directories", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "react-best-practices"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "react-best-practices", "SKILL.md"),
      `---
name: vercel-react-best-practices
---

Skill body.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(path.join(paths.skillsDir, "react-best-practices"));
    writeTextAtomic(
      path.join(paths.skillsDir, "react-best-practices", "SKILL.md"),
      "# legacy\n",
    );

    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      skillSelectors: ["react-best-practices"],
      skillRenameMap: {
        "react-best-practices": "react-best-practices",
      },
    });

    expect(summary.importedSkills).toEqual(["vercel-react-best-practices"]);
    expect(
      fs.existsSync(
        path.join(paths.skillsDir, "vercel-react-best-practices", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(paths.skillsDir, "react-best-practices")),
    ).toBe(false);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries[0]?.selectedSourceSkills).toEqual([
      "react-best-practices",
    ]);
    expect(lock?.entries[0]?.skillRenameMap).toEqual({
      "vercel-react-best-practices": "vercel-react-best-practices",
    });
  });

  it("updates legacy skill lock entries instead of appending duplicates", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "react-best-practices"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "react-best-practices", "SKILL.md"),
      `---
name: vercel-react-best-practices
---

Skill body.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(path.dirname(paths.lockPath));
    writeTextAtomic(
      paths.lockPath,
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              source: sourceRoot,
              sourceType: "local",
              resolvedCommit: "old",
              importedAt: "2026-01-01T00:00:00.000Z",
              importedAgents: [],
              importedCommands: [],
              importedMcpServers: [],
              importedRules: [],
              importedSkills: ["react-best-practices"],
              selectedSourceSkills: ["react-best-practices"],
              trackedEntities: ["skill"],
              contentHash: "hash",
            },
          ],
        } satisfies AgentsLockFile,
        null,
        2,
      ),
    );

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      skillSelectors: ["react-best-practices"],
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.importedSkills).toEqual([
      "vercel-react-best-practices",
    ]);
    expect(lock?.entries[0]?.selectedSourceSkills).toEqual([
      "react-best-practices",
    ]);
  });

  it("reuses one lock entry when skill-only imports expand selected skills", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "react-best-practices"));
    ensureDir(path.join(sourceRoot, "skills", "composition-patterns"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "react-best-practices", "SKILL.md"),
      `---
name: vercel-react-best-practices
---

React skill.
`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "skills", "composition-patterns", "SKILL.md"),
      `---
name: vercel-composition-patterns
---

Composition skill.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      skillSelectors: ["vercel-react-best-practices"],
    });
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      skillSelectors: [
        "vercel-react-best-practices",
        "vercel-composition-patterns",
      ],
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect([...(lock?.entries[0]?.importedSkills ?? [])].sort()).toEqual([
      "vercel-composition-patterns",
      "vercel-react-best-practices",
    ]);
    expect([...(lock?.entries[0]?.selectedSourceSkills ?? []).sort()]).toEqual([
      "vercel-composition-patterns",
      "vercel-react-best-practices",
    ]);
  });

  it("collapses duplicate skill-only lock entries for the same source", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "react-best-practices"));
    ensureDir(path.join(sourceRoot, "skills", "composition-patterns"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "react-best-practices", "SKILL.md"),
      "# react\n",
    );
    writeTextAtomic(
      path.join(sourceRoot, "skills", "composition-patterns", "SKILL.md"),
      "# composition\n",
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(path.dirname(paths.lockPath));
    writeTextAtomic(
      paths.lockPath,
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              source: sourceRoot,
              sourceType: "local",
              resolvedCommit: "old-a",
              importedAt: "2026-01-01T00:00:00.000Z",
              importedAgents: [],
              importedCommands: [],
              importedMcpServers: [],
              importedRules: [],
              importedSkills: ["react-best-practices"],
              selectedSourceSkills: ["react-best-practices"],
              skillRenameMap: {
                "react-best-practices": "react-best-practices",
              },
              trackedEntities: ["skill"],
              contentHash: "hash-a",
            },
            {
              source: sourceRoot,
              sourceType: "local",
              resolvedCommit: "old-b",
              importedAt: "2026-01-02T00:00:00.000Z",
              importedAgents: [],
              importedCommands: [],
              importedMcpServers: [],
              importedRules: [],
              importedSkills: ["composition-patterns"],
              selectedSourceSkills: ["composition-patterns"],
              skillRenameMap: {
                "composition-patterns": "composition-patterns",
              },
              trackedEntities: ["skill"],
              contentHash: "hash-b",
            },
          ],
        } satisfies AgentsLockFile,
        null,
        2,
      ),
    );

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      skillSelectors: ["react-best-practices", "composition-patterns"],
    });

    const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
    expect(lock?.entries).toHaveLength(1);
    expect([...(lock?.entries[0]?.importedSkills ?? [])].sort()).toEqual([
      "composition-patterns",
      "react-best-practices",
    ]);
  });

  it("preserves legacy skill directories when canonical import conflicts", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "react-best-practices"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "react-best-practices", "SKILL.md"),
      `---
name: vercel-react-best-practices
---

Source content.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(path.join(paths.skillsDir, "react-best-practices"));
    ensureDir(path.join(paths.skillsDir, "vercel-react-best-practices"));
    writeTextAtomic(
      path.join(paths.skillsDir, "react-best-practices", "note.txt"),
      "legacy content",
    );
    writeTextAtomic(
      path.join(paths.skillsDir, "vercel-react-best-practices", "SKILL.md"),
      "# existing canonical\n",
    );

    await expect(
      importSource({
        source: sourceRoot,
        paths,
        yes: false,
        nonInteractive: true,
        importAgents: false,
        importCommands: false,
        importMcp: false,
        importSkills: true,
        requireSkills: true,
      }),
    ).rejects.toThrow('Conflict for skill "vercel-react-best-practices"');

    expect(
      fs.existsSync(path.join(paths.skillsDir, "react-best-practices")),
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(paths.skillsDir, "react-best-practices", "note.txt"),
        "utf8",
      ),
    ).toBe("legacy content");
  });

  it("does not rename legacy skill directories before resolving conflicts", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "react-best-practices"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "react-best-practices", "SKILL.md"),
      `---
name: vercel-react-best-practices
---

Source content.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(path.join(paths.skillsDir, "react-best-practices"));
    writeTextAtomic(
      path.join(paths.skillsDir, "react-best-practices", "SKILL.md"),
      "# legacy content\n",
    );

    await expect(
      importSource({
        source: sourceRoot,
        paths,
        yes: false,
        nonInteractive: true,
        importAgents: false,
        importCommands: false,
        importMcp: false,
        importSkills: true,
        requireSkills: true,
      }),
    ).rejects.toThrow('Conflict for skill "vercel-react-best-practices"');

    expect(
      fs.existsSync(
        path.join(paths.skillsDir, "react-best-practices", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(paths.skillsDir, "vercel-react-best-practices", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("applies skill rename selectors to canonical matches before aliases", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "alpha"));
    ensureDir(path.join(sourceRoot, "skills", "foo"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "alpha", "SKILL.md"),
      `---
name: foo
---

Canonical foo.
`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "skills", "foo", "SKILL.md"),
      `---
name: bar
---

Alias foo.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      skillRenameMap: {
        foo: "primary-foo",
      },
    });

    expect(summary.importedSkills).toEqual(["bar", "primary-foo"]);
    expect(
      fs.existsSync(path.join(paths.skillsDir, "primary-foo", "SKILL.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(paths.skillsDir, "bar", "SKILL.md"))).toBe(
      true,
    );
  });

  it("supports single-skill --rename and replays the persisted rename map", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "release-check"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "release-check", "SKILL.md"),
      "# release-check v1\n",
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      rename: "release-gate",
    });

    expect(summary.importedSkills).toEqual(["release-gate"]);
    expect(summary.telemetrySkills).toEqual([
      {
        name: "release-check",
        filePath: "skills/release-check/SKILL.md",
      },
    ]);
    expect(
      fs.existsSync(path.join(paths.skillsDir, "release-gate", "SKILL.md")),
    ).toBe(true);

    const lockAfterFirstImport = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lockAfterFirstImport?.entries[0]?.skillRenameMap).toEqual({
      "release-check": "release-gate",
    });

    writeTextAtomic(
      path.join(sourceRoot, "skills", "release-check", "SKILL.md"),
      "# release-check v2\n",
    );

    const replaySummary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      skillSelectors: ["release-check"],
      skillRenameMap: lockAfterFirstImport?.entries[0]?.skillRenameMap,
    });

    expect(replaySummary.importedSkills).toEqual(["release-gate"]);
    expect(replaySummary.telemetrySkills).toEqual([
      {
        name: "release-check",
        filePath: "skills/release-check/SKILL.md",
      },
    ]);
    expect(
      fs.readFileSync(
        path.join(paths.skillsDir, "release-gate", "SKILL.md"),
        "utf8",
      ),
    ).toContain("v2");
  });

  it("supports single-rule --rename and replays the persisted rename map", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "rules"));
    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importRules: true,
      requireRules: true,
      rename: "always-run-tests",
    });

    expect(summary.importedRules).toEqual(["rules/always-run-tests.md"]);
    expect(
      fs.existsSync(path.join(paths.rulesDir, "always-run-tests.md")),
    ).toBe(true);

    const lockAfterFirstImport = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lockAfterFirstImport?.entries[0]?.ruleRenameMap).toEqual({
      "always-test": "always-run-tests.md",
    });

    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---
name: Always Test
---

Run tests before merge and before release.
`,
    );

    const replaySummary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importRules: true,
      requireRules: true,
      ruleSelectors: ["always-test"],
      ruleRenameMap: lockAfterFirstImport?.entries[0]?.ruleRenameMap,
    });

    expect(replaySummary.importedRules).toEqual(["rules/always-run-tests.md"]);
    expect(
      fs.readFileSync(path.join(paths.rulesDir, "always-run-tests.md"), "utf8"),
    ).toContain("before release");
  });

  it("does not apply rule --rename during aggregate imports that also include skills", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "rules"));
    ensureDir(path.join(sourceRoot, "skills", "release-check"));
    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "skills", "release-check", "SKILL.md"),
      `---
name: release-check
description: Validate release readiness
---

Skill body.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: true,
      requireAgents: false,
      importCommands: true,
      requireCommands: false,
      importMcp: true,
      requireMcp: false,
      importRules: true,
      requireRules: false,
      importSkills: true,
      requireSkills: false,
      rename: "team-rules",
    });

    expect(summary.importedRules).toEqual(["rules/always-test.md"]);
    expect(summary.importedSkills).toEqual(["release-check"]);
    expect(fs.existsSync(path.join(paths.rulesDir, "always-test.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(paths.rulesDir, "team-rules.md"))).toBe(
      false,
    );
  });

  it("resolves skills providers and stores provider side-effect metadata", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "skills", "release-check"));
    writeTextAtomic(
      path.join(sourceRoot, "skills", "release-check", "SKILL.md"),
      `---
name: release-check
description: Validate release readiness
---

Skill body.
`,
    );

    const resolveSkillsProviders = vi.fn(async () => ["codex", "claude"]);
    const paths = buildScopePaths(workspaceRoot, "local");
    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importSkills: true,
      requireSkills: true,
      resolveSkillsProviders,
    });

    expect(summary.importedSkills).toEqual(["release-check"]);
    expect(resolveSkillsProviders).toHaveBeenCalledTimes(1);
    expect(
      fs
        .lstatSync(path.join(workspaceRoot, ".claude", "skills"))
        .isSymbolicLink(),
    ).toBe(true);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries[0]?.skillsProviders).toEqual(["codex", "claude"]);
    expect(lock?.entries[0]?.skillRenameMap).toEqual({
      "release-check": "release-check",
    });
  });
});
