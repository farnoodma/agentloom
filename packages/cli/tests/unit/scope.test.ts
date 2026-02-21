import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentloomSettings } from "../../src/types.js";

const promptMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  select: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getGlobalSettingsPath: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: promptMocks.cancel,
  isCancel: promptMocks.isCancel,
  select: promptMocks.select,
}));

vi.mock("../../src/core/settings.js", () => ({
  getGlobalSettingsPath: settingsMocks.getGlobalSettingsPath,
  readSettings: settingsMocks.readSettings,
}));

import { resolveScope } from "../../src/core/scope.js";

const tempDirs: string[] = [];

beforeEach(() => {
  promptMocks.cancel.mockReset();
  promptMocks.isCancel.mockReset();
  promptMocks.isCancel.mockReturnValue(false);
  promptMocks.select.mockReset();

  settingsMocks.getGlobalSettingsPath.mockReset();
  settingsMocks.getGlobalSettingsPath.mockReturnValue(
    "/tmp/.agents/settings.local.json",
  );
  settingsMocks.readSettings.mockReset();
  settingsMocks.readSettings.mockReturnValue({
    version: 1,
    lastScope: "global",
    defaultProviders: [
      "cursor",
      "claude",
      "codex",
      "opencode",
      "gemini",
      "copilot",
    ],
    telemetry: { enabled: true },
  } satisfies AgentloomSettings);
});

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveScope", () => {
  it("defaults to global in non-interactive mode", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    fs.mkdirSync(path.join(workspaceRoot, ".agents"), { recursive: true });

    const paths = await resolveScope({
      cwd: workspaceRoot,
      interactive: false,
    });

    expect(paths.scope).toBe("global");
    expect(promptMocks.select).not.toHaveBeenCalled();
  });

  it("prompts for scope selection in interactive mode", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    promptMocks.select.mockResolvedValueOnce("local");

    const paths = await resolveScope({
      cwd: workspaceRoot,
      interactive: true,
    });

    expect(paths.scope).toBe("local");
    expect(promptMocks.select).toHaveBeenCalledTimes(1);
    expect(promptMocks.select).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: "global",
      }),
    );
  });

  it("uses saved scope as the interactive default", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    fs.mkdirSync(path.join(workspaceRoot, ".agents"), { recursive: true });
    settingsMocks.readSettings.mockReturnValue({
      version: 1,
      lastScope: "local",
      defaultProviders: [
        "cursor",
        "claude",
        "codex",
        "opencode",
        "gemini",
        "copilot",
      ],
      telemetry: { enabled: true },
    } satisfies AgentloomSettings);
    promptMocks.select.mockResolvedValueOnce("global");

    const paths = await resolveScope({
      cwd: workspaceRoot,
      interactive: true,
    });

    expect(paths.scope).toBe("global");
    expect(promptMocks.select).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: "local",
      }),
    );
  });
});
