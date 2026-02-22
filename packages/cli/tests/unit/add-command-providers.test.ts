import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../src/core/argv.js";
import type { ImportSummary } from "../../src/core/importer.js";
import type { ScopePaths } from "../../src/types.js";

const commandMocks = vi.hoisted(() => ({
  importSource: vi.fn(),
  resolveProvidersForSync: vi.fn(),
  runPostMutationSync: vi.fn(),
}));

vi.mock("../../src/core/importer.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/importer.js")
  >("../../src/core/importer.js");
  return {
    ...actual,
    importSource: commandMocks.importSource,
  };
});

vi.mock("../../src/sync/index.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/sync/index.js")
  >("../../src/sync/index.js");
  return {
    ...actual,
    resolveProvidersForSync: commandMocks.resolveProvidersForSync,
  };
});

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

vi.mock("../../src/commands/entity-utils.js", () => ({
  getEntitySelectors: () => [],
  getNonInteractiveMode: () => false,
  resolvePathsForCommand: async () => paths,
  runPostMutationSync: commandMocks.runPostMutationSync,
}));

const { runAddCommand } = await import("../../src/commands/add.js");

const summaryWithSkills: ImportSummary = {
  source: "farnoodma/agents",
  sourceType: "github",
  resolvedCommit: "abc123",
  importedAgents: [],
  importedCommands: [],
  importedMcpServers: [],
  importedSkills: ["release-check"],
};

interface ImportSourceOptionsLike {
  skillsProviders?: string[];
  resolveSkillsProviders?: () => Promise<string[] | undefined>;
}

beforeEach(() => {
  process.env.AGENTLOOM_DISABLE_TELEMETRY = "1";
  commandMocks.importSource.mockReset();
  commandMocks.resolveProvidersForSync.mockReset();
  commandMocks.runPostMutationSync.mockReset();
  commandMocks.runPostMutationSync.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.AGENTLOOM_DISABLE_TELEMETRY;
  vi.restoreAllMocks();
});

describe("runAddCommand provider handling for skills", () => {
  it("resolves providers before skills install and reuses them for sync", async () => {
    commandMocks.resolveProvidersForSync.mockResolvedValue(["codex", "claude"]);
    commandMocks.importSource.mockImplementationOnce(
      async (options: ImportSourceOptionsLike) => {
        expect(options.skillsProviders).toBeUndefined();
        expect(typeof options.resolveSkillsProviders).toBe("function");
        await expect(options.resolveSkillsProviders?.()).resolves.toEqual([
          "codex",
          "claude",
        ]);
        return summaryWithSkills;
      },
    );

    await runAddCommand(
      parseArgs(["add", "farnoodma/agents", "--local"]),
      "/workspace",
    );

    expect(commandMocks.resolveProvidersForSync).toHaveBeenCalledTimes(1);
    expect(commandMocks.resolveProvidersForSync).toHaveBeenCalledWith({
      paths,
      explicitProviders: undefined,
      nonInteractive: false,
    });
    expect(commandMocks.runPostMutationSync).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "all",
        providers: ["codex", "claude"],
      }),
    );
  });

  it("passes explicit providers to skills install and skips provider resolution prompt", async () => {
    commandMocks.importSource.mockImplementationOnce(
      async (options: ImportSourceOptionsLike) => {
        expect(options.skillsProviders).toEqual(["codex", "claude"]);
        expect(options.resolveSkillsProviders).toBeUndefined();
        return summaryWithSkills;
      },
    );

    await runAddCommand(
      parseArgs([
        "add",
        "farnoodma/agents",
        "--local",
        "--providers",
        "codex,claude",
      ]),
      "/workspace",
    );

    expect(commandMocks.resolveProvidersForSync).not.toHaveBeenCalled();
    expect(commandMocks.runPostMutationSync).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "all",
        providers: ["codex", "claude"],
      }),
    );
  });
});
