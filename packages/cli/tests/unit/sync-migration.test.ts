import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "minimist";
import type { ScopePaths } from "../../src/types.js";

const commandMocks = vi.hoisted(() => ({
  resolvePathsForCommand: vi.fn(),
  resolveScopeForSync: vi.fn(),
  hasInitializedCanonicalLayout: vi.fn(),
  resolveProvidersForSync: vi.fn(),
  initializeCanonicalLayout: vi.fn(),
  migrateProviderStateToCanonical: vi.fn(),
  formatMigrationSummary: vi.fn(),
  syncFromCanonical: vi.fn(),
  formatSyncSummary: vi.fn(),
}));

vi.mock("../../src/commands/entity-utils.js", () => ({
  resolvePathsForCommand: commandMocks.resolvePathsForCommand,
  getNonInteractiveMode: vi.fn(() => true),
}));

vi.mock("../../src/core/scope.js", () => ({
  resolveScopeForSync: commandMocks.resolveScopeForSync,
  hasInitializedCanonicalLayout: commandMocks.hasInitializedCanonicalLayout,
}));

vi.mock("../../src/core/migration.js", () => ({
  initializeCanonicalLayout: commandMocks.initializeCanonicalLayout,
  migrateProviderStateToCanonical: commandMocks.migrateProviderStateToCanonical,
  formatMigrationSummary: commandMocks.formatMigrationSummary,
  MigrationConflictError: class MigrationConflictError extends Error {},
}));

vi.mock("../../src/sync/index.js", () => ({
  resolveProvidersForSync: commandMocks.resolveProvidersForSync,
  syncFromCanonical: commandMocks.syncFromCanonical,
  formatSyncSummary: commandMocks.formatSyncSummary,
}));

const { runScopedSyncCommand } = await import("../../src/commands/sync.js");

function createScopePaths(root: string): ScopePaths {
  return {
    scope: "local",
    workspaceRoot: root,
    homeDir: root,
    agentsRoot: `${root}/.agents`,
    agentsDir: `${root}/.agents/agents`,
    commandsDir: `${root}/.agents/commands`,
    rulesDir: `${root}/.agents/rules`,
    skillsDir: `${root}/.agents/skills`,
    mcpPath: `${root}/.agents/mcp.json`,
    lockPath: `${root}/.agents/agents.lock.json`,
    settingsPath: `${root}/.agents/settings.local.json`,
    manifestPath: `${root}/.agents/.sync-manifest.json`,
  };
}

