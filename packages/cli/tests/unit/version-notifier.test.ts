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

const { promptAndUpdate } = await import("../../src/core/version-notifier.js");

describe("promptAndUpdate", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    promptMocks.confirm.mockReset();
    promptMocks.isCancel.mockReset();
    promptMocks.isCancel.mockReturnValue(false);
    cpMocks.spawnSync.mockReset();

    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prompts the user with current and latest version", async () => {
    promptMocks.confirm.mockResolvedValue(false);

    await promptAndUpdate("0.1.0", "0.2.0");

    expect(promptMocks.confirm).toHaveBeenCalledWith({
      message: "Update available: 0.1.0 → 0.2.0. Update now?",
      initialValue: true,
    });
  });

  it("returns declined when user says no", async () => {
    promptMocks.confirm.mockResolvedValue(false);

    const result = await promptAndUpdate("0.1.0", "0.2.0");

    expect(result).toBe("declined");
    expect(cpMocks.spawnSync).not.toHaveBeenCalled();
  });

  it("returns declined when user cancels", async () => {
    promptMocks.confirm.mockResolvedValue(Symbol("cancel"));
    promptMocks.isCancel.mockReturnValue(true);

    const result = await promptAndUpdate("0.1.0", "0.2.0");

    expect(result).toBe("declined");
    expect(cpMocks.spawnSync).not.toHaveBeenCalled();
  });

  it("runs npm install globally on accept", async () => {
    promptMocks.confirm.mockResolvedValue(true);
    cpMocks.spawnSync.mockReturnValue({ status: 0 });

    await promptAndUpdate("0.1.0", "0.2.0");

    expect(cpMocks.spawnSync).toHaveBeenCalledWith(
      "npm",
      ["i", "-g", "agentloom"],
      { stdio: "inherit" },
    );
  });

  it("calls process.exit(0) on successful update", async () => {
    promptMocks.confirm.mockResolvedValue(true);
    cpMocks.spawnSync.mockReturnValue({ status: 0 });

    await promptAndUpdate("0.1.0", "0.2.0");

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Updated to 0.2.0"),
    );
  });

  it("returns failed and prints error when npm install fails", async () => {
    promptMocks.confirm.mockResolvedValue(true);
    cpMocks.spawnSync.mockReturnValue({ status: 1 });

    const result = await promptAndUpdate("0.1.0", "0.2.0");

    expect(result).toBe("failed");
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Update failed"),
    );
  });
});
