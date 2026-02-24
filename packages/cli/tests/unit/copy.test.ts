import { describe, expect, it } from "vitest";
import {
  getCommandAddHelpText,
  getCommandHelpText,
  formatUnknownCommandError,
  formatUsageError,
  getAddHelpText,
  getMcpAddHelpText,
  getMcpHelpText,
  getRootHelpText,
} from "../../src/core/copy.js";

describe("copy helpers", () => {
  it("renders root help with command list and common flags", () => {
    const help = getRootHelpText();
    expect(help).toContain("agentloom <aggregate-command> [options]");
    expect(help).toContain("command <add|list|delete|find|update|sync>");
    expect(help).toContain("find <query>");
    expect(help).toContain("init");
    expect(help).toContain("upgrade");
    expect(help).toContain("mcp <add|list|delete|find|update|sync>");
    expect(help).toContain("mcp server <add|list|delete>");
    expect(help).toContain("--no-sync");
    expect(help).toContain("--providers <csv>");
    expect(help).toContain("--selection-mode <mode>");
  });

  it("renders actionable usage errors", () => {
    const message = formatUsageError({
      issue: "Missing required value.",
      usage: "agentloom add <source>",
      example: "agentloom add farnoodma/agents --agent issue-creator",
    });

    expect(message).toContain("Issue: Missing required value.");
    expect(message).toContain("Usage: agentloom add <source>");
    expect(message).toContain(
      "Example: agentloom add farnoodma/agents --agent issue-creator",
    );
  });

  it("includes help hint for unknown commands", () => {
    const message = formatUnknownCommandError("oops");
    expect(message).toContain('Issue: Unknown command "oops".');
    expect(message).toContain("Usage: agentloom --help");
  });

  it("exposes mcp help topics", () => {
    expect(getCommandHelpText()).toContain(
      "agentloom command <add|list|delete|find|update|sync> [options]",
    );
    expect(getCommandAddHelpText()).toContain(
      "agentloom command add <source> [options]",
    );
    expect(getCommandAddHelpText()).toContain("--commands <name>");
    expect(getMcpHelpText()).toContain(
      "agentloom mcp <add|list|delete|find|update|sync> [options]",
    );
    expect(getMcpAddHelpText()).toContain(
      "agentloom mcp server add <name> (--url <url> | --command <cmd>)",
    );
  });

  it("includes targeted add import help", () => {
    const help = getAddHelpText();
    expect(help).toContain("--agents <name>");
    expect(help).toContain("--selection-mode <mode>");
    expect(help).toContain("agentloom add farnoodma/agents --providers");
  });
});
