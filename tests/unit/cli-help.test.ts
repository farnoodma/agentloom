import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli help routing", () => {
  it("prints top-level help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("agentloom <command> [options]");
    expect(output).toContain("Commands:");
  });

  it("prints mcp help without requiring scope resolution", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["mcp", "--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("agentloom mcp <command> [options]");
    expect(output).toContain("add <name>");
  });

  it("prints mcp add help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["mcp", "add", "--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "agentloom mcp add <name> (--url <url> | --command <cmd>)",
    );
  });

  it("throws actionable unknown command message", async () => {
    await expect(runCli(["unknown"])).rejects.toThrow("agentloom --help");
  });
});
