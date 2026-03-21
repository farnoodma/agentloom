import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDir,
  writeJsonAtomic,
  writeTextAtomic,
} from "../../src/core/fs.js";
import {
  getCopilotMcpPath,
  getVsCodeSettingsPath,
} from "../../src/core/provider-paths.js";
import { buildScopePaths } from "../../src/core/scope.js";
import { syncFromCanonical } from "../../src/sync/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("copilot sync", () => {
  it("writes global copilot outputs to ~/.copilot and registers discovery settings", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "global", homeDir);
    ensureDir(paths.agentsDir);
    ensureDir(paths.commandsDir);

    writeTextAtomic(
      path.join(paths.agentsDir, "reviewer.md"),
      `---
name: reviewer
description: Reviews changes
copilot:
  tools:
    - codebase
    - changes
---

Review changed files and report issues.
`,
    );

    writeTextAtomic(
      path.join(paths.commandsDir, "review.md"),
      `---
copilot:
  description: Review command
  mode: ask
---

# /review

Review active changes.
`,
    );

    await syncFromCanonical({
      paths,
      providers: ["copilot"],
      yes: true,
      nonInteractive: true,
      target: "all",
    });

    expect(
      fs.existsSync(
        path.join(homeDir, ".copilot", "agents", "reviewer.agent.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(homeDir, ".copilot", "prompts", "review.prompt.md"),
      ),
    ).toBe(true);

    const settingsPath = getVsCodeSettingsPath(homeDir);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      [key: string]: unknown;
    };
    expect(settings["chat.agentFilesLocations"]).toEqual(
      expect.arrayContaining([path.join(homeDir, ".copilot", "agents")]),
    );
    expect(settings["chat.promptFilesLocations"]).toEqual(
      expect.arrayContaining([path.join(homeDir, ".copilot", "prompts")]),
    );
  });

  it("allows copilot agents without provider-specific tools config", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    ensureDir(paths.agentsDir);

    writeTextAtomic(
      path.join(paths.agentsDir, "reviewer.md"),
      `---
name: reviewer
description: Reviews changes
---

Review changed files and report issues.
`,
    );

    await syncFromCanonical({
      paths,
      providers: ["copilot"],
      yes: true,
      nonInteractive: true,
      target: "agent",
    });

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".github", "agents", "reviewer.agent.md"),
      ),
    ).toBe(true);
  });

  it("parses JSONC VS Code settings when updating global discovery paths", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "global", homeDir);
    ensureDir(paths.agentsDir);
    writeTextAtomic(
      path.join(paths.agentsDir, "reviewer.md"),
      `---
name: reviewer
description: Reviews changes
---

Review changed files and report issues.
`,
    );

    const settingsPath = getVsCodeSettingsPath(homeDir);
    ensureDir(path.dirname(settingsPath));
    writeTextAtomic(
      settingsPath,
      `{
  // existing JSONC comment
  "workbench.colorTheme": "Default Dark+",
}
`,
    );

    await syncFromCanonical({
      paths,
      providers: ["copilot"],
      yes: true,
      nonInteractive: true,
      target: "agent",
    });

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      [key: string]: unknown;
    };

    expect(settings["workbench.colorTheme"]).toBe("Default Dark+");
    expect(settings["chat.agentFilesLocations"]).toEqual(
      expect.arrayContaining([path.join(homeDir, ".copilot", "agents")]),
    );
  });

  it("treats empty VS Code settings as writable JSON when syncing discovery paths", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "global", homeDir);
    ensureDir(paths.agentsDir);
    writeTextAtomic(
      path.join(paths.agentsDir, "reviewer.md"),
      `---
name: reviewer
description: Reviews changes
---

Review changed files and report issues.
`,
    );

    const settingsPath = getVsCodeSettingsPath(homeDir);
    ensureDir(path.dirname(settingsPath));
    writeTextAtomic(settingsPath, "   \n");

    await syncFromCanonical({
      paths,
      providers: ["copilot"],
      yes: true,
      nonInteractive: true,
      target: "agent",
    });

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      [key: string]: unknown;
    };
    expect(settings["chat.agentFilesLocations"]).toEqual(
      expect.arrayContaining([path.join(homeDir, ".copilot", "agents")]),
    );
  });

  it("treats comment-only VS Code settings as writable JSON when syncing discovery paths", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const paths = buildScopePaths(workspaceRoot, "global", homeDir);
    ensureDir(paths.agentsDir);
    writeTextAtomic(
      path.join(paths.agentsDir, "reviewer.md"),
      `---
name: reviewer
description: Reviews changes
---

Review changed files and report issues.
`,
    );

    const settingsPath = getVsCodeSettingsPath(homeDir);
    ensureDir(path.dirname(settingsPath));
    writeTextAtomic(
      settingsPath,
      `// user comment-only settings placeholder
`,
    );

    await syncFromCanonical({
      paths,
      providers: ["copilot"],
      yes: true,
      nonInteractive: true,
      target: "agent",
    });

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      [key: string]: unknown;
    };
    expect(settings["chat.agentFilesLocations"]).toEqual(
      expect.arrayContaining([path.join(homeDir, ".copilot", "agents")]),
    );
  });

  it("preserves provider-local MCP fields in both global copilot outputs", async () => {
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
            args: ["browser-tools"],
          },
        },
      },
    });

    const profileMcpPath = getCopilotMcpPath(paths);
    writeJsonAtomic(profileMcpPath, {
      mcpServers: {
        browser: {
          command: "old-command",
          args: ["old-arg"],
          enabled: false,
          startupTimeoutMs: 30_000,
        },
      },
    });

    const settingsPath = getVsCodeSettingsPath(homeDir);
    ensureDir(path.dirname(settingsPath));
    writeJsonAtomic(settingsPath, {
      "mcp.servers": {
        browser: {
          command: "old-command",
          args: ["old-arg"],
          enabled: false,
          startupTimeoutMs: 30_000,
        },
      },
    });

    await syncFromCanonical({
      paths,
      providers: ["copilot"],
      yes: true,
      nonInteractive: true,
      target: "mcp",
    });

    const profileMcp = JSON.parse(fs.readFileSync(profileMcpPath, "utf8")) as {
      mcpServers?: Record<string, Record<string, unknown>>;
    };
    expect(profileMcp.mcpServers?.browser?.command).toBe("npx");
    expect(profileMcp.mcpServers?.browser?.args).toEqual(["browser-tools"]);
    expect(profileMcp.mcpServers?.browser?.enabled).toBe(false);
    expect(profileMcp.mcpServers?.browser?.startupTimeoutMs).toBe(30_000);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      [key: string]: unknown;
    };
    const mcpServers = settings["mcp.servers"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(mcpServers?.browser?.command).toBe("npx");
    expect(mcpServers?.browser?.args).toEqual(["browser-tools"]);
    expect(mcpServers?.browser?.enabled).toBe(false);
    expect(mcpServers?.browser?.startupTimeoutMs).toBe(30_000);
  });
});
