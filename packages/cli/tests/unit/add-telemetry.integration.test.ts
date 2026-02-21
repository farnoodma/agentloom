import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseArgs } from "../../src/core/argv.js";
import type { ImportSummary } from "../../src/core/importer.js";

const summary: ImportSummary = {
  source: "farnoodma/agents",
  sourceType: "github",
  resolvedCommit: "abc123",
  importedAgents: ["agents/reviewer.md"],
  importedCommands: ["commands/release.md"],
  importedMcpServers: ["browser"],
  importedSkills: [],
};

const importSourceMock = vi.fn(async () => summary);

vi.mock("../../src/core/importer.js", () => ({
  importSource: importSourceMock,
  NonInteractiveConflictError: class NonInteractiveConflictError extends Error {},
}));

vi.mock("../../src/commands/entity-utils.js", () => ({
  getEntitySelectors: () => [],
  getNonInteractiveMode: () => true,
  markScopeAsUsed: () => undefined,
  resolvePathsForCommand: async () => ({
    scope: "local",
    workspaceRoot: "/tmp",
    agentsRoot: "/tmp/.agents",
    agentsDir: "/tmp/.agents/agents",
    commandsDir: "/tmp/.agents/commands",
    skillsDir: "/tmp/.agents/skills",
    mcpPath: "/tmp/.agents/mcp.json",
    lockPath: "/tmp/.agents/agents.lock.json",
    manifestPath: "/tmp/.agents/.sync-manifest.json",
    settingsPath: "/tmp/.agents/settings.local.json",
  }),
  runPostMutationSync: async () => undefined,
}));

const { runAddCommand } = await import("../../src/commands/add.js");

describe("runAddCommand telemetry integration", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    importSourceMock.mockClear();
    delete process.env.AGENTLOOM_DISABLE_TELEMETRY;
    delete process.env.AGENTLOOM_TELEMETRY_ENDPOINT;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends telemetry for github sources", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 202 }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await runAddCommand(
      parseArgs(["add", "farnoodma/agents", "--local", "--yes", "--no-sync"]),
      "/tmp",
    );

    expect(importSourceMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fail add flow when telemetry request errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      runAddCommand(
        parseArgs(["add", "farnoodma/agents", "--local", "--yes", "--no-sync"]),
        "/tmp",
      ),
    ).resolves.toBeUndefined();
  });
});
