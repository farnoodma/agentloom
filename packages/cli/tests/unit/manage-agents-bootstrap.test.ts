import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promptMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock("@clack/prompts", () => ({
  confirm: promptMocks.confirm,
  isCancel: promptMocks.isCancel,
}));

import {
  getGlobalManageAgentsSkillPath,
  getLocalManageAgentsSkillPath,
  maybePromptManageAgentsBootstrap,
} from "../../src/core/manage-agents-bootstrap.js";

const tempDirs: string[] = [];

function createIsolatedPaths(): { homeDir: string; cwd: string } {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-cwd-"));
  tempDirs.push(homeDir, cwd);
  return { homeDir, cwd };
}

beforeEach(() => {
  promptMocks.confirm.mockReset();
  promptMocks.confirm.mockResolvedValue(true);
  promptMocks.isCancel.mockReset();
  promptMocks.isCancel.mockReturnValue(false);
  delete process.env.AGENTLOOM_DISABLE_MANAGE_AGENTS_PROMPT;
});

afterEach(() => {
  delete process.env.AGENTLOOM_DISABLE_MANAGE_AGENTS_PROMPT;
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("maybePromptManageAgentsBootstrap", () => {
  it("prompts when manage-agents skill is missing in local and global scopes", async () => {
    const { homeDir, cwd } = createIsolatedPaths();

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "find",
      help: false,
      yes: false,
      homeDir,
      cwd,
      interactive: true,
    });

    expect(accepted).toBe(true);
    expect(promptMocks.confirm).toHaveBeenCalledTimes(1);
  });

  it("returns false when user declines", async () => {
    const { homeDir, cwd } = createIsolatedPaths();
    promptMocks.confirm.mockResolvedValueOnce(false);

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "add",
      help: false,
      yes: false,
      homeDir,
      cwd,
      interactive: true,
    });

    expect(accepted).toBe(false);
  });

  it("does not prompt when skill already exists", async () => {
    const { homeDir, cwd } = createIsolatedPaths();
    const skillPath = getGlobalManageAgentsSkillPath(homeDir);
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "# existing\n", "utf8");

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "sync",
      help: false,
      yes: false,
      homeDir,
      cwd,
      interactive: true,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("does not prompt when local skill already exists", async () => {
    const { homeDir, cwd } = createIsolatedPaths();
    const skillPath = getLocalManageAgentsSkillPath(cwd);
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "# existing\n", "utf8");

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "sync",
      help: false,
      yes: false,
      homeDir,
      cwd,
      interactive: true,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("skips prompt in non-interactive mode", async () => {
    const { homeDir, cwd } = createIsolatedPaths();

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "find",
      help: false,
      yes: false,
      homeDir,
      cwd,
      interactive: false,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("skips prompt for help, version, and upgrade commands", async () => {
    const { homeDir, cwd } = createIsolatedPaths();

    const versionAccepted = await maybePromptManageAgentsBootstrap({
      command: "--version",
      help: false,
      yes: false,
      homeDir,
      cwd,
      interactive: true,
    });
    const upgradeAccepted = await maybePromptManageAgentsBootstrap({
      command: "upgrade",
      help: false,
      yes: false,
      homeDir,
      cwd,
      interactive: true,
    });
    const helpAccepted = await maybePromptManageAgentsBootstrap({
      command: "find",
      help: true,
      yes: false,
      homeDir,
      cwd,
      interactive: true,
    });

    expect(versionAccepted).toBe(false);
    expect(upgradeAccepted).toBe(false);
    expect(helpAccepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("skips prompt when --yes mode is enabled", async () => {
    const { homeDir, cwd } = createIsolatedPaths();

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "delete",
      help: false,
      yes: true,
      homeDir,
      cwd,
      interactive: true,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("supports env opt-out", async () => {
    const { homeDir, cwd } = createIsolatedPaths();
    process.env.AGENTLOOM_DISABLE_MANAGE_AGENTS_PROMPT = "1";

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "add",
      help: false,
      yes: false,
      homeDir,
      cwd,
      interactive: true,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });
});
