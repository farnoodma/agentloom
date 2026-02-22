import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildInstallTelemetryPayload,
  buildTelemetryItems,
  parseGitHubSource,
  sendAddTelemetryEvent,
} from "../../src/core/telemetry.js";
import type { ImportSummary } from "../../src/core/importer.js";

const summary: ImportSummary = {
  source: "farnoodma/agents",
  sourceType: "github",
  resolvedCommit: "abc123",
  importedAgents: ["agents/reviewer.md"],
  importedCommands: ["commands/release.md"],
  importedMcpServers: ["browser"],
  importedSkills: ["release-gate"],
  telemetrySkills: [
    {
      name: "release-check",
      filePath: "skills/release-check/SKILL.md",
    },
  ],
};

describe("parseGitHubSource", () => {
  it("parses owner/repo slugs", () => {
    expect(parseGitHubSource("farnoodma/agents")).toEqual({
      owner: "farnoodma",
      repo: "agents",
    });
  });

  it("parses https GitHub URLs", () => {
    expect(
      parseGitHubSource("https://github.com/farnoodma/agents.git"),
    ).toEqual({
      owner: "farnoodma",
      repo: "agents",
    });
  });

  it("parses ssh GitHub URLs", () => {
    expect(parseGitHubSource("git@github.com:farnoodma/agents.git")).toEqual({
      owner: "farnoodma",
      repo: "agents",
    });
  });

  it("returns null for local paths", () => {
    expect(parseGitHubSource("./my-local-agents")).toBeNull();
  });
});

describe("buildTelemetryItems", () => {
  it("includes agents, skills, commands, and mcp", () => {
    expect(buildTelemetryItems(summary)).toEqual([
      { entityType: "agent", name: "reviewer", filePath: "agents/reviewer.md" },
      {
        entityType: "command",
        name: "release",
        filePath: "commands/release.md",
      },
      { entityType: "mcp", name: "browser", filePath: "mcp.json" },
      {
        entityType: "skill",
        name: "release-check",
        filePath: "skills/release-check/SKILL.md",
      },
    ]);
  });

  it("falls back to canonical target paths when skill telemetry metadata is absent", () => {
    expect(
      buildTelemetryItems({
        ...summary,
        telemetrySkills: undefined,
        importedSkills: ["release-gate"],
      }),
    ).toContainEqual({
      entityType: "skill",
      name: "release-gate",
      filePath: "skills/release-gate/SKILL.md",
    });
  });

  it("builds payload metadata", () => {
    const payload = buildInstallTelemetryPayload({
      source: { owner: "farnoodma", repo: "agents" },
      summary,
    });

    expect(payload.source).toEqual({ owner: "farnoodma", repo: "agents" });
    expect(payload.items).toHaveLength(4);
    expect(payload.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("sendAddTelemetryEvent", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.AGENTLOOM_DISABLE_TELEMETRY;
    delete process.env.AGENTLOOM_TELEMETRY_ENDPOINT;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("skips telemetry when disabled", async () => {
    process.env.AGENTLOOM_DISABLE_TELEMETRY = "1";
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendAddTelemetryEvent({ rawSource: "farnoodma/agents", summary });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is fail-open when network fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      sendAddTelemetryEvent({
        rawSource: "farnoodma/agents",
        summary,
      }),
    ).resolves.toBeUndefined();
  });
});
