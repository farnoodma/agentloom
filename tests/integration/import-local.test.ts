import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDir,
  readJsonIfExists,
  writeTextAtomic,
  writeJsonAtomic,
} from "../../src/core/fs.js";
import { buildScopePaths } from "../../src/core/scope.js";
import { importSource } from "../../src/core/importer.js";
import type { AgentsLockFile } from "../../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("importSource local", () => {
  it("imports agents and mcp and writes lock entry", async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "dotagents-source-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "dotagents-workspace-"),
    );
    tempDirs.push(sourceRoot, workspaceRoot);

    ensureDir(path.join(sourceRoot, "agents"));
    writeTextAtomic(
      path.join(sourceRoot, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Review specialist\n---\n\nReview code changes.\n`,
    );

    writeJsonAtomic(path.join(sourceRoot, "mcp.json"), {
      version: 1,
      mcpServers: {
        browser: {
          base: {
            command: "npx",
            args: ["browser-tools"],
          },
        },
      },
    });

    const paths = buildScopePaths(workspaceRoot, "local");

    const summary = await importSource({
      source: sourceRoot,
      paths,
      yes: true,
      nonInteractive: true,
    });

    expect(summary.importedAgents).toHaveLength(1);
    expect(summary.importedMcpServers).toContain("browser");

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "agents", "reviewer.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".agents", "mcp.json"))).toBe(
      true,
    );

    const lock = readJsonIfExists<AgentsLockFile>(
      path.join(workspaceRoot, ".agents", "agents.lock.json"),
    );
    expect(lock?.entries).toHaveLength(1);
    expect(lock?.entries[0]?.sourceType).toBe("local");
  });
});
