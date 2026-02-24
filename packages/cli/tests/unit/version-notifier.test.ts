import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isNewerVersion } from "../../src/core/version-notifier.js";

describe("isNewerVersion", () => {
  it("detects higher patch versions", () => {
    expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.1")).toBe(false);
  });

  it("detects higher minor and major versions", () => {
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  it("handles prefixed or suffixed versions", () => {
    expect(isNewerVersion("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.2.0-beta.1", "0.1.9")).toBe(true);
  });

  it("returns false for invalid versions", () => {
    expect(isNewerVersion("invalid", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "invalid")).toBe(false);
  });
});

const promptMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

const cpMocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: promptMocks.confirm,
  isCancel: promptMocks.isCancel,
}));

vi.mock("node:child_process", () => ({
  spawnSync: cpMocks.spawnSync,
}));

const { maybeConfirmAutoUpgrade, promptAndUpdate } =
  await import("../../src/core/version-notifier.js");

const originalTty = {
  stdin: process.stdin.isTTY,
  stdout: process.stdout.isTTY,
  stderr: process.stderr.isTTY,
};

function setTty(options: { stdin: boolean; stdout: boolean; stderr: boolean }) {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: options.stdin,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: options.stdout,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: options.stderr,
  });
}

describe("maybeConfirmAutoUpgrade", () => {
  beforeEach(() => {
    promptMocks.confirm.mockReset();
    promptMocks.confirm.mockResolvedValue(true);
    promptMocks.isCancel.mockReset();
    promptMocks.isCancel.mockReturnValue(false);
  });

  afterEach(() => {
    setTty({
      stdin: Boolean(originalTty.stdin),
      stdout: Boolean(originalTty.stdout),
      stderr: Boolean(originalTty.stderr),
    });
  });

  it("does not prompt in non-interactive sessions", async () => {
    setTty({ stdin: false, stdout: true, stderr: true });

    const approved = await maybeConfirmAutoUpgrade("0.1.0", "0.2.0");

    expect(approved).toBe(true);
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("prompts and accepts when user confirms in TTY", async () => {
    setTty({ stdin: true, stdout: true, stderr: true });
    promptMocks.confirm.mockResolvedValue(true);

    const approved = await maybeConfirmAutoUpgrade("0.1.0", "0.2.0");

    expect(approved).toBe(true);
    expect(promptMocks.confirm).toHaveBeenCalledWith({
      message:
        "Update available: 0.1.0 → 0.2.0. Upgrade now and re-run your command?",
      initialValue: true,
    });
  });

  it("returns false when user declines in TTY", async () => {
    setTty({ stdin: true, stdout: true, stderr: true });
    promptMocks.confirm.mockResolvedValue(false);

    const approved = await maybeConfirmAutoUpgrade("0.1.0", "0.2.0");

    expect(approved).toBe(false);
  });

  it("returns false when prompt is canceled in TTY", async () => {
    setTty({ stdin: true, stdout: true, stderr: true });
    promptMocks.confirm.mockResolvedValue(Symbol("cancel"));
    promptMocks.isCancel.mockReturnValue(true);

    const approved = await maybeConfirmAutoUpgrade("0.1.0", "0.2.0");

    expect(approved).toBe(false);
  });
});

describe("promptAndUpdate", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalArgv1: string | undefined;

  beforeEach(() => {
    promptMocks.confirm.mockReset();
    promptMocks.isCancel.mockReset();
    promptMocks.isCancel.mockReturnValue(false);
    cpMocks.spawnSync.mockReset();
    originalArgv1 = process.argv[1];
    process.argv[1] = "/usr/local/lib/node_modules/agentloom/bin/cli.mjs";

    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv[1] = originalArgv1;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns already-latest when candidate is older", async () => {
    const result = await promptAndUpdate("0.2.0", "0.1.0");

    expect(result).toBe("already-latest");
    expect(cpMocks.spawnSync).not.toHaveBeenCalled();
  });

  it("returns already-latest when version is unchanged", async () => {
    const result = await promptAndUpdate("0.2.0", "0.2.0");

    expect(result).toBe("already-latest");
    expect(cpMocks.spawnSync).not.toHaveBeenCalled();
  });

  it("runs npm install globally", async () => {
    cpMocks.spawnSync.mockReturnValue({ status: 0 });

    await promptAndUpdate("0.1.0", "0.2.0");

    expect(cpMocks.spawnSync).toHaveBeenCalledWith(
      "npm",
      ["i", "-g", "agentloom@0.2.0"],
      { stdio: "inherit" },
    );
  });

  it("re-runs the original command after a successful install", async () => {
    cpMocks.spawnSync
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });

    await promptAndUpdate("0.1.0", "0.2.0", { rerunArgs: ["sync"] });

    const expectedArgs = [...process.execArgv, process.argv[1], "sync"];
    expect(cpMocks.spawnSync).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      expectedArgs,
      {
        stdio: "inherit",
        env: expect.objectContaining({
          AGENTLOOM_DISABLE_UPDATE_NOTIFIER: "1",
        }),
      },
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits non-zero when rerun cannot be spawned after install", async () => {
    cpMocks.spawnSync
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: null, error: new Error("spawn ENOENT") });

    const result = await promptAndUpdate("0.1.0", "0.2.0", {
      rerunArgs: ["sync"],
    });

    expect(result).toBe("failed");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Automatic rerun failed"),
    );
  });

  it("uses npx rerun strategy when invoked from npx cache", async () => {
    process.argv[1] =
      "/Users/test/.npm/_npx/123/node_modules/agentloom/bin/cli.mjs";
    cpMocks.spawnSync
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });

    await promptAndUpdate("0.1.0", "0.2.0", { rerunArgs: ["find", "review"] });

    expect(cpMocks.spawnSync).toHaveBeenNthCalledWith(
      1,
      "npx",
      ["--yes", "agentloom@0.2.0", "--version"],
      {
        stdio: "ignore",
        env: expect.objectContaining({
          AGENTLOOM_DISABLE_UPDATE_NOTIFIER: "1",
        }),
      },
    );

    expect(cpMocks.spawnSync).toHaveBeenCalledWith(
      "npx",
      ["--yes", "agentloom@0.2.0", "find", "review"],
      {
        stdio: "inherit",
        env: expect.objectContaining({
          AGENTLOOM_DISABLE_UPDATE_NOTIFIER: "1",
        }),
      },
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits with child status when npx rerun returns non-zero", async () => {
    process.argv[1] =
      "/Users/test/.npm/_npx/123/node_modules/agentloom/bin/cli.mjs";
    cpMocks.spawnSync
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 2 });

    const result = await promptAndUpdate("0.1.0", "0.2.0", {
      rerunArgs: ["sync"],
    });

    expect(result).toBe("failed");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("falls back to current run when npx preflight probe fails", async () => {
    process.argv[1] =
      "/Users/test/.npm/_npx/123/node_modules/agentloom/bin/cli.mjs";
    cpMocks.spawnSync.mockReturnValue({ status: 1 });

    const result = await promptAndUpdate("0.1.0", "0.2.0", {
      rerunArgs: ["sync"],
    });

    expect(result).toBe("failed");
    expect(exitSpy).not.toHaveBeenCalled();
    expect(cpMocks.spawnSync).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("continuing with current version"),
    );
  });

  it("returns failed and prints error when npm install fails", async () => {
    cpMocks.spawnSync.mockReturnValue({ status: 1 });

    const result = await promptAndUpdate("0.1.0", "0.2.0");

    expect(result).toBe("failed");
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Automatic upgrade failed"),
    );
  });
});
