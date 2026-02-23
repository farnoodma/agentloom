import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "minimist";

const commandMocks = vi.hoisted(() => ({
  runScopedSyncCommand: vi.fn(),
}));

vi.mock("../../src/commands/sync.js", () => ({
  runScopedSyncCommand: commandMocks.runScopedSyncCommand,
}));

const { runInitCommand } = await import("../../src/commands/init.js");

beforeEach(() => {
  commandMocks.runScopedSyncCommand.mockReset();
});

describe("runInitCommand", () => {
  it("prints init help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runInitCommand(
      { _: ["init"], help: true } as ParsedArgs,
      "/workspace",
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("agentloom init [options]"),
    );
    expect(commandMocks.runScopedSyncCommand).not.toHaveBeenCalled();
  });

  it("runs sync pipeline with optional --no-sync", async () => {
    await runInitCommand(
      { _: ["init"], "no-sync": true, yes: true } as ParsedArgs,
      "/workspace",
    );

    expect(commandMocks.runScopedSyncCommand).toHaveBeenCalledWith({
      argv: { _: ["init"], "no-sync": true, yes: true },
      cwd: "/workspace",
      target: "all",
      skipSync: true,
    });
  });
});
