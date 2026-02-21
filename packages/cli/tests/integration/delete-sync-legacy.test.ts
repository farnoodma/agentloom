import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentCommand } from "../../src/commands/agent.js";
import { runCommandCommand } from "../../src/commands/command.js";
import { parseArgs } from "../../src/core/argv.js";
import {
  ensureDir,
  readJsonIfExists,
  writeTextAtomic,
} from "../../src/core/fs.js";
import type { SyncManifest } from "../../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("legacy manifest cleanup integration", () => {
  it("command delete removes stale synced command files when generatedByEntity is missing", async () => {
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
      "# /review\n",
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
        "--providers",
        "cursor",
      ]),
      workspaceRoot,
    );

    const syncedPath = path.join(
      workspaceRoot,
      ".cursor",
      "commands",
      "review.md",
    );
    expect(fs.existsSync(syncedPath)).toBe(true);

    const manifestPath = path.join(
      workspaceRoot,
      ".agents",
      ".sync-manifest.json",
    );
    const legacyManifest = readJsonIfExists<SyncManifest>(manifestPath);
    if (!legacyManifest) {
      throw new Error("Expected sync manifest to exist.");
    }
    delete legacyManifest.generatedByEntity;
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(legacyManifest, null, 2)}\n`,
    );

    await runCommandCommand(
      parseArgs([
        "command",
        "delete",
        "review",
        "--local",
        "--yes",
        "--providers",
        "cursor",
      ]),
      workspaceRoot,
    );

    expect(fs.existsSync(syncedPath)).toBe(false);

    const migratedManifest = readJsonIfExists<SyncManifest>(manifestPath);
    expect(migratedManifest?.generatedByEntity?.agent ?? []).toEqual([]);
    expect(migratedManifest?.generatedByEntity?.command ?? []).toEqual([]);
    expect(migratedManifest?.generatedByEntity?.mcp ?? []).toEqual([]);
  });

  it("agent delete removes stale codex role entries when codex manifest metadata is missing", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "researcher.md"),
      `---\nname: researcher\ndescription: Research specialist\ncodex:\n  model: gpt-5.3-codex\n---\n\nInvestigate.\n`,
    );
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    await runAgentCommand(
      parseArgs([
        "agent",
        "add",
        sourceRoot,
        "--local",
        "--yes",
        "--providers",
        "codex",
      ]),
      workspaceRoot,
    );

    const manifestPath = path.join(
      workspaceRoot,
      ".agents",
      ".sync-manifest.json",
    );
    const legacyManifest = readJsonIfExists<SyncManifest>(manifestPath);
    if (!legacyManifest) {
      throw new Error("Expected sync manifest to exist.");
    }
    delete legacyManifest.codex;
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(legacyManifest, null, 2)}\n`,
    );

    await runAgentCommand(
      parseArgs([
        "agent",
        "delete",
        "researcher",
        "--local",
        "--yes",
        "--providers",
        "codex",
      ]),
      workspaceRoot,
    );

    const codexConfigPath = path.join(workspaceRoot, ".codex", "config.toml");
    const codexConfig = TOML.parse(
      fs.readFileSync(codexConfigPath, "utf8"),
    ) as {
      agents?: Record<string, unknown>;
    };
    expect(codexConfig.agents?.researcher).toBeUndefined();
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
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    message,
  ]);
}

function runGit(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}
