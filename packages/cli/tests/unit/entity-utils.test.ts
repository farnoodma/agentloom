import { beforeEach, describe, expect, it, vi } from "vitest";

const scopeMocks = vi.hoisted(() => ({
  resolveScope: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getGlobalSettingsPath: vi.fn(),
  updateLastScope: vi.fn(),
  updateLastScopeBestEffort: vi.fn(),
}));

vi.mock("../../src/core/scope.js", () => ({
  resolveScope: scopeMocks.resolveScope,
}));

vi.mock("../../src/core/settings.js", () => ({
  getGlobalSettingsPath: settingsMocks.getGlobalSettingsPath,
  updateLastScope: settingsMocks.updateLastScope,
  updateLastScopeBestEffort: settingsMocks.updateLastScopeBestEffort,
}));

vi.mock("../../src/sync/index.js", () => ({
  formatSyncSummary: vi.fn(),
  syncFromCanonical: vi.fn(),
}));

import { resolvePathsForCommand } from "../../src/commands/entity-utils.js";

describe("resolvePathsForCommand", () => {
  beforeEach(() => {
    scopeMocks.resolveScope.mockReset();
    settingsMocks.getGlobalSettingsPath.mockReset();
    settingsMocks.updateLastScope.mockReset();
    settingsMocks.updateLastScopeBestEffort.mockReset();
  });

  it("persists global scope selection when resolved scope is global", async () => {
    scopeMocks.resolveScope.mockResolvedValueOnce({
      scope: "global",
      workspaceRoot: "/repo",
      homeDir: "/home/test",
      agentsRoot: "/home/test/.agents",
      agentsDir: "/home/test/.agents/agents",
      commandsDir: "/home/test/.agents/commands",
      skillsDir: "/home/test/.agents/skills",
      mcpPath: "/home/test/.agents/mcp.json",
      lockPath: "/home/test/.agents/agents.lock.json",
      settingsPath: "/home/test/.agents/settings.local.json",
      manifestPath: "/home/test/.agents/.sync-manifest.json",
    });
    settingsMocks.getGlobalSettingsPath.mockReturnValue(
      "/home/test/.agents/settings.local.json",
    );

    await resolvePathsForCommand({ _: [] }, "/repo");

    expect(settingsMocks.updateLastScopeBestEffort).toHaveBeenCalledWith(
      "/home/test/.agents/settings.local.json",
      "global",
    );
  });
});
