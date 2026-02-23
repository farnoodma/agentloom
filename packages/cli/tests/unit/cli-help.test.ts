import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCliErrorMessage, runCli } from "../../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli help routing", () => {
  it("prints top-level help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("agentloom <aggregate-command> [options]");
    expect(output).toContain("Aggregate commands:");
    expect(output).toContain("init");
    expect(output).toContain("find <query>");
  });

  it("prints init help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["init", "--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("agentloom init [options]");
    expect(output).toContain("--no-sync");
  });

  it("prints mcp help without requiring scope resolution", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["mcp", "--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "agentloom mcp <add|list|delete|find|update|sync> [options]",
    );
    expect(output).toContain("mcp server <add|list|delete>");
  });

  it("prints mcp add help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["mcp", "add", "--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "agentloom mcp server add <name> (--url <url> | --command <cmd>)",
    );
  });

  it("prints command help without requiring scope resolution", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["command", "--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "agentloom command <add|list|delete|find|update|sync> [options]",
    );
    expect(output).toContain("Manage canonical command entities.");
  });

  it("prints command add help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["command", "add", "--help"]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("agentloom command add <source> [options]");
  });

  it("throws actionable unknown command message", async () => {
    await expect(runCli(["unknown"])).rejects.toThrow("agentloom --help");
  });
});

describe("formatCliErrorMessage", () => {
  it("prefixes errors with a leading newline and subtle icon", () => {
    const output = formatCliErrorMessage("No importable entities found.");
    expect(output).toBe("\n✖ No importable entities found.");
  });

  it("keeps multiline content on separate lines", () => {
    const output = formatCliErrorMessage(
      'No importable entities found in source "https://github.com/acme/repo/tree/abc123".\nExpected agents/, commands/, or skills/.',
    );
    expect(output).toBe(
      '\n✖ No importable entities found in source "https://github.com/acme/repo/tree/abc123".\nExpected agents/, commands/, or skills/.',
    );
  });
});
