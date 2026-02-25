import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverSourceAgentsDir,
  discoverSourceCommandsDir,
  discoverSourceSkillsDir,
  parseSourceSpec,
  prepareSource,
} from "../../src/core/sources.js";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("source parsing and revision", () => {
  it("classifies existing relative owner/repo paths as local", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sources-"));
    tempDirs.push(root);

    ensureDir(path.join(root, "owner", "repo"));
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const spec = parseSourceSpec("owner/repo");
      expect(spec.type).toBe("local");
      expect(fs.realpathSync(spec.source)).toBe(
        fs.realpathSync(path.join(root, "owner", "repo")),
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("tracks non-git local revisions from file content changes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sources-"));
    tempDirs.push(root);

    ensureDir(path.join(root, "agents"));
    const agentPath = path.join(root, "agents", "reviewer.md");

    writeTextAtomic(
      agentPath,
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nAAAA\n`,
    );

    const beforeStat = fs.statSync(root);
    const first = prepareSource({ source: root });
    first.cleanup();

    writeTextAtomic(
      agentPath,
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nBBBB\n`,
    );

    fs.utimesSync(root, beforeStat.atime, beforeStat.mtime);

    const second = prepareSource({ source: root });
    second.cleanup();

    expect(first.resolvedCommit).toMatch(/^local-/);
    expect(second.resolvedCommit).toMatch(/^local-/);
    expect(second.resolvedCommit).not.toBe(first.resolvedCommit);
  });

  it("falls back to prompts when canonical command directories are absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sources-"));
    tempDirs.push(root);

    ensureDir(path.join(root, "prompts"));

    expect(discoverSourceCommandsDir(root)).toBe(path.join(root, "prompts"));
  });

  it("falls back to .github prompts when command directories are absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sources-"));
    tempDirs.push(root);

    ensureDir(path.join(root, ".github", "prompts"));

    expect(discoverSourceCommandsDir(root)).toBe(
      path.join(root, ".github", "prompts"),
    );
  });

  it("uses command source priority .agents/commands before commands before prompts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sources-"));
    tempDirs.push(root);

    ensureDir(path.join(root, ".agents", "commands"));
    ensureDir(path.join(root, "commands"));
    ensureDir(path.join(root, "prompts"));

    expect(discoverSourceCommandsDir(root)).toBe(
      path.join(root, ".agents", "commands"),
    );
  });

  it("uses root SKILL.md fallback only when canonical skills directories are absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sources-"));
    tempDirs.push(root);

    writeTextAtomic(path.join(root, "SKILL.md"), "# Root skill\n");
    expect(discoverSourceSkillsDir(root)).toBe(root);

    ensureDir(path.join(root, "skills"));
    expect(discoverSourceSkillsDir(root)).toBe(path.join(root, "skills"));
  });

  it("falls back to .github agents when canonical agent directories are absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sources-"));
    tempDirs.push(root);

    ensureDir(path.join(root, ".github", "agents"));

    expect(discoverSourceAgentsDir(root)).toBe(
      path.join(root, ".github", "agents"),
    );
  });
});
