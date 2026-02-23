import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "minimist";
import type { ScopePaths } from "../../src/types.js";

const commandMocks = vi.hoisted(() => ({
  resolvePathsForCommand: vi.fn(),
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

function createScopePaths(root = "/tmp/agentloom"): ScopePaths {
  return {
    scope: "local",
    workspaceRoot: root,
    homeDir: root,
    agentsRoot: `${root}/.agents`,
    agentsDir: `${root}/.agents/agents`,
    commandsDir: `${root}/.agents/commands`,
    skillsDir: `${root}/.agents/skills`,
    mcpPath: `${root}/.agents/mcp.json`,
    lockPath: `${root}/.agents/agents.lock.json`,
    settingsPath: `${root}/.agents/settings.local.json`,
    manifestPath: `${root}/.agents/.sync-manifest.json`,
  };
}

const paths = createScopePaths();

beforeEach(() => {
  commandMocks.resolvePathsForCommand.mockReset();
  commandMocks.resolveProvidersForSync.mockReset();
  commandMocks.initializeCanonicalLayout.mockReset();
  commandMocks.migrateProviderStateToCanonical.mockReset();
  commandMocks.formatMigrationSummary.mockReset();
  commandMocks.syncFromCanonical.mockReset();
  commandMocks.formatSyncSummary.mockReset();

  commandMocks.resolvePathsForCommand.mockResolvedValue(paths);
  commandMocks.resolveProvidersForSync.mockResolvedValue(["cursor"]);
  commandMocks.migrateProviderStateToCanonical.mockResolvedValue({
    providers: ["cursor"],
    target: "all",
    entities: {
      agent: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      command: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      mcp: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
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

describe("sync migration pipeline", () => {
  it("runs migration before sync", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScopedSyncCommand({
      argv: { _: ["sync"], yes: true } as ParsedArgs,
      cwd: "/workspace",
      target: "all",
    });

    expect(commandMocks.initializeCanonicalLayout).toHaveBeenCalledWith(paths, [
      "cursor",
    ]);
    expect(commandMocks.migrateProviderStateToCanonical).toHaveBeenCalledWith({
      paths,
      providers: ["cursor"],
      target: "all",
      yes: true,
      nonInteractive: true,
      dryRun: false,
      materializeCanonical: false,
    });
    expect(commandMocks.syncFromCanonical).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("migration summary");
    expect(logSpy).toHaveBeenCalledWith("sync summary");
  });

  it("supports skipSync for init --no-sync", async () => {
    await runScopedSyncCommand({
      argv: { _: ["init"], yes: true } as ParsedArgs,
      cwd: "/workspace",
      target: "all",
      skipSync: true,
    });

    expect(commandMocks.migrateProviderStateToCanonical).toHaveBeenCalled();
    expect(commandMocks.syncFromCanonical).not.toHaveBeenCalled();
  });

  it("uses an ephemeral canonical path for dry-run previews", async () => {
    await runScopedSyncCommand({
      argv: { _: ["sync"], yes: true, "dry-run": true } as ParsedArgs,
      cwd: "/workspace",
      target: "all",
    });

    expect(commandMocks.migrateProviderStateToCanonical).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: ["cursor"],
        dryRun: true,
        materializeCanonical: true,
      }),
    );

    const migrationCall =
      commandMocks.migrateProviderStateToCanonical.mock.calls.at(-1)?.[0];
    const syncCall = commandMocks.syncFromCanonical.mock.calls.at(-1)?.[0];

    expect(migrationCall?.paths.agentsRoot).not.toBe(paths.agentsRoot);
    expect(syncCall?.paths.agentsRoot).toBe(migrationCall?.paths.agentsRoot);
    expect(syncCall?.dryRun).toBe(true);
  });
});
