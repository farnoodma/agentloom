import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "minimist";
import type { ScopePaths } from "../../src/types.js";

const commandMocks = vi.hoisted(() => ({
  parseRulesDir: vi.fn(),
  runScopedAddCommand: vi.fn(),
  runScopedDeleteCommand: vi.fn(),
  runScopedUpdateCommand: vi.fn(),
  runScopedFindCommand: vi.fn(),
  runScopedSyncCommand: vi.fn(),
  resolvePathsForCommand: vi.fn(),
}));

vi.mock("../../src/core/rules.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/rules.js")
  >("../../src/core/rules.js");
  return {
    ...actual,
    parseRulesDir: commandMocks.parseRulesDir,
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

const { runRuleCommand } = await import("../../src/commands/rule.js");

function createScopePaths(root = "/tmp/agentloom"): ScopePaths {
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

const paths = createScopePaths();

beforeEach(() => {
  commandMocks.parseRulesDir.mockReset();
  commandMocks.runScopedAddCommand.mockReset();
  commandMocks.runScopedDeleteCommand.mockReset();
  commandMocks.runScopedUpdateCommand.mockReset();
  commandMocks.runScopedFindCommand.mockReset();
  commandMocks.runScopedSyncCommand.mockReset();
  commandMocks.resolvePathsForCommand.mockReset();

  commandMocks.resolvePathsForCommand.mockResolvedValue(paths);
});

describe("runRuleCommand", () => {
  it("lists canonical rules from .agents/rules", async () => {
    commandMocks.parseRulesDir.mockReturnValue([
      {
        id: "always-test",
        name: "Always Test",
        fileName: "always-test.md",
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runRuleCommand({ _: ["rule", "list"] } as ParsedArgs, "/workspace");

    expect(commandMocks.parseRulesDir).toHaveBeenCalledWith(paths.rulesDir);
    expect(logSpy).toHaveBeenCalledWith("Always Test (always-test.md)");
  });

  it("delegates rule find to scoped native find", async () => {
    await runRuleCommand(
      { _: ["rule", "find", "test"] } as ParsedArgs,
      "/workspace",
    );

    expect(commandMocks.runScopedFindCommand).toHaveBeenCalledWith(
      { _: ["rule", "find", "test"] },
      "rule",
    );
  });

  it("delegates rule sync to scoped sync pipeline", async () => {
    await runRuleCommand(
      { _: ["rule", "sync"], yes: true, "dry-run": true } as ParsedArgs,
      "/workspace",
    );

    expect(commandMocks.runScopedSyncCommand).toHaveBeenCalledWith({
      argv: { _: ["rule", "sync"], yes: true, "dry-run": true },
      cwd: "/workspace",
      target: "rule",
    });
  });

  it("throws usage error for unknown rule actions", async () => {
    await expect(
      runRuleCommand({ _: ["rule", "bogus"] } as ParsedArgs, "/workspace"),
    ).rejects.toThrow(/Invalid rule command/);
    expect(commandMocks.runScopedSyncCommand).not.toHaveBeenCalled();
  });
});
