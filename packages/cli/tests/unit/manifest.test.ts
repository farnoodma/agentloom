import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readManifest, writeManifest } from "../../src/core/manifest.js";
import { buildScopePaths } from "../../src/core/scope.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("manifest helpers", () => {
  it("stores local generated paths as workspace-relative and ~/ paths on disk", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    fs.mkdirSync(path.dirname(paths.manifestPath), { recursive: true });

    const workspaceOutput = path.join(
      workspaceRoot,
      ".cursor",
      "commands",
      "review.md",
    );
    const homeOutput = path.join(homeDir, ".codex", "prompts", "review.md");

    writeManifest(paths, {
      version: 1,
      generatedFiles: [workspaceOutput, homeOutput],
      generatedByEntity: {
        command: [workspaceOutput],
        mcp: [homeOutput],
      },
      codex: {
        roles: ["reviewer"],
        mcpServers: ["browser"],
      },
    });

    const onDisk = JSON.parse(fs.readFileSync(paths.manifestPath, "utf8")) as {
      generatedFiles?: string[];
      generatedByEntity?: {
        command?: string[];
        mcp?: string[];
      };
    };

    expect(onDisk.generatedFiles).toEqual([
      ".cursor/commands/review.md",
      "~/.codex/prompts/review.md",
    ]);
    expect(onDisk.generatedByEntity?.command).toEqual([
      ".cursor/commands/review.md",
    ]);
    expect(onDisk.generatedByEntity?.mcp).toEqual([
      "~/.codex/prompts/review.md",
    ]);
  });

  it("resolves relative and ~/ manifest entries to absolute runtime paths", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    fs.mkdirSync(path.dirname(paths.manifestPath), { recursive: true });
    fs.writeFileSync(
      paths.manifestPath,
      `${JSON.stringify(
        {
          version: 1,
          generatedFiles: [
            ".cursor/commands/review.md",
            "~/.codex/prompts/review.md",
          ],
          generatedByEntity: {
            command: [".cursor/commands/review.md"],
            mcp: ["~/.codex/prompts/review.md"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = readManifest(paths);

    expect(manifest.generatedFiles).toEqual([
      path.join(homeDir, ".codex", "prompts", "review.md"),
      path.join(workspaceRoot, ".cursor", "commands", "review.md"),
    ]);
    expect(manifest.generatedByEntity?.command).toEqual([
      path.join(workspaceRoot, ".cursor", "commands", "review.md"),
    ]);
    expect(manifest.generatedByEntity?.mcp).toEqual([
      path.join(homeDir, ".codex", "prompts", "review.md"),
    ]);
  });

  it("keeps legacy absolute entries readable at runtime", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    const paths = buildScopePaths(workspaceRoot, "local");
    fs.mkdirSync(path.dirname(paths.manifestPath), { recursive: true });
    const absoluteOutput = path.join(
      workspaceRoot,
      ".cursor",
      "agents",
      "a.md",
    );
    fs.writeFileSync(
      paths.manifestPath,
      `${JSON.stringify(
        {
          version: 1,
          generatedFiles: [absoluteOutput],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = readManifest(paths);
    expect(manifest.generatedFiles).toEqual([absoluteOutput]);
  });

  it("encodes global home outputs with ~/ so reads are stable across cwd changes", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    const secondCwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-cwd-"));
    tempDirs.push(homeDir, secondCwd);

    const writePaths = buildScopePaths(homeDir, "global", homeDir);
    fs.mkdirSync(path.dirname(writePaths.manifestPath), { recursive: true });
    const globalOutput = path.join(homeDir, ".codex", "prompts", "review.md");

    writeManifest(writePaths, {
      version: 1,
      generatedFiles: [globalOutput],
    });

    const onDisk = JSON.parse(
      fs.readFileSync(writePaths.manifestPath, "utf8"),
    ) as {
      generatedFiles?: string[];
    };
    expect(onDisk.generatedFiles).toEqual(["~/.codex/prompts/review.md"]);

    const readPaths = buildScopePaths(secondCwd, "global", homeDir);
    const manifest = readManifest(readPaths);
    expect(manifest.generatedFiles).toEqual([globalOutput]);
  });
});
