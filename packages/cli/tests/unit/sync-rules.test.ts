import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildScopePaths } from "../../src/core/scope.js";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";
import { getVsCodeSettingsPath } from "../../src/core/provider-paths.js";
import { syncFromCanonical } from "../../src/sync/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDirs() {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentloom-workspace-"),
  );
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
  tempDirs.push(workspaceRoot, homeDir);
  return { workspaceRoot, homeDir };
}

describe("rule sync", () => {
  it("syncs managed blocks to local AGENTS/CLAUDE and renders cursor .mdc files", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();
    const paths = buildScopePaths(workspaceRoot, "local", homeDir);

    ensureDir(paths.rulesDir);
    writeTextAtomic(
      path.join(paths.rulesDir, "always-test.md"),
      `---
name: Always Test
alwaysApply: true
---

Run tests before merge.
`,
    );

    writeTextAtomic(
      path.join(workspaceRoot, "AGENTS.md"),
      "# Local notes\n\nKeep this content.\n",
    );

    const summary = await syncFromCanonical({
      paths,
      providers: ["cursor", "claude"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    const agentsContent = fs.readFileSync(
      path.join(workspaceRoot, "AGENTS.md"),
      "utf8",
    );
    expect(agentsContent).toContain("Keep this content.");
    expect(agentsContent).toContain("<!-- agentloom:always-test:start -->");
    expect(agentsContent).toContain("## Always Test");

    const claudeContent = fs.readFileSync(
      path.join(workspaceRoot, "CLAUDE.md"),
      "utf8",
    );
    expect(claudeContent).toContain("<!-- agentloom:always-test:start -->");

    const cursorRulePath = path.join(
      workspaceRoot,
      ".cursor",
      "rules",
      "always-test.mdc",
    );
    expect(fs.existsSync(cursorRulePath)).toBe(true);
    const cursorRule = fs.readFileSync(cursorRulePath, "utf8");
    expect(cursorRule).toContain("alwaysApply: true");
    expect(cursorRule).toContain("Run tests before merge.");
    expect(summary.generatedFiles).toEqual(
      expect.arrayContaining([
        path.join(workspaceRoot, "AGENTS.md"),
        path.join(workspaceRoot, "CLAUDE.md"),
        cursorRulePath,
      ]),
    );
  });

  it("reports provider instruction file rewrites during dry-run cleanup", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();
    const paths = buildScopePaths(workspaceRoot, "local", homeDir);

    const claudePath = path.join(workspaceRoot, "CLAUDE.md");
    const existingContent = `# Claude Notes

<!-- agentloom:always-test:start -->
## Always Test

Run tests before merge.
<!-- agentloom:always-test:end -->

Keep this text.
`;
    writeTextAtomic(claudePath, existingContent);

    const summary = await syncFromCanonical({
      paths,
      providers: ["claude"],
      yes: true,
      nonInteractive: true,
      dryRun: true,
      target: "rule",
    });

    expect(summary.generatedFiles).toContain(claudePath);
    expect(summary.removedFiles).toEqual([]);
    expect(fs.readFileSync(claudePath, "utf8")).toBe(existingContent);
  });

  it("removes orphan managed blocks while preserving unmanaged text", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();
    const paths = buildScopePaths(workspaceRoot, "local", homeDir);

    writeTextAtomic(
      path.join(workspaceRoot, "AGENTS.md"),
      `# Team Guide

<!-- agentloom:orphan:start -->
## Old Rule

Delete this.
<!-- agentloom:orphan:end -->

Footer text.
`,
    );

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    const agentsContent = fs.readFileSync(
      path.join(workspaceRoot, "AGENTS.md"),
      "utf8",
    );
    expect(agentsContent).not.toContain("agentloom:orphan:start");
    expect(agentsContent).toContain("Footer text.");
  });

  it("cleans managed blocks from provider instruction files that are no longer targeted", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();
    const paths = buildScopePaths(workspaceRoot, "local", homeDir);

    ensureDir(paths.rulesDir);
    writeTextAtomic(
      path.join(paths.rulesDir, "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );

    writeTextAtomic(
      path.join(workspaceRoot, "CLAUDE.md"),
      "# Claude Notes\n\nKeep this text.\n",
    );

    await syncFromCanonical({
      paths,
      providers: ["claude"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    expect(
      fs.readFileSync(path.join(workspaceRoot, "CLAUDE.md"), "utf8"),
    ).toContain("agentloom:always-test:start");

    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    const claudeContent = fs.readFileSync(
      path.join(workspaceRoot, "CLAUDE.md"),
      "utf8",
    );
    expect(claudeContent).toContain("Keep this text.");
    expect(claudeContent).not.toContain("agentloom:always-test:start");
    expect(claudeContent).not.toContain("## Always Test");
  });

  it("removes provider instruction files that become empty after cleanup", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();
    const paths = buildScopePaths(workspaceRoot, "local", homeDir);

    ensureDir(paths.rulesDir);
    writeTextAtomic(
      path.join(paths.rulesDir, "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );

    await syncFromCanonical({
      paths,
      providers: ["claude"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    const claudePath = path.join(workspaceRoot, "CLAUDE.md");
    expect(fs.existsSync(claudePath)).toBe(true);

    fs.rmSync(path.join(paths.rulesDir, "always-test.md"));

    await syncFromCanonical({
      paths,
      providers: ["claude"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    expect(fs.existsSync(claudePath)).toBe(false);
  });

  it("syncs global copilot instructions and updates discovery settings", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();
    const paths = buildScopePaths(workspaceRoot, "global", homeDir);

    ensureDir(paths.rulesDir);
    writeTextAtomic(
      path.join(paths.rulesDir, "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );

    const settingsPath = getVsCodeSettingsPath(homeDir);
    ensureDir(path.dirname(settingsPath));
    writeTextAtomic(settingsPath, "{}\n");

    await syncFromCanonical({
      paths,
      providers: ["copilot"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    const instructionPath = path.join(
      homeDir,
      ".copilot",
      "copilot-instructions.md",
    );
    expect(fs.existsSync(instructionPath)).toBe(true);
    expect(fs.readFileSync(instructionPath, "utf8")).toContain(
      "agentloom:always-test:start",
    );

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      [key: string]: unknown;
    };
    expect(settings["chat.instructionsFilesLocations"]).toEqual(
      expect.arrayContaining([instructionPath]),
    );
  });

  it("treats global cursor rule sync as a no-op for other instruction files", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();
    const paths = buildScopePaths(workspaceRoot, "global", homeDir);

    ensureDir(paths.rulesDir);
    writeTextAtomic(
      path.join(paths.rulesDir, "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );

    const claudePath = path.join(homeDir, ".claude", "CLAUDE.md");
    const existingClaudeContent = `# Claude

<!-- agentloom:always-test:start -->
## Always Test

Run tests before merge.
<!-- agentloom:always-test:end -->
`;
    writeTextAtomic(claudePath, existingClaudeContent);

    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    expect(fs.readFileSync(claudePath, "utf8")).toBe(existingClaudeContent);
  });

  it("does not generate cursor rule files for global scope", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();
    const paths = buildScopePaths(workspaceRoot, "global", homeDir);

    ensureDir(paths.rulesDir);
    writeTextAtomic(
      path.join(paths.rulesDir, "always-test.md"),
      `---
name: Always Test
---

Run tests before merge.
`,
    );

    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
      target: "rule",
    });

    expect(
      fs.existsSync(path.join(homeDir, ".cursor", "rules", "always-test.mdc")),
    ).toBe(false);
  });
});
