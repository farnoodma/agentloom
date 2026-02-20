import { describe, expect, it } from "vitest";
import {
  formatUnknownCommandError,
  formatUsageError,
  getMcpAddHelpText,
  getMcpHelpText,
  getRootHelpText,
} from "../../src/core/copy.js";

describe("copy helpers", () => {
  it("renders root help with command list and common flags", () => {
    const help = getRootHelpText();
    expect(help).toContain("agentloom <command> [options]");
    expect(help).toContain("mcp <add|list|delete>");
    expect(help).toContain("--no-sync");
    expect(help).toContain("--providers <csv>");
  });

  it("renders actionable usage errors", () => {
    const message = formatUsageError({
      issue: "Missing required value.",
      usage: "agentloom add <source>",
      example: "agentloom add vercel-labs/skills",
    });

    expect(message).toContain("Issue: Missing required value.");
    expect(message).toContain("Usage: agentloom add <source>");
    expect(message).toContain("Example: agentloom add vercel-labs/skills");
  });

  it("includes help hint for unknown commands", () => {
    const message = formatUnknownCommandError("oops");
    expect(message).toContain('Issue: Unknown command "oops".');
    expect(message).toContain("Usage: agentloom --help");
  });

  it("exposes mcp help topics", () => {
    expect(getMcpHelpText()).toContain("agentloom mcp <command> [options]");
    expect(getMcpAddHelpText()).toContain(
      "agentloom mcp add <name> (--url <url> | --command <cmd>)",
    );
  });
});