let tempRoot = "";
let paths: ScopePaths;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sync-test-"));
  paths = createScopePaths(tempRoot);
  fs.mkdirSync(paths.agentsRoot, { recursive: true });

  commandMocks.resolvePathsForCommand.mockReset();
  commandMocks.resolveScopeForSync.mockReset();
  commandMocks.hasInitializedCanonicalLayout.mockReset();
  commandMocks.resolveProvidersForSync.mockReset();
  commandMocks.initializeCanonicalLayout.mockReset();
  commandMocks.migrateProviderStateToCanonical.mockReset();
  commandMocks.formatMigrationSummary.mockReset();
  commandMocks.syncFromCanonical.mockReset();
  commandMocks.formatSyncSummary.mockReset();

  commandMocks.resolvePathsForCommand.mockResolvedValue(paths);
  commandMocks.resolveScopeForSync.mockResolvedValue(paths);
  commandMocks.hasInitializedCanonicalLayout.mockReturnValue(true);
  commandMocks.resolveProvidersForSync.mockResolvedValue(["cursor"]);
  commandMocks.migrateProviderStateToCanonical.mockResolvedValue({
    providers: ["cursor"],
    target: "all",
    entities: {
      agent: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      command: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      mcp: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      rule: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      skill: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
    },
  });
  commandMocks.formatMigrationSummary.mockReturnValue("migration summary");
  commandMocks.syncFromCanonical.mockResolvedValue({
    providers: ["cursor"],
    generatedFiles: [],
    removedFiles: [],
  });
  commandMocks.formatSyncSummary.mockReturnValue("sync summary");
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("sync command pipeline", () => {
  it("runs provider sync without migration when canonical config exists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScopedSyncCommand({
      argv: { _: ["sync"], yes: true } as ParsedArgs,
      cwd: "/workspace",
      target: "all",
    });

    expect(commandMocks.resolveScopeForSync).toHaveBeenCalledWith({
      cwd: "/workspace",
      global: false,
      local: false,
      interactive: false,
    });
    expect(commandMocks.initializeCanonicalLayout).toHaveBeenCalledWith(paths, [
      "cursor",
    ]);
    expect(commandMocks.migrateProviderStateToCanonical).not.toHaveBeenCalled();
    expect(commandMocks.syncFromCanonical).toHaveBeenCalledWith({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
      dryRun: false,
      target: "all",
    });
    expect(logSpy).toHaveBeenCalledWith("sync summary");
    expect(logSpy).not.toHaveBeenCalledWith("migration summary");
  });

  it("supports migration for init --no-sync", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScopedSyncCommand({
      argv: { _: ["init"], yes: true } as ParsedArgs,
      cwd: "/workspace",
      target: "all",
      skipSync: true,
      migrateProviderState: true,
    });

    expect(commandMocks.migrateProviderStateToCanonical).toHaveBeenCalledWith({
      paths,
      providers: ["cursor"],
      target: "all",
      yes: true,
      nonInteractive: true,
      dryRun: false,
      materializeCanonical: false,
    });
    expect(commandMocks.syncFromCanonical).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("migration summary");
  });

  it("uses an ephemeral canonical path for dry-run previews", async () => {
    await runScopedSyncCommand({
      argv: { _: ["sync"], yes: true, "dry-run": true } as ParsedArgs,
      cwd: "/workspace",
      target: "all",
    });

    const initializeCall =
      commandMocks.initializeCanonicalLayout.mock.calls.at(-1)?.[0];
    const syncCall = commandMocks.syncFromCanonical.mock.calls.at(-1)?.[0];

    expect(commandMocks.migrateProviderStateToCanonical).not.toHaveBeenCalled();
    expect(initializeCall?.agentsRoot).not.toBe(paths.agentsRoot);
    expect(syncCall?.paths.agentsRoot).toBe(initializeCall?.agentsRoot);
    expect(syncCall?.dryRun).toBe(true);
  });

  it("fails before provider resolution when sync scope cannot be resolved", async () => {
    commandMocks.resolveScopeForSync.mockRejectedValueOnce(
      new Error("No initialized canonical .agents state found."),
    );

    await expect(
      runScopedSyncCommand({
        argv: { _: ["sync"] } as ParsedArgs,
        cwd: "/workspace",
        target: "all",
      }),
    ).rejects.toThrow("No initialized canonical .agents state found.");

    expect(commandMocks.resolveProvidersForSync).not.toHaveBeenCalled();
  });

  it("fails sync when canonical .agents does not exist yet", async () => {
    commandMocks.hasInitializedCanonicalLayout.mockReturnValue(false);

    await expect(
      runScopedSyncCommand({
        argv: { _: ["sync"], yes: true } as ParsedArgs,
        cwd: "/workspace",
        target: "all",
      }),
    ).rejects.toThrow(
      `No initialized canonical .agents state found at ${paths.agentsRoot}.`,
    );
    await expect(
      runScopedSyncCommand({
        argv: { _: ["sync"], yes: true } as ParsedArgs,
        cwd: "/workspace",
        target: "all",
      }),
    ).rejects.toThrow("agentloom init --local");

    expect(commandMocks.initializeCanonicalLayout).not.toHaveBeenCalled();
    expect(commandMocks.syncFromCanonical).not.toHaveBeenCalled();
  });
});
