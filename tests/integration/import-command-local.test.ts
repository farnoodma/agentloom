import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommandCommand } from "../../src/commands/command.js";
import { runUpdateCommand } from "../../src/commands/update.js";
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

describe("importSource command-only local", () => {
  it("imports commands and writes command-only lock entries", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nReview the active pull request.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: true,
      requireCommands: true,
      importMcp: false,
    });

    expect(summary.importedAgents).toHaveLength(0);
    expect(summary.importedCommands).toEqual(["commands/review.md"]);
    expect(summary.importedMcpServers).toHaveLength(0);

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(true);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.importedAgents).toEqual([]);
    expect(lock?.entries[0]?.importedCommands).toEqual(["commands/review.md"]);
  });

  it("imports only selected commands when commandSelectors are provided", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nReview the active pull request.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "ship.md"),
      `# /ship\n\nShip active changes.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: true,
      requireCommands: true,
      importMcp: false,
      commandSelectors: ["review"],
    });

    expect(summary.importedCommands).toEqual(["commands/review.md"]);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "ship.md")),
    ).toBe(false);
  });

  it("throws an actionable error when requested command selectors are missing", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nReview the active pull request.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local");

    await expect(
      importSource({
        source: sourceRoot,
        paths,
        yes: true,
        nonInteractive: true,
        importAgents: false,
        importCommands: true,
        requireCommands: true,
        importMcp: false,
        commandSelectors: ["ship"],
      }),
    ).rejects.toThrow("Command(s) not found in source: ship");
  });

  it("preserves command selectors during update for command-only entries", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nReview the active pull request.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "ship.md"),
      `# /ship\n\nShip active changes.\n`,
    );
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

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
      commandSelectors: ["review"],
    });

    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nReview the active pull request.\n\nUpdated content.\n`,
    );
    commitAll(sourceRoot, "update-review");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "ship.md")),
    ).toBe(false);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries[0]?.selectedSourceCommands).toEqual(["review.md"]);
  });

  it("keeps prior agent and MCP tracking when command add targets an existing source", async () => {
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
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nAgent v1.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nCommand v1.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "ship.md"),
      `# /ship\n\nShip command v1.\n`,
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
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
    });
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: true,
      requireCommands: true,
      importMcp: false,
      commandSelectors: ["review"],
    });

    fs.rmSync(path.join(workspaceRoot, ".agents", "commands", "ship.md"));

    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nAgent v2.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nCommand v2.\n`,
    );
    commitAll(sourceRoot, "update-all");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries[0]?.importedAgents).toEqual(["agents/reviewer.md"]);
    expect(lock?.entries[0]?.importedCommands).toEqual(["commands/review.md"]);
    expect(lock?.entries[0]?.selectedSourceCommands).toEqual(["review.md"]);
    expect(lock?.entries[0]?.importedMcpServers).toEqual(["browser"]);

    const updatedAgent = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      "utf8",
    );
    const updatedCommand = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "commands", "review.md"),
      "utf8",
    );
    expect(updatedAgent).toContain("Agent v2.");
    expect(updatedCommand).toContain("Command v2.");
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "ship.md")),
    ).toBe(false);
  });

  it("command delete updates lock tracking so update does not re-import deleted commands", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nCommand v1.\n`,
    );
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    await runCommandCommand(
      parseArgs([
        "command",
        "add",
        sourceRoot,
        "--local",
        "--yes",
        "--no-sync",
      ]),
      workspaceRoot,
    );
    await runCommandCommand(
      parseArgs(["command", "delete", "review", "--local", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(false);

    const lockAfterDelete = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lockAfterDelete?.entries).toHaveLength(0);

    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nCommand v2.\n`,
    );
    commitAll(sourceRoot, "update-review");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(false);
  });

  it("command delete does not break renamed selectors for other sources", async () => {
    const sourceA = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-source-"));
    const sourceB = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-source-"));
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceA, sourceB, workspaceRoot);

    ensureDir(path.join(sourceA, "commands"));
    ensureDir(path.join(sourceB, "commands"));
    writeTextAtomic(
      path.join(sourceA, "commands", "review.md"),
      `# /review\nA1\n`,
    );
    writeTextAtomic(
      path.join(sourceB, "commands", "review.md"),
      `# /review\nB1\n`,
    );
    initGitRepo(sourceA);
    initGitRepo(sourceB);
    commitAll(sourceA, "initial-a");
    commitAll(sourceB, "initial-b");

    await runCommandCommand(
      parseArgs([
        "command",
        "add",
        sourceA,
        "--local",
        "--yes",
        "--no-sync",
        "--command",
        "review",
        "--rename",
        "audit",
      ]),
      workspaceRoot,
    );
    await runCommandCommand(
      parseArgs([
        "command",
        "add",
        sourceB,
        "--local",
        "--yes",
        "--no-sync",
        "--command",
        "review",
      ]),
      workspaceRoot,
    );
    await runCommandCommand(
      parseArgs(["command", "delete", "review", "--local", "--no-sync"]),
      workspaceRoot,
    );

    const lockBeforeUpdate = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lockBeforeUpdate?.entries).toHaveLength(1);
    expect(lockBeforeUpdate?.entries[0]?.selectedSourceCommands).toEqual([
      "review.md",
    ]);

    writeTextAtomic(
      path.join(sourceA, "commands", "review.md"),
      `# /review\nA2\n`,
    );
    commitAll(sourceA, "update-a");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    const commandContent = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "commands", "audit.md"),
      "utf8",
    );
    expect(commandContent).toContain("A2");
  });

  it("replays multiple renamed command imports without creating source-name duplicates", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(path.join(sourceRoot, "commands", "a.md"), `# /a\nA1\n`);
    writeTextAtomic(path.join(sourceRoot, "commands", "b.md"), `# /b\nB1\n`);
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    await runCommandCommand(
      parseArgs([
        "command",
        "add",
        sourceRoot,
        "--local",
        "--yes",
        "--no-sync",
        "--command",
        "a",
        "--rename",
        "x",
      ]),
      workspaceRoot,
    );
    await runCommandCommand(
      parseArgs([
        "command",
        "add",
        sourceRoot,
        "--local",
        "--yes",
        "--no-sync",
        "--command",
        "b",
        "--rename",
        "y",
      ]),
      workspaceRoot,
    );

    writeTextAtomic(path.join(sourceRoot, "commands", "a.md"), `# /a\nA2\n`);
    writeTextAtomic(path.join(sourceRoot, "commands", "b.md"), `# /b\nB2\n`);
    commitAll(sourceRoot, "update-source");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "a.md")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "b.md")),
    ).toBe(false);

    const xContent = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "commands", "x.md"),
      "utf8",
    );
    const yContent = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "commands", "y.md"),
      "utf8",
    );
    expect(xContent).toContain("A2");
    expect(yContent).toContain("B2");

    const lockAfterUpdate = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lockAfterUpdate?.entries[0]?.selectedSourceCommands).toEqual([
      "a.md",
      "b.md",
    ]);
    expect(lockAfterUpdate?.entries[0]?.commandRenameMap).toEqual({
      "a.md": "x.md",
      "b.md": "y.md",
    });
    expect(
      [...(lockAfterUpdate?.entries[0]?.importedCommands ?? [])].sort(),
    ).toEqual(["commands/x.md", "commands/y.md"]);
  });

  it("keeps mixed-entry command deletions sticky across update", async () => {
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
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nAgent v1.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\nCommand v1.\n`,
    );
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
    });
    await runCommandCommand(
      parseArgs(["command", "delete", "review", "--local", "--no-sync"]),
      workspaceRoot,
    );

    const lockAfterDelete = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lockAfterDelete?.entries[0]?.importedCommands).toEqual([]);
    expect(lockAfterDelete?.entries[0]?.selectedSourceCommands).toEqual([]);

    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nAgent v2.\n`,
    );
    commitAll(sourceRoot, "update-source");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(false);

    const updatedAgent = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      "utf8",
    );
    expect(updatedAgent).toContain("Agent v2.");
  });

  it("update does not rename agents when replaying command renames on mixed entries", async () => {
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
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nAgent v1.\n`,
    );
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    const paths = buildScopePaths(workspaceRoot, "local");
    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
    });

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nCommand v1.\n`,
    );
    commitAll(sourceRoot, "add-command");

    await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
      importAgents: false,
      importCommands: true,
      requireCommands: true,
      importMcp: false,
      commandSelectors: ["review"],
      rename: "audit",
    });

    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nAgent v2.\n`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "commands", "review.md"),
      `# /review\n\nCommand v2.\n`,
    );
    commitAll(sourceRoot, "update-source");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "agents", "audit.md")),
    ).toBe(false);

    const updatedAgent = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      "utf8",
    );
    const updatedCommand = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "commands", "audit.md"),
      "utf8",
    );
    expect(updatedAgent).toContain("Agent v2.");
    expect(updatedCommand).toContain("Command v2.");
  });
});

function initGitRepo(root: string): void {
  runGit(root, ["init", "-q"]);
}

function commitAll(root: string, message: string): void {
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=Test User",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    message,
  ]);
}

function runGit(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}
