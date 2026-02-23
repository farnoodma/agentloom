import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "minimist";
import type { ScopePaths } from "../../src/types.js";

const commandMocks = vi.hoisted(() => ({
  parseSkillsDir: vi.fn(),
  runScopedAddCommand: vi.fn(),
  runScopedDeleteCommand: vi.fn(),
  runScopedUpdateCommand: vi.fn(),
  runScopedFindCommand: vi.fn(),
  runScopedSyncCommand: vi.fn(),
  resolvePathsForCommand: vi.fn(),
}));

vi.mock("../../src/core/skills.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/skills.js")
  >("../../src/core/skills.js");
  return {
    ...actual,
    parseSkillsDir: commandMocks.parseSkillsDir,
  };
});

vi.mock("../../src/commands/add.js", () => ({
  runScopedAddCommand: commandMocks.runScopedAddCommand,
}));

vi.mock("../../src/commands/delete.js", () => ({
  runScopedDeleteCommand: commandMocks.runScopedDeleteCommand,
}));

vi.mock("../../src/commands/update.js", () => ({
  runScopedUpdateCommand: commandMocks.runScopedUpdateCommand,
}));

vi.mock("../../src/commands/find.js", () => ({
  runScopedFindCommand: commandMocks.runScopedFindCommand,
}));

vi.mock("../../src/commands/sync.js", () => ({
  runScopedSyncCommand: commandMocks.runScopedSyncCommand,
}));

vi.mock("../../src/commands/entity-utils.js", () => ({
  resolvePathsForCommand: commandMocks.resolvePathsForCommand,
}));

const { runSkillCommand } = await import("../../src/commands/skills.js");

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
  commandMocks.parseSkillsDir.mockReset();
  commandMocks.runScopedAddCommand.mockReset();
  commandMocks.runScopedDeleteCommand.mockReset();
  commandMocks.runScopedUpdateCommand.mockReset();
  commandMocks.runScopedFindCommand.mockReset();
  commandMocks.runScopedSyncCommand.mockReset();
  commandMocks.resolvePathsForCommand.mockReset();

  commandMocks.resolvePathsForCommand.mockResolvedValue(paths);
});

describe("runSkillCommand", () => {
  it("lists canonical skills from .agents/skills", async () => {
    commandMocks.parseSkillsDir.mockReturnValue([
      {
        name: "release-check",
        sourcePath: "/tmp/agentloom/.agents/skills/release-check",
        skillPath: "/tmp/agentloom/.agents/skills/release-check/SKILL.md",
        layout: "nested",
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runSkillCommand({ _: ["skill", "list"] } as ParsedArgs, "/workspace");

    expect(commandMocks.parseSkillsDir).toHaveBeenCalledWith(paths.skillsDir);
    expect(logSpy).toHaveBeenCalledWith("release-check (release-check)");
  });

  it("delegates skill find to scoped native find", async () => {
    await runSkillCommand(
      { _: ["skill", "find", "release"] } as ParsedArgs,
      "/workspace",
    );

    expect(commandMocks.runScopedFindCommand).toHaveBeenCalledWith(
      { _: ["skill", "find", "release"] },
      "skill",
    );
  });

  it("delegates skill sync to scoped sync pipeline", async () => {
    await runSkillCommand(
      { _: ["skill", "sync"], yes: true, "dry-run": true } as ParsedArgs,
      "/workspace",
    );

    expect(commandMocks.runScopedSyncCommand).toHaveBeenCalledWith({
      argv: { _: ["skill", "sync"], yes: true, "dry-run": true },
      cwd: "/workspace",
      target: "skill",
    });
  });

  it("throws usage error for unknown skill actions", async () => {
    await expect(
      runSkillCommand({ _: ["skill", "bogus"] } as ParsedArgs, "/workspace"),
    ).rejects.toThrow(/Invalid skill command/);
    expect(commandMocks.runScopedSyncCommand).not.toHaveBeenCalled();
  });
});
