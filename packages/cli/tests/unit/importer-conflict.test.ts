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

const skillMocks = vi.hoisted(() => ({
  runSkillsCommand: vi.fn(() => ({ status: 0 })),
}));

vi.mock("@clack/prompts", () => ({
  cancel: promptMocks.cancel,
  isCancel: promptMocks.isCancel,
  multiselect: promptMocks.multiselect,
  select: promptMocks.select,
  text: promptMocks.text,
}));

vi.mock("../../src/core/skills.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/skills.js")
  >("../../src/core/skills.js");

  return {
    ...actual,
    runSkillsCommand: skillMocks.runSkillsCommand,
  };
});

import { importSource } from "../../src/core/importer.js";

const tempDirs: string[] = [];

beforeEach(() => {
  promptMocks.cancel.mockReset();
  promptMocks.isCancel.mockReset();
  promptMocks.isCancel.mockReturnValue(false);
  promptMocks.multiselect.mockReset();
  promptMocks.select.mockReset();
  promptMocks.text.mockReset();
  skillMocks.runSkillsCommand.mockReset();
  skillMocks.runSkillsCommand.mockReturnValue({ status: 0 });
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

  it("recognizes root SKILL.md sources and forwards selected skills to the skills command", async () => {
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
    expect(skillMocks.runSkillsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["add", sourceRoot, "--yes", "--skill", "visual-explainer"],
        cwd: workspaceRoot,
      }),
    );
  });
});
