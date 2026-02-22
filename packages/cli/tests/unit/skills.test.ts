import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";
import { buildScopePaths } from "../../src/core/scope.js";
import {
  applySkillProviderSideEffects,
  parseSkillsDir,
} from "../../src/core/skills.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseSkillsDir", () => {
  it("parses root SKILL.md frontmatter name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-skills-"));
    tempDirs.push(root);

    writeTextAtomic(
      path.join(root, "SKILL.md"),
      `---
name: visual-explainer
description: Explain visuals
---

Root skill body.
`,
    );

    expect(parseSkillsDir(root)).toEqual([
      {
        name: "visual-explainer",
        sourcePath: root,
        skillPath: path.join(root, "SKILL.md"),
        layout: "root",
      },
    ]);
  });

  it("falls back to directory basename when root SKILL.md has no name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-skills-"));
    tempDirs.push(root);

    writeTextAtomic(
      path.join(root, "SKILL.md"),
      `---
description: no name
---

Root skill body.
`,
    );

    expect(parseSkillsDir(root)).toEqual([
      {
        name: path.basename(root),
        sourcePath: root,
        skillPath: path.join(root, "SKILL.md"),
        layout: "root",
      },
    ]);
  });

  it("parses traditional skills/<name>/SKILL.md layout", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-skills-"));
    tempDirs.push(root);

    ensureDir(path.join(root, "reviewing"));
    writeTextAtomic(path.join(root, "reviewing", "SKILL.md"), "# reviewing\n");

    expect(parseSkillsDir(root)).toEqual([
      {
        name: "reviewing",
        sourcePath: path.join(root, "reviewing"),
        skillPath: path.join(root, "reviewing", "SKILL.md"),
        layout: "nested",
      },
    ]);
  });

  it("prefers nested skills when SKILL.md is also present at the directory root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-skills-"));
    tempDirs.push(root);

    writeTextAtomic(path.join(root, "SKILL.md"), "# root fallback\n");
    ensureDir(path.join(root, "reviewing"));
    writeTextAtomic(path.join(root, "reviewing", "SKILL.md"), "# reviewing\n");

    expect(parseSkillsDir(root)).toEqual([
      {
        name: "reviewing",
        sourcePath: path.join(root, "reviewing"),
        skillPath: path.join(root, "reviewing", "SKILL.md"),
        layout: "nested",
      },
    ]);
  });
});

describe("applySkillProviderSideEffects", () => {
  it("creates .claude/skills symlink for claude providers", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-skills-sideeffects-"),
    );
    tempDirs.push(workspaceRoot);

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(paths.skillsDir);

    applySkillProviderSideEffects({
      paths,
      providers: ["claude"],
    });

    const claudeSkillsDir = path.join(workspaceRoot, ".claude", "skills");
    expect(fs.lstatSync(claudeSkillsDir).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(claudeSkillsDir)).toBe(
      fs.realpathSync(paths.skillsDir),
    );
  });

  it("migrates provider skills into canonical path before replacing with symlink", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-skills-sideeffects-"),
    );
    tempDirs.push(workspaceRoot);

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(paths.skillsDir);

    const cursorSkillsDir = path.join(workspaceRoot, ".cursor", "skills");
    ensureDir(path.join(cursorSkillsDir, "release-check"));
    writeTextAtomic(
      path.join(cursorSkillsDir, "release-check", "SKILL.md"),
      "# release-check\n",
    );

    applySkillProviderSideEffects({
      paths,
      providers: ["cursor"],
    });

    expect(
      fs.existsSync(path.join(paths.skillsDir, "release-check", "SKILL.md")),
    ).toBe(true);
    expect(fs.lstatSync(cursorSkillsDir).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(cursorSkillsDir)).toBe(
      fs.realpathSync(paths.skillsDir),
    );
  });

  it("warns and keeps canonical skill when provider migration conflicts", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-skills-sideeffects-"),
    );
    tempDirs.push(workspaceRoot);

    const paths = buildScopePaths(workspaceRoot, "local");
    ensureDir(path.join(paths.skillsDir, "release-check"));
    writeTextAtomic(
      path.join(paths.skillsDir, "release-check", "SKILL.md"),
      "# canonical\n",
    );

    const cursorSkillsDir = path.join(workspaceRoot, ".cursor", "skills");
    ensureDir(path.join(cursorSkillsDir, "release-check"));
    writeTextAtomic(
      path.join(cursorSkillsDir, "release-check", "SKILL.md"),
      "# provider\n",
    );

    const warn = vi.fn();
    applySkillProviderSideEffects({
      paths,
      providers: ["cursor"],
      warn,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(
      fs.readFileSync(
        path.join(paths.skillsDir, "release-check", "SKILL.md"),
        "utf8",
      ),
    ).toContain("canonical");
  });
});
