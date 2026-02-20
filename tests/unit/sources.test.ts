import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSourceSpec, prepareSource } from "../../src/core/sources.js";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("source parsing and revision", () => {
  it("classifies existing relative owner/repo paths as local", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-sources-"));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-sources-"));
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
});
