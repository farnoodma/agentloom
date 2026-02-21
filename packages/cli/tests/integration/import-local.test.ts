import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAddCommand } from "../../src/commands/add.js";
import { parseArgs } from "../../src/core/argv.js";
import {
  ensureDir,
  readJsonIfExists,
  writeTextAtomic,
  writeJsonAtomic,
} from "../../src/core/fs.js";
import { buildScopePaths } from "../../src/core/scope.js";
import { importSource } from "../../src/core/importer.js";
import type { AgentsLockFile } from "../../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("importSource local", () => {
  it("imports agents and mcp and writes lock entry", async () => {
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
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nReview code changes.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "ship.md"),
      `# /ship\n\nRun release checks and ship changes.\n`,
    );

    writeJsonAtomic(path.join(sourceRoot, "mcp.json"), {
      version: 1,
      mcpServers: {
        browser: {
          base: {
            command: "npx",
            args: ["browser-tools"],
          },
        },
      },
    });

    const paths = buildScopePaths(workspaceRoot, "local");

    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
    });

    expect(summary.importedAgents).toHaveLength(1);
    expect(summary.importedCommands).toHaveLength(1);
    expect(summary.importedMcpServers).toContain("browser");

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "ship.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".agents", "mcp.json"))).toBe(
      true,
    );

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.sourceType).toBe("local");
    expect(lock?.entries[0]?.importedCommands).toEqual(["commands/ship.md"]);
  });

  it("aggregate add imports prompts-only repositories without tracking agents", async () => {
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
      `# /review\n\nReview code changes.\n`,
    );

    await runAddCommand(
      parseArgs(["add", sourceRoot, "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      ),
    ).toBe(false);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.trackedEntities).toEqual(["command"]);
    expect(lock?.entries[0]?.importedCommands).toEqual(["commands/review.md"]);
    expect(lock?.entries[0]?.importedAgents).toEqual([]);
  });

  it("applies --rename for single-agent imports even when commands are present", async () => {
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
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nReview code changes.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "ship.md"),
      `# /ship\n\nRun release checks and ship changes.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    const summary = await importSource({
      source: sourceRoot,
      paths,
      rename: "quality-gate",
      yes: true,
      nonInteractive: true,
    });

    expect(summary.importedAgents).toEqual(["agents/quality-gate.md"]);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "quality-gate.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      ),
    ).toBe(false);
  });

  it("imports only selected agents when --agent is provided", async () => {
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
      `---\nname: issue-creator\ndescription: Create issue breakdowns\n---\n\nCreate issues.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review code\n---\n\nReview code.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    const summary = await importSource({
      source: sourceRoot,
      agents: ["issue-creator"],
      paths,
      yes: true,
      nonInteractive: true,
    });

    expect(summary.importedAgents).toHaveLength(1);
    expect(summary.importedAgents[0]).toContain("issue-creator.md");
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "issue-creator.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      ),
    ).toBe(false);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(
      lock?.entries.some((entry) =>
        entry.requestedAgents?.includes("issue-creator"),
      ),
    ).toBe(true);
  });

  it("keeps separate lock entries for different --agent subsets", async () => {
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
      `---\nname: issue-creator\ndescription: Create issue breakdowns\n---\n\nCreate issues.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review code\n---\n\nReview code.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      agents: ["issue-creator"],
      paths,
      yes: true,
      nonInteractive: true,
    });
    await importSource({
      source: sourceRoot,
      agents: ["reviewer"],
      paths,
      yes: true,
      nonInteractive: true,
    });

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    const entriesForSource =
      lock?.entries.filter((entry) => entry.source === sourceRoot) ?? [];
    expect(entriesForSource).toHaveLength(2);
    expect(
      entriesForSource
        .map((entry) => entry.requestedAgents?.[0])
        .filter((entry): entry is string => typeof entry === "string")
        .sort(),
    ).toEqual(["issue-creator", "reviewer"]);
  });

  it("persists explicit --agent filters for future updates", async () => {
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
      `---\nname: issue-creator\ndescription: Create issue breakdowns\n---\n\nCreate issues.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review code\n---\n\nReview code.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      agents: ["issue-creator", "reviewer"],
      paths,
      yes: true,
      nonInteractive: true,
    });

    const lockAfterInitialImport = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );

    const matchingEntry = lockAfterInitialImport?.entries.find(
      (entry) => entry.source === sourceRoot,
    );
    expect(matchingEntry?.requestedAgents).toEqual([
      "issue-creator",
      "reviewer",
    ]);

    writeTextAtomic(
      path.join(sourceRoot, "agents", "new-agent.md"),
      `---\nname: new-agent\ndescription: New upstream agent\n---\n\nNew upstream content.\n`,
    );

    await importSource({
      source: sourceRoot,
      agents: matchingEntry?.requestedAgents,
      paths,
      yes: true,
      nonInteractive: true,
    });

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "new-agent.md"),
      ),
    ).toBe(false);
  });

  it("prefers exact --agent matches over slug fallback collisions", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue creator.md"),
      `---\nname: issue creator\ndescription: Spaced agent\n---\n\nSelected exact-match content.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator.md"),
      `---\nname: issue-creator\ndescription: Hyphen agent\n---\n\nDifferent content.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    const summary = await importSource({
      source: sourceRoot,
      agents: ["issue creator"],
      paths,
      yes: true,
      nonInteractive: true,
    });

    expect(summary.importedAgents).toHaveLength(1);
    const importedPath = path.join(paths.agentsDir, "issue-creator.md");
    expect(fs.readFileSync(importedPath, "utf8")).toContain(
      "Selected exact-match content.",
    );
  });

  it("stores resolved agent names so updates do not drift after new exact matches appear", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue creator.md"),
      `---\nname: issue creator\ndescription: Spaced agent\n---\n\nOriginal selected content.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    await importSource({
      source: sourceRoot,
      agents: ["issue-creator"],
      paths,
      yes: true,
      nonInteractive: true,
    });

    const lockAfterFirstImport = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    const entry = lockAfterFirstImport?.entries.find(
      (item) => item.source === sourceRoot,
    );
    expect(entry?.requestedAgents).toEqual(["issue creator"]);

    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator.md"),
      `---\nname: issue-creator\ndescription: Hyphen agent\n---\n\nNew exact-match candidate.\n`,
    );

    await importSource({
      source: sourceRoot,
      agents: entry?.requestedAgents,
      paths,
      yes: true,
      nonInteractive: true,
    });

    const importedPath = path.join(paths.agentsDir, "issue-creator.md");
    expect(fs.readFileSync(importedPath, "utf8")).toContain(
      "Original selected content.",
    );
    expect(fs.readFileSync(importedPath, "utf8")).not.toContain(
      "New exact-match candidate.",
    );
  });

  it("stores unambiguous lock selectors when multiple source agents share a name", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator-a.md"),
      `---\nname: issue creator\ndescription: First variant\n---\n\nFirst content.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "agents", "issue-creator-b.md"),
      `---\nname: issue creator\ndescription: Second variant\n---\n\nSecond content.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    await importSource({
      source: sourceRoot,
      agents: ["issue-creator-a"],
      paths,
      yes: true,
      nonInteractive: true,
    });

    const lockAfterFirstImport = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    const entry = lockAfterFirstImport?.entries.find(
      (item) => item.source === sourceRoot,
    );
    expect(entry?.requestedAgents).toEqual(["issue-creator-a"]);

    await expect(
      importSource({
        source: sourceRoot,
        agents: entry?.requestedAgents,
        paths,
        yes: true,
        nonInteractive: true,
      }),
    ).resolves.not.toThrow();

    const importedPath = path.join(paths.agentsDir, "issue-creator.md");
    expect(fs.readFileSync(importedPath, "utf8")).toContain("First content.");
    expect(fs.readFileSync(importedPath, "utf8")).not.toContain(
      "Second content.",
    );
  });

  it("throws an actionable error when --agent does not match source agents", async () => {
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
      `---\nname: reviewer\ndescription: Review code\n---\n\nReview code.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    await expect(
      importSource({
        source: sourceRoot,
        agents: ["issue-creator"],
        paths,
        yes: true,
        nonInteractive: true,
      }),
    ).rejects.toThrow("Requested agent(s) not found: issue-creator.");
  });
});
