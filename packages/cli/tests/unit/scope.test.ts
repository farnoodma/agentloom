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
import { resolveScopeForSync } from "../../src/core/scope.js";

const tempDirs: string[] = [];
let homedirSpy: ReturnType<typeof vi.spyOn>;

function writeInitializedCanonicalMarker(root: string): void {
  const agentsRoot = path.join(root, ".agents");
  fs.mkdirSync(agentsRoot, { recursive: true });
  fs.writeFileSync(
    path.join(agentsRoot, "mcp.json"),
    JSON.stringify({ version: 1, mcpServers: {} }, null, 2),
    "utf8",
  );
}

function writeSettingsOnlyMarker(root: string): void {
  const agentsRoot = path.join(root, ".agents");
  fs.mkdirSync(agentsRoot, { recursive: true });
  fs.writeFileSync(
    path.join(agentsRoot, "settings.local.json"),
    JSON.stringify({ version: 1, lastScope: "global" }, null, 2),
    "utf8",
  );
}

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

  homedirSpy = vi.spyOn(os, "homedir");
});

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  homedirSpy.mockRestore();
});

describe("resolveScope", () => {
  it("defaults to local in non-interactive mode when .agents exists", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    fs.mkdirSync(path.join(workspaceRoot, ".agents"), { recursive: true });

    const paths = await resolveScope({
      cwd: workspaceRoot,
      interactive: false,
    });

    expect(paths.scope).toBe("local");
    expect(promptMocks.select).not.toHaveBeenCalled();
  });

  it("defaults to global in non-interactive mode without .agents", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

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

describe("resolveScopeForSync", () => {
  it("fails before prompting when no canonical scope exists", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeRoot);
    homedirSpy.mockReturnValue(homeRoot);

    await expect(
      resolveScopeForSync({
        cwd: workspaceRoot,
        interactive: true,
      }),
    ).rejects.toThrow(
      `No initialized canonical .agents state found at ${path.join(workspaceRoot, ".agents")} or ${path.join(homeRoot, ".agents")}.`,
    );

    expect(promptMocks.select).not.toHaveBeenCalled();
  });

  it("skips the scope prompt when only one canonical scope exists", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeRoot);
    homedirSpy.mockReturnValue(homeRoot);

    writeInitializedCanonicalMarker(homeRoot);

    const paths = await resolveScopeForSync({
      cwd: workspaceRoot,
      interactive: true,
    });

    expect(paths.scope).toBe("global");
    expect(promptMocks.select).not.toHaveBeenCalled();
  });

  it("ignores settings-only scope markers", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeRoot);
    homedirSpy.mockReturnValue(homeRoot);

    writeSettingsOnlyMarker(homeRoot);

    await expect(
      resolveScopeForSync({
        cwd: workspaceRoot,
        interactive: true,
      }),
    ).rejects.toThrow(
      `No initialized canonical .agents state found at ${path.join(workspaceRoot, ".agents")} or ${path.join(homeRoot, ".agents")}.`,
    );
  });

  it("keeps placeholder .agents directories on local scope in non-interactive mode", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeRoot);
    homedirSpy.mockReturnValue(homeRoot);

    fs.mkdirSync(path.join(workspaceRoot, ".agents"), { recursive: true });
    writeInitializedCanonicalMarker(homeRoot);

    const paths = await resolveScopeForSync({
      cwd: workspaceRoot,
      interactive: false,
    });

    expect(paths.scope).toBe("local");
  });

  it("prompts when a placeholder local .agents exists alongside global canonical state", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeRoot);
    homedirSpy.mockReturnValue(homeRoot);

    fs.mkdirSync(path.join(workspaceRoot, ".agents"), { recursive: true });
    writeInitializedCanonicalMarker(homeRoot);
    promptMocks.select.mockResolvedValueOnce("global");

    const paths = await resolveScopeForSync({
      cwd: workspaceRoot,
      interactive: true,
    });

    expect(paths.scope).toBe("global");
    expect(promptMocks.select).toHaveBeenCalledTimes(1);
  });

  it("prompts when both canonical scopes exist", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeRoot);
    homedirSpy.mockReturnValue(homeRoot);

    writeInitializedCanonicalMarker(workspaceRoot);
    writeInitializedCanonicalMarker(homeRoot);
    promptMocks.select.mockResolvedValueOnce("local");

    const paths = await resolveScopeForSync({
      cwd: workspaceRoot,
      interactive: true,
    });

    expect(paths.scope).toBe("local");
    expect(promptMocks.select).toHaveBeenCalledTimes(1);
  });
});
