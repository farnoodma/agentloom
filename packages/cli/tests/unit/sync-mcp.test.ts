import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDir, writeJsonAtomic } from "../../src/core/fs.js";
import { buildScopePaths } from "../../src/core/scope.js";
import { syncFromCanonical } from "../../src/sync/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("mcp sync", () => {
  it("skips global claude mcp sync without aborting the default provider run", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "global", homeDir);
    ensureDir(path.dirname(paths.mcpPath));
    writeJsonAtomic(paths.mcpPath, {
      version: 1,
      mcpServers: {
        browser: {
          base: {
            command: "npx",
            args: ["browser-tools-mcp"],
          },
        },
      },
    });
    writeJsonAtomic(path.join(homeDir, ".claude.json"), {
      theme: "dark",
      enabledMcpjsonServers: ["legacy"],
    });

    const summary = await syncFromCanonical({
      paths,
      yes: true,
      nonInteractive: true,
      target: "mcp",
    });

    const migratedSettingsPath = path.join(homeDir, ".claude", "settings.json");
    expect(fs.existsSync(migratedSettingsPath)).toBe(true);
    const migratedSettings = JSON.parse(
      fs.readFileSync(migratedSettingsPath, "utf8"),
    ) as Record<string, unknown>;
    expect(migratedSettings.theme).toBe("dark");
    expect(migratedSettings.enabledMcpjsonServers).toBeUndefined();
    expect(summary.providers).toContain("claude");
    expect(fs.existsSync(path.join(homeDir, ".cursor", "mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, ".mcp.json"))).toBe(false);
  });

  it("writes local claude mcp and enabled server settings", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    ensureDir(path.dirname(paths.mcpPath));
    writeJsonAtomic(paths.mcpPath, {
      version: 1,
      mcpServers: {
        browser: {
          base: {
            command: "npx",
            args: ["browser-tools-mcp"],
          },
        },
      },
    });

    await syncFromCanonical({
      paths,
      providers: ["claude"],
      yes: true,
      nonInteractive: true,
      target: "mcp",
    });

    const claudeMcpPath = path.join(workspaceRoot, ".mcp.json");
    const claudeSettingsPath = path.join(
      workspaceRoot,
      ".claude",
      "settings.json",
    );
    expect(fs.existsSync(claudeMcpPath)).toBe(true);
    expect(fs.existsSync(claudeSettingsPath)).toBe(true);

    const settings = JSON.parse(
      fs.readFileSync(claudeSettingsPath, "utf8"),
    ) as Record<string, unknown>;
    expect(settings.enabledMcpjsonServers).toEqual(["browser"]);
  });
});
