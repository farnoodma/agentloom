import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  runAddCommand: vi.fn(),
  runAgentCommand: vi.fn(),
  runCommandCommand: vi.fn(),
  runDeleteCommand: vi.fn(),
  runFindCommand: vi.fn(),
  runMcpCommand: vi.fn(),
  runSkillCommand: vi.fn(),
  runSyncCommand: vi.fn(),
  runUpdateCommand: vi.fn(),
}));

const bootstrapMocks = vi.hoisted(() => ({
  maybePromptManageAgentsBootstrap: vi.fn(),
}));

const notifierMocks = vi.hoisted(() => ({
  maybeNotifyVersionUpdate: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getGlobalSettingsPath: vi.fn(),
  readSettings: vi.fn(),
}));

const scopeMocks = vi.hoisted(() => ({
  buildScopePaths: vi.fn(),
}));

vi.mock("../../src/commands/add.js", () => ({
  runAddCommand: commandMocks.runAddCommand,
}));
vi.mock("../../src/commands/agent.js", () => ({
  runAgentCommand: commandMocks.runAgentCommand,
}));
vi.mock("../../src/commands/command.js", () => ({
  runCommandCommand: commandMocks.runCommandCommand,
}));
vi.mock("../../src/commands/delete.js", () => ({
  runDeleteCommand: commandMocks.runDeleteCommand,
}));
vi.mock("../../src/commands/find.js", () => ({
  runFindCommand: commandMocks.runFindCommand,
}));
vi.mock("../../src/commands/mcp.js", () => ({
  runMcpCommand: commandMocks.runMcpCommand,
}));
vi.mock("../../src/commands/skills.js", () => ({
  runSkillCommand: commandMocks.runSkillCommand,
}));
vi.mock("../../src/commands/sync.js", () => ({
  runSyncCommand: commandMocks.runSyncCommand,
}));
vi.mock("../../src/commands/update.js", () => ({
  runUpdateCommand: commandMocks.runUpdateCommand,
}));
vi.mock("../../src/core/manage-agents-bootstrap.js", () => ({
  maybePromptManageAgentsBootstrap:
    bootstrapMocks.maybePromptManageAgentsBootstrap,
}));
vi.mock("../../src/core/version-notifier.js", () => ({
  maybeNotifyVersionUpdate: notifierMocks.maybeNotifyVersionUpdate,
}));
vi.mock("../../src/core/version.js", () => ({
  getCliVersion: () => "0.0.0-test",
}));
vi.mock("../../src/core/settings.js", () => ({
  getGlobalSettingsPath: settingsMocks.getGlobalSettingsPath,
  readSettings: settingsMocks.readSettings,
}));
vi.mock("../../src/core/scope.js", () => ({
  buildScopePaths: scopeMocks.buildScopePaths,
}));

const { runCli } = await import("../../src/cli.js");

beforeEach(() => {
  commandMocks.runAddCommand.mockReset();
  commandMocks.runAddCommand.mockResolvedValue(undefined);
  commandMocks.runAgentCommand.mockReset();
  commandMocks.runAgentCommand.mockResolvedValue(undefined);
  commandMocks.runCommandCommand.mockReset();
  commandMocks.runCommandCommand.mockResolvedValue(undefined);
  commandMocks.runDeleteCommand.mockReset();
  commandMocks.runDeleteCommand.mockResolvedValue(undefined);
  commandMocks.runFindCommand.mockReset();
  commandMocks.runFindCommand.mockResolvedValue(undefined);
  commandMocks.runMcpCommand.mockReset();
  commandMocks.runMcpCommand.mockResolvedValue(undefined);
  commandMocks.runSkillCommand.mockReset();
  commandMocks.runSkillCommand.mockResolvedValue(undefined);
  commandMocks.runSyncCommand.mockReset();
  commandMocks.runSyncCommand.mockResolvedValue(undefined);
  commandMocks.runUpdateCommand.mockReset();
  commandMocks.runUpdateCommand.mockResolvedValue(undefined);

  bootstrapMocks.maybePromptManageAgentsBootstrap.mockReset();
  bootstrapMocks.maybePromptManageAgentsBootstrap.mockResolvedValue(false);

  notifierMocks.maybeNotifyVersionUpdate.mockReset();
  notifierMocks.maybeNotifyVersionUpdate.mockResolvedValue(undefined);

  settingsMocks.getGlobalSettingsPath.mockReset();
  settingsMocks.getGlobalSettingsPath.mockReturnValue(
    "/mock/home/.agents/settings.local.json",
  );
  settingsMocks.readSettings.mockReset();
  settingsMocks.readSettings.mockReturnValue({
    version: 1,
    defaultProviders: [
      "cursor",
      "claude",
      "codex",
      "opencode",
      "gemini",
      "copilot",
    ],
  });

  scopeMocks.buildScopePaths.mockReset();
  scopeMocks.buildScopePaths.mockReturnValue({
    settingsPath: "/mock/local/.agents/settings.local.json",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("manage-agents bootstrap in CLI", () => {
  it("runs bootstrap install only after the routed command completes", async () => {
    bootstrapMocks.maybePromptManageAgentsBootstrap.mockResolvedValue(true);

    const order: string[] = [];
    commandMocks.runFindCommand.mockImplementation(async () => {
      order.push("find");
    });
    commandMocks.runSkillCommand.mockImplementation(async () => {
      order.push("bootstrap-install");
    });

    await runCli([
      "find",
      "reviewer",
      "--local",
      "--providers",
      "codex,claude",
      "--no-sync",
    ]);

    expect(order).toEqual(["find", "bootstrap-install"]);
    expect(commandMocks.runSkillCommand).toHaveBeenCalledTimes(1);
    expect(commandMocks.runAddCommand).not.toHaveBeenCalled();

    const [bootstrapArgv] = commandMocks.runSkillCommand.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(bootstrapArgv._).toEqual(["skill", "add", "farnoodma/agentloom"]);
    expect(bootstrapArgv.skills).toBe("manage-agents");
    expect(bootstrapArgv.local).toBe(true);
    expect(bootstrapArgv.providers).toBe("codex,claude");
    expect(bootstrapArgv["no-sync"]).toBe(true);
  });

  it("reuses inferred scope/providers for deferred bootstrap install", async () => {
    bootstrapMocks.maybePromptManageAgentsBootstrap.mockResolvedValue(true);
    settingsMocks.readSettings.mockImplementation((settingsPath: string) => {
      if (settingsPath === "/mock/home/.agents/settings.local.json") {
        return {
          version: 1,
          lastScope: "global",
          defaultProviders: ["cursor"],
        };
      }
      if (settingsPath === "/mock/global/.agents/settings.local.json") {
        return {
          version: 1,
          defaultProviders: ["codex", "gemini"],
        };
      }
      return {
        version: 1,
        defaultProviders: ["cursor"],
      };
    });
    scopeMocks.buildScopePaths.mockReturnValue({
      settingsPath: "/mock/global/.agents/settings.local.json",
    });

    await runCli(["sync"]);

    expect(commandMocks.runSyncCommand).toHaveBeenCalledTimes(1);
    expect(commandMocks.runSkillCommand).toHaveBeenCalledTimes(1);
    expect(commandMocks.runAddCommand).not.toHaveBeenCalled();

    const [bootstrapArgv] = commandMocks.runSkillCommand.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(bootstrapArgv._).toEqual(["skill", "add", "farnoodma/agentloom"]);
    expect(bootstrapArgv.skills).toBe("manage-agents");
    expect(bootstrapArgv.global).toBe(true);
    expect(bootstrapArgv.providers).toBe("codex,gemini");
  });
});
