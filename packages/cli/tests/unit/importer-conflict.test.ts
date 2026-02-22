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
