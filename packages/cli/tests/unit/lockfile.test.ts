import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readLockfile,
  upsertLockEntry,
  writeLockfile,
} from "../../src/core/lockfile.js";
import { buildScopePaths } from "../../src/core/scope.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("lockfile helpers", () => {
  it("returns isolated empty lockfile objects for missing paths", () => {
    const workspaceA = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-a-"));
    const workspaceB = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-b-"));
    tempDirs.push(workspaceA, workspaceB);

    const lockA = readLockfile(buildScopePaths(workspaceA, "local"));
    upsertLockEntry(lockA, {
      source: "/tmp/source-a",
      sourceType: "local",
      resolvedCommit: "abc123",
      importedAt: new Date().toISOString(),
      importedAgents: [],
      importedCommands: [],
      importedMcpServers: [],
      contentHash: "hash-a",
    });

    const lockB = readLockfile(buildScopePaths(workspaceB, "local"));
    expect(lockB.entries).toHaveLength(0);
  });

  it("stores local source entries as workspace-relative paths on disk", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-source-"),
    );
    tempDirs.push(workspaceRoot, sourceRoot);

    const paths = buildScopePaths(workspaceRoot, "local");
    fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true });

    writeLockfile(paths, {
      version: 1,
      entries: [
        {
          source: sourceRoot,
          sourceType: "local",
          resolvedCommit: "abc123",
          importedAt: "2026-01-01T00:00:00.000Z",
          importedAgents: [],
          importedCommands: [],
          importedMcpServers: [],
          importedSkills: [],
          contentHash: "hash-a",
        },
      ],
    });

    const lockOnDisk = JSON.parse(fs.readFileSync(paths.lockPath, "utf8")) as {
      entries?: Array<{ source?: string }>;
    };
    expect(lockOnDisk.entries?.[0]?.source).toBe(
      path.relative(workspaceRoot, sourceRoot),
    );
  });

  it("resolves relative local source entries to absolute paths at read time", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const sourceRoot = fs.mkdtempSync(path.join(workspaceRoot, "source-"));
    tempDirs.push(workspaceRoot, sourceRoot);

    const paths = buildScopePaths(workspaceRoot, "local");
    fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true });
    fs.writeFileSync(
      paths.lockPath,
      `${JSON.stringify(
        {
          version: 1,
          entries: [
            {
              source: path.relative(workspaceRoot, sourceRoot),
              sourceType: "local",
              resolvedCommit: "abc123",
              importedAt: "2026-01-01T00:00:00.000Z",
              importedAgents: [],
              importedCommands: [],
              importedMcpServers: [],
              importedSkills: [],
              contentHash: "hash-a",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const lock = readLockfile(paths);
    expect(lock.entries[0]?.source).toBe(sourceRoot);
  });
});
