import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";
import { parseSkillsDir } from "../../src/core/skills.js";

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
      },
    ]);
  });
});
