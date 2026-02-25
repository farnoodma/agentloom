import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";
import { buildScopePaths } from "../../src/core/scope.js";
import { getVsCodeSettingsPath } from "../../src/core/provider-paths.js";
import { syncFromCanonical } from "../../src/sync/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("copilot sync", () => {
  it("writes global copilot outputs to ~/.github and registers discovery settings", async () => {
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
        path.join(homeDir, ".github", "agents", "reviewer.agent.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(homeDir, ".github", "prompts", "review.prompt.md"),
      ),
    ).toBe(true);

    const settingsPath = getVsCodeSettingsPath(homeDir);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      [key: string]: unknown;
    };
    expect(settings["chat.agentFilesLocations"]).toEqual(
      expect.arrayContaining([path.join(homeDir, ".github", "agents")]),
    );
    expect(settings["chat.promptFilesLocations"]).toEqual(
      expect.arrayContaining([path.join(homeDir, ".github", "prompts")]),
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
      expect.arrayContaining([path.join(homeDir, ".github", "agents")]),
    );
  });
});
