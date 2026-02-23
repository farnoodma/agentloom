import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildScopePaths } from "../../src/core/scope.js";
import {
  MigrationConflictError,
  initializeCanonicalLayout,
  migrateProviderStateToCanonical,
} from "../../src/core/migration.js";
import {
  ensureDir,
  writeJsonAtomic,
  writeTextAtomic,
} from "../../src/core/fs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createPaths() {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentloom-workspace-"),
  );
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
  tempDirs.push(workspaceRoot, homeDir);
  return buildScopePaths(workspaceRoot, "local", homeDir);
}

describe("canonical layout initialization", () => {
  it("creates canonical directories and baseline files", () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor", "codex"]);

    expect(fs.existsSync(paths.agentsDir)).toBe(true);
    expect(fs.existsSync(paths.commandsDir)).toBe(true);
    expect(fs.existsSync(paths.skillsDir)).toBe(true);
    expect(fs.existsSync(paths.mcpPath)).toBe(true);
    expect(fs.existsSync(paths.lockPath)).toBe(true);
    expect(fs.existsSync(paths.settingsPath)).toBe(true);
    expect(fs.existsSync(paths.manifestPath)).toBe(true);

    const settings = JSON.parse(
      fs.readFileSync(paths.settingsPath, "utf8"),
    ) as { lastScope?: string; defaultProviders?: string[] };
    expect(settings.lastScope).toBe("local");
    expect(settings.defaultProviders).toEqual(["cursor", "codex"]);
  });
});

describe("provider migration", () => {
  it("migrates cursor provider data into canonical files", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Reviews changes\nmodel: fast\n---\n\nReview all changed files.\n`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "review.prompt.md"),
      "# /review\n\nCheck the current diff.\n",
    );

    writeJsonAtomic(path.join(paths.workspaceRoot, ".cursor", "mcp.json"), {
      mcpServers: {
        browser: {
          command: "npx",
          args: ["browser-tools-mcp"],
        },
      },
    });

    ensureDir(
      path.join(paths.workspaceRoot, ".cursor", "skills", "release-check"),
    );
    writeTextAtomic(
      path.join(
        paths.workspaceRoot,
        ".cursor",
        "skills",
        "release-check",
        "SKILL.md",
      ),
      "# Release Check\n",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "all",
      nonInteractive: true,
    });

    expect(summary.entities.agent.imported).toBeGreaterThanOrEqual(1);
    expect(summary.entities.command.imported).toBeGreaterThanOrEqual(1);
    expect(summary.entities.mcp.imported).toBeGreaterThanOrEqual(1);
    expect(summary.entities.skill.imported).toBeGreaterThanOrEqual(1);

    const canonicalAgent = fs.readFileSync(
      path.join(paths.agentsDir, "reviewer.md"),
      "utf8",
    );
    expect(canonicalAgent).toContain("name: reviewer");
    expect(canonicalAgent).toContain("cursor:");
    expect(canonicalAgent).toContain("model: fast");

    expect(fs.existsSync(path.join(paths.commandsDir, "review.md"))).toBe(true);

    const canonicalMcp = JSON.parse(fs.readFileSync(paths.mcpPath, "utf8")) as {
      mcpServers?: Record<string, { base?: Record<string, unknown> }>;
    };
    expect(canonicalMcp.mcpServers?.browser?.base?.command).toBe("npx");

    expect(
      fs.existsSync(path.join(paths.skillsDir, "release-check", "SKILL.md")),
    ).toBe(true);
  });

  it("fails fast for canonical-vs-provider conflicts in non-interactive mode", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    writeTextAtomic(
      path.join(paths.commandsDir, "review.md"),
      "# /review\n\nCanonical content.\n",
    );

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "review.md"),
      "# /review\n\nProvider content.\n",
    );

    await expect(
      migrateProviderStateToCanonical({
        paths,
        providers: ["cursor"],
        target: "command",
        nonInteractive: true,
      }),
    ).rejects.toBeInstanceOf(MigrationConflictError);
  });
});
