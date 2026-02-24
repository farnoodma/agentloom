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

function createGlobalPaths() {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentloom-workspace-"),
  );
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
  tempDirs.push(workspaceRoot, homeDir);
  return buildScopePaths(workspaceRoot, "global", homeDir);
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

  it("keeps long agent descriptions on one line when migrating providers", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    const description =
      "Starts the application, performs auto-login, and reports back the ports and current URL. Use before testing changes in the browser. See application-debugging skill for browser tool guidance.";

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(
        paths.workspaceRoot,
        ".cursor",
        "agents",
        "application-runner.md",
      ),
      `---\nname: application-runner\ndescription: ${description}\nmodel: gpt-5.3-codex\n---\n\nStart services and report readiness.\n`,
    );

    await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "agent",
      nonInteractive: true,
    });

    const canonical = fs.readFileSync(
      path.join(paths.agentsDir, "application-runner.md"),
      "utf8",
    );
    expect(canonical).toContain(`description: ${description}`);
    expect(canonical).not.toContain(
      "description: Starts the application, performs auto-login, and reports back the\n",
    );
  });

  it("does not import global codex prompts into local canonical commands", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["codex"]);

    ensureDir(path.join(paths.homeDir, ".codex", "prompts"));
    writeTextAtomic(
      path.join(paths.homeDir, ".codex", "prompts", "execute-issue.md"),
      "# /execute-issue\n\nGlobal prompt content.\n",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["codex"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.detected).toBe(0);
    expect(summary.entities.command.imported).toBe(0);
    expect(
      fs.existsSync(path.join(paths.commandsDir, "execute-issue.md")),
    ).toBe(false);
  });

  it("imports codex prompts into canonical commands for global scope", async () => {
    const paths = createGlobalPaths();
    initializeCanonicalLayout(paths, ["codex"]);

    ensureDir(path.join(paths.homeDir, ".codex", "prompts"));
    writeTextAtomic(
      path.join(paths.homeDir, ".codex", "prompts", "review.md"),
      "# /review\n\nGlobal codex prompt.\n",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["codex"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.detected).toBe(1);
    expect(summary.entities.command.imported).toBe(1);
    expect(fs.existsSync(path.join(paths.commandsDir, "review.md"))).toBe(true);
  });
});
