import { describe, expect, it } from "vitest";
import { resolveMcpForProvider } from "../../src/core/mcp.js";

describe("resolveMcpForProvider", () => {
  it("merges base and provider overrides", () => {
    const mcp = {
      version: 1 as const,
      mcpServers: {
        browser: {
          base: {
            command: "npx",
            args: ["browser-tools"],
          },
          providers: {
            codex: {
              args: ["browser-tools", "--codex"],
            },
          },
        },
      },
    };

    const resolved = resolveMcpForProvider(mcp, "codex");
    expect(resolved.browser.command).toBe("npx");
    expect(resolved.browser.args).toEqual(["browser-tools", "--codex"]);
  });

  it("skips provider when explicitly disabled", () => {
    const mcp = {
      version: 1 as const,
      mcpServers: {
        hidden: {
          base: {
            command: "npx",
          },
          providers: {
            gemini: false,
          },
        },
      },
    };

    const resolved = resolveMcpForProvider(mcp, "gemini");
    expect(Object.keys(resolved)).toHaveLength(0);
  });
});
