import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScopePaths } from "../../src/core/scope.js";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";

const promptMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: promptMocks.cancel,
  confirm: promptMocks.confirm,
  isCancel: promptMocks.isCancel,
  multiselect: promptMocks.multiselect,
}));

import { syncFromCanonical } from "../../src/sync/index.js";

const tempDirs: string[] = [];

beforeEach(() => {
  promptMocks.cancel.mockReset();
  promptMocks.confirm.mockReset();
  promptMocks.confirm.mockResolvedValue(true);
  promptMocks.isCancel.mockReset();
  promptMocks.isCancel.mockReturnValue(false);
  promptMocks.multiselect.mockReset();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("sync provider selection", () => {
  it("prompts in interactive mode and persists provider preferences", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const commandsDir = path.join(workspaceRoot, ".agents", "commands");
    ensureDir(commandsDir);
    writeTextAtomic(path.join(commandsDir, "review.md"), "# /review\n");

    promptMocks.multiselect.mockResolvedValueOnce(["codex", "claude"]);

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    const firstSummary = await syncFromCanonical({
      paths,
      nonInteractive: false,
      yes: false,
    });

    expect(firstSummary.providers).toEqual(["codex", "claude"]);
    expect(promptMocks.multiselect).toHaveBeenCalledTimes(1);
    expect(promptMocks.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("space select"),
        initialValues: [
          "cursor",
          "claude",
          "codex",
          "opencode",
          "gemini",
          "copilot",
          "pi",
        ],
      }),
    );

    const localSettings = JSON.parse(
      fs.readFileSync(
        path.join(workspaceRoot, ".agents", "settings.local.json"),
        "utf8",
      ),
    ) as { defaultProviders?: string[] };
    expect(localSettings.defaultProviders).toEqual(["codex", "claude"]);

    const globalSettings = JSON.parse(
      fs.readFileSync(
        path.join(homeDir, ".agents", "settings.local.json"),
        "utf8",
      ),
    ) as { defaultProviders?: string[] };
    expect(globalSettings.defaultProviders).toEqual(["codex", "claude"]);

    const secondSummary = await syncFromCanonical({
      paths,
      nonInteractive: true,
      yes: true,
    });

    expect(secondSummary.providers).toEqual(["codex", "claude"]);
    expect(promptMocks.multiselect).toHaveBeenCalledTimes(1);
  });
});
