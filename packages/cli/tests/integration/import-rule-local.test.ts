import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRuleCommand } from "../../src/commands/rule.js";
import { runUpdateCommand } from "../../src/commands/update.js";
import { parseArgs } from "../../src/core/argv.js";
import { importSource } from "../../src/core/importer.js";
import { buildScopePaths } from "../../src/core/scope.js";
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

describe("importSource rule-only local", () => {
  it("preserves source-relative paths for nested rule telemetry", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "nested", "rules"));
    writeTextAtomic(
      path.join(sourceRoot, "nested", "rules", "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );

    const summary = await importSource({
      source: sourceRoot,
      subdir: "nested",
      yes: true,
      nonInteractive: true,
      paths: buildScopePaths(workspaceRoot, "local"),
      importAgents: false,
      importCommands: false,
      importMcp: false,
      importRules: true,
      requireRules: true,
    });

    expect(summary.telemetryRules).toEqual([
      {
        name: "always-test",
        filePath: "nested/rules/always-test.md",
      },
    ]);
  });

  it("replays renamed rule targets during update for sync-all imports", async () => {
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
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    await runRuleCommand(
      parseArgs([
        "rule",
        "add",
        sourceRoot,
        "--local",
        "--yes",
        "--no-sync",
        "--rename",
        "always-run-tests",
      ]),
      workspaceRoot,
    );

    const lockBeforeUpdate = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lockBeforeUpdate?.entries[0]?.selectedSourceRules).toBeUndefined();
    expect(lockBeforeUpdate?.entries[0]?.ruleRenameMap).toEqual({
      "always-test": "always-run-tests.md",
    });

    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---
name: Always Test
---

Run tests before release.
`,
    );
    commitAll(sourceRoot, "update-rule");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "rules", "always-test.md"),
      ),
    ).toBe(false);

    const renamedRule = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "rules", "always-run-tests.md"),
      "utf8",
    );
    expect(renamedRule).toContain("before release");
  });

  it("keeps unrenamed rules tracked after deleting another rule", async () => {
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

Rule A1.
`,
    );
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    await runRuleCommand(
      parseArgs([
        "rule",
        "add",
        sourceRoot,
        "--local",
        "--yes",
        "--no-sync",
        "--rename",
        "always-run-tests",
      ]),
      workspaceRoot,
    );

    writeTextAtomic(
      path.join(sourceRoot, "rules", "keep.md"),
      `---
name: Keep
---

Rule B1.
`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "rules", "extra.md"),
      `---
name: Extra
---

Rule C1.
`,
    );
    commitAll(sourceRoot, "add-more-rules");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    await runRuleCommand(
      parseArgs(["rule", "delete", "extra", "--local", "--no-sync"]),
      workspaceRoot,
    );

    const lockAfterDelete = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(
      [...(lockAfterDelete?.entries[0]?.selectedSourceRules ?? [])].sort(),
    ).toEqual(["always-test", "keep"]);

    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---
name: Always Test
---

Rule A2.
`,
    );
    writeTextAtomic(
      path.join(sourceRoot, "rules", "keep.md"),
      `---
name: Keep
---

Rule B2.
`,
    );
    commitAll(sourceRoot, "update-remaining-rules");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    const renamedRule = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "rules", "always-run-tests.md"),
      "utf8",
    );
    const keepRule = fs.readFileSync(
      path.join(workspaceRoot, ".agents", "rules", "keep.md"),
      "utf8",
    );
    expect(renamedRule).toContain("Rule A2.");
    expect(keepRule).toContain("Rule B2.");
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "rules", "extra.md")),
    ).toBe(false);
  });

  it("keeps renamed rules deleted when removal uses the visible rule name", async () => {
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

Rule A1.
`,
    );
    initGitRepo(sourceRoot);
    commitAll(sourceRoot, "initial");

    await runRuleCommand(
      parseArgs([
        "rule",
        "add",
        sourceRoot,
        "--local",
        "--yes",
        "--no-sync",
        "--rename",
        "always-run-tests",
      ]),
      workspaceRoot,
    );

    await runRuleCommand(
      parseArgs(["rule", "delete", "Always Test", "--local", "--no-sync"]),
      workspaceRoot,
    );

    const lockAfterDelete = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lockAfterDelete?.entries).toEqual([]);

    writeTextAtomic(
      path.join(sourceRoot, "rules", "always-test.md"),
      `---
name: Always Test
---

Rule A2.
`,
    );
    commitAll(sourceRoot, "update-rule");

    await runUpdateCommand(
      parseArgs(["update", "--local", "--yes", "--no-sync"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "rules", "always-run-tests.md"),
      ),
    ).toBe(false);
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
