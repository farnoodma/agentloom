import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLockfile, upsertLockEntry } from "../../src/core/lockfile.js";
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
});
