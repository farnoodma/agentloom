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
  maybePromptManageAgentsBootstrap,
} from "../../src/core/manage-agents-bootstrap.js";

const tempDirs: string[] = [];

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
  it("prompts when global manage-agents skill is missing", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(homeDir);

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "find",
      help: false,
      yes: false,
      homeDir,
      interactive: true,
    });

    expect(accepted).toBe(true);
    expect(promptMocks.confirm).toHaveBeenCalledTimes(1);
  });

  it("returns false when user declines", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(homeDir);
    promptMocks.confirm.mockResolvedValueOnce(false);

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "add",
      help: false,
      yes: false,
      homeDir,
      interactive: true,
    });

    expect(accepted).toBe(false);
  });

  it("does not prompt when skill already exists", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(homeDir);
    const skillPath = getGlobalManageAgentsSkillPath(homeDir);
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "# existing\n", "utf8");

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "sync",
      help: false,
      yes: false,
      homeDir,
      interactive: true,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("skips prompt in non-interactive mode", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(homeDir);

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "find",
      help: false,
      yes: false,
      homeDir,
      interactive: false,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("skips prompt for help and version commands", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(homeDir);

    const versionAccepted = await maybePromptManageAgentsBootstrap({
      command: "--version",
      help: false,
      yes: false,
      homeDir,
      interactive: true,
    });
    const helpAccepted = await maybePromptManageAgentsBootstrap({
      command: "find",
      help: true,
      yes: false,
      homeDir,
      interactive: true,
    });

    expect(versionAccepted).toBe(false);
    expect(helpAccepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("skips prompt when --yes mode is enabled", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(homeDir);

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "delete",
      help: false,
      yes: true,
      homeDir,
      interactive: true,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("supports env opt-out", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(homeDir);
    process.env.AGENTLOOM_DISABLE_MANAGE_AGENTS_PROMPT = "1";

    const accepted = await maybePromptManageAgentsBootstrap({
      command: "add",
      help: false,
      yes: false,
      homeDir,
      interactive: true,
    });

    expect(accepted).toBe(false);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });
});
