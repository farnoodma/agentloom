import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommandCommand } from "../../src/commands/command.js";
import { runDeleteCommand } from "../../src/commands/delete.js";
import { runSkillCommand } from "../../src/commands/skills.js";
import { parseArgs } from "../../src/core/argv.js";
import {
  ensureDir,
  readJsonIfExists,
  writeTextAtomic,
} from "../../src/core/fs.js";
import type { AgentsLockFile } from "../../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("delete supports multiple positional names", () => {
  it("command delete removes multiple commands in one invocation and keeps lock selectors for remaining commands", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(path.join(sourceRoot, "commands", "a.md"), "# /a\nA1\n");
    writeTextAtomic(path.join(sourceRoot, "commands", "b.md"), "# /b\nB1\n");
    writeTextAtomic(path.join(sourceRoot, "commands", "c.md"), "# /c\nC1\n");
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
      parseArgs(["command", "delete", "a", "b", "--local", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "a.md")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "b.md")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "c.md")),
    ).toBe(true);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.selectedSourceCommands).toEqual(["c.md"]);
    expect(lock?.entries[0]?.importedCommands).toEqual(["commands/c.md"]);
  });

  it("aggregate delete accepts multiple names with --entity command", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "alpha.md"),
      "# /alpha\n",
    );
    writeTextAtomic(path.join(sourceRoot, "commands", "beta.md"), "# /beta\n");
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

    await runDeleteCommand(
      parseArgs([
        "delete",
        "alpha",
        "beta",
        "--entity",
        "command",
        "--local",
        "--no-sync",
      ]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "alpha.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "beta.md")),
    ).toBe(false);

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries ?? []).toHaveLength(0);
  });

  it("continues deleting valid names when some names do not exist", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(path.join(sourceRoot, "commands", "a.md"), "# /a\nA1\n");
    writeTextAtomic(path.join(sourceRoot, "commands", "b.md"), "# /b\nB1\n");
    writeTextAtomic(path.join(sourceRoot, "commands", "c.md"), "# /c\nC1\n");
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

    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await runCommandCommand(
      parseArgs([
        "command",
        "delete",
        "a",
        "missing",
        "b",
        "--local",
        "--no-sync",
      ]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "a.md")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "b.md")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "c.md")),
    ).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      "Couldn't delete these because they don't exist: missing",
    );

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.selectedSourceCommands).toEqual(["c.md"]);
    expect(lock?.entries[0]?.importedCommands).toEqual(["commands/c.md"]);
    warnSpy.mockRestore();
  });

  it("accepts remove as an alias for command delete", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "commands"));
    writeTextAtomic(
      path.join(sourceRoot, "commands", "alpha.md"),
      "# /alpha\n",
    );
    writeTextAtomic(path.join(sourceRoot, "commands", "beta.md"), "# /beta\n");
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
      parseArgs(["command", "remove", "alpha", "--local", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "alpha.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "commands", "beta.md")),
    ).toBe(true);
  });

  it("skill delete removes multiple skills in one invocation", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    ensureDir(path.join(workspaceRoot, ".agents", "skills", "alpha"));
    ensureDir(path.join(workspaceRoot, ".agents", "skills", "beta"));
    ensureDir(path.join(workspaceRoot, ".agents", "skills", "gamma"));
    writeTextAtomic(
      path.join(workspaceRoot, ".agents", "skills", "alpha", "SKILL.md"),
      "# Alpha\n",
    );
    writeTextAtomic(
      path.join(workspaceRoot, ".agents", "skills", "beta", "SKILL.md"),
      "# Beta\n",
    );
    writeTextAtomic(
      path.join(workspaceRoot, ".agents", "skills", "gamma", "SKILL.md"),
      "# Gamma\n",
    );

    await runSkillCommand(
      parseArgs(["skill", "delete", "alpha", "beta", "--local", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "skills", "alpha")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "skills", "beta")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "skills", "gamma")),
    ).toBe(true);
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
