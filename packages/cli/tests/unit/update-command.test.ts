import type { ParsedArgs } from "minimist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsLockFile, ScopePaths } from "../../src/types.js";

const commandMocks = vi.hoisted(() => ({
  importSource: vi.fn(),
  readLockfile: vi.fn(),
  resolveScope: vi.fn(),
  prepareSource: vi.fn(),
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

vi.mock("../../src/core/lockfile.js", () => ({
  readLockfile: commandMocks.readLockfile,
}));

vi.mock("../../src/core/scope.js", () => ({
  resolveScope: commandMocks.resolveScope,
}));

vi.mock("../../src/core/sources.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/sources.js")
  >("../../src/core/sources.js");
  return {
    ...actual,
    prepareSource: commandMocks.prepareSource,
  };
});

import { runUpdateCommand } from "../../src/commands/update.js";

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

function createLockfile(): AgentsLockFile {
  return {
    version: 1,
    entries: [
      {
        source: "farnoodma/agents",
        sourceType: "github",
        requestedRef: "main",
        requestedAgents: ["issue-creator", "reviewer"],
        resolvedCommit: "old-commit",
        subdir: "packages/agents",
        importedAt: "2026-01-01T00:00:00.000Z",
        importedAgents: ["agents/issue-creator.md"],
        importedCommands: [],
        importedMcpServers: [],
        importedSkills: [],
        contentHash: "hash",
      },
    ],
  };
}

beforeEach(() => {
  commandMocks.importSource.mockReset();
  commandMocks.readLockfile.mockReset();
  commandMocks.resolveScope.mockReset();
  commandMocks.prepareSource.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runUpdateCommand", () => {
  it("replays requestedAgents from lock entries during update imports", async () => {
    const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);
    const paths = createScopePaths();
    const cleanup = vi.fn();

    commandMocks.resolveScope.mockResolvedValue(paths);
    commandMocks.readLockfile.mockReturnValue(createLockfile());
    commandMocks.prepareSource.mockReturnValue({
      spec: { source: "farnoodma/agents", type: "github" as const },
      rootPath: "/tmp/source",
      importRoot: "/tmp/source/packages/agents",
      resolvedCommit: "new-commit",
      cleanup,
    });
    commandMocks.importSource.mockResolvedValue({
      source: "farnoodma/agents",
      sourceType: "github" as const,
      importedAgents: ["agents/issue-creator.md"],
      importedCommands: [],
      importedMcpServers: [],
      importedSkills: [],
      resolvedCommit: "new-commit",
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runUpdateCommand(
      { _: ["update"], "no-sync": true } as ParsedArgs,
      "/workspace",
    );

    expect(commandMocks.resolveScope).toHaveBeenCalledWith({
      cwd: "/workspace",
      global: false,
      local: false,
      interactive: !nonInteractive,
    });
    expect(commandMocks.importSource).toHaveBeenCalledTimes(1);
    expect(commandMocks.importSource).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "farnoodma/agents",
        ref: "main",
        subdir: "packages/agents",
        agents: ["issue-creator", "reviewer"],
        promptForAgentSelection: false,
        promptForCommands: false,
        promptForMcp: false,
        promptForSkills: false,
        yes: false,
        nonInteractive,
        paths,
        importAgents: true,
        requireAgents: true,
        importCommands: true,
        importMcp: true,
      }),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Updated entries: 1");
    expect(output).toContain("Unchanged entries: 0");
  });

  it("skips mcp and skills updates when lock selectors are explicitly empty", async () => {
    const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);
    const paths = createScopePaths();
    const cleanup = vi.fn();

    commandMocks.resolveScope.mockResolvedValue(paths);
    commandMocks.readLockfile.mockReturnValue({
      version: 1,
      entries: [
        {
          source: "farnoodma/agents",
          sourceType: "github",
          requestedRef: "main",
          resolvedCommit: "old-commit",
          importedAt: "2026-01-01T00:00:00.000Z",
          importedAgents: [],
          importedCommands: ["commands/review.md"],
          selectedSourceCommands: ["review.md"],
          importedMcpServers: [],
          selectedSourceMcpServers: [],
          importedSkills: [],
          selectedSourceSkills: [],
          trackedEntities: ["command", "mcp", "skill"],
          contentHash: "hash",
        },
      ],
    } satisfies AgentsLockFile);
    commandMocks.prepareSource.mockReturnValue({
      spec: { source: "farnoodma/agents", type: "github" as const },
      rootPath: "/tmp/source",
      importRoot: "/tmp/source/packages/agents",
      resolvedCommit: "new-commit",
      cleanup,
    });
    commandMocks.importSource.mockResolvedValue({
      source: "farnoodma/agents",
      sourceType: "github" as const,
      importedAgents: [],
      importedCommands: ["commands/review.md"],
      importedMcpServers: [],
      importedSkills: [],
      resolvedCommit: "new-commit",
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runUpdateCommand(
      { _: ["update"], "no-sync": true } as ParsedArgs,
      "/workspace",
    );

    expect(commandMocks.importSource).toHaveBeenCalledTimes(1);
    const importCall = commandMocks.importSource.mock.calls[0]?.[0];
    expect(importCall).toEqual(
      expect.objectContaining({
        importCommands: true,
        commandSelectors: ["review.md"],
        importMcp: false,
      }),
    );
    expect(importCall?.importSkills).toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Updated entries: 1");
    expect(output).toContain("Unchanged entries: 0");
  });
});
