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
    expect(help).toContain("dotagents <command> [options]");
    expect(help).toContain("mcp <add|list|delete>");
    expect(help).toContain("--no-sync");
    expect(help).toContain("--providers <csv>");
  });

  it("renders actionable usage errors", () => {
    const message = formatUsageError({
      issue: "Missing required value.",
      usage: "dotagents add <source>",
      example: "dotagents add vercel-labs/skills",
    });

    expect(message).toContain("Issue: Missing required value.");
    expect(message).toContain("Usage: dotagents add <source>");
    expect(message).toContain("Example: dotagents add vercel-labs/skills");
  });

  it("includes help hint for unknown commands", () => {
    const message = formatUnknownCommandError("oops");
    expect(message).toContain('Issue: Unknown command "oops".');
    expect(message).toContain("Usage: dotagents --help");
  });

  it("exposes mcp help topics", () => {
    expect(getMcpHelpText()).toContain("dotagents mcp <command> [options]");
    expect(getMcpAddHelpText()).toContain(
      "dotagents mcp add <name> (--url <url> | --command <cmd>)",
    );
  });
});
