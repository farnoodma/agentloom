import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { afterEach, describe, expect, it } from "vitest";
import { buildScopePaths } from "../../src/core/scope.js";
import {
  ensureDir,
  writeTextAtomic,
  writeJsonAtomic,
} from "../../src/core/fs.js";
import { syncFromCanonical } from "../../src/sync/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("codex sync", () => {
  it("writes codex role config and enables multi_agent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sync-"));
    tempDirs.push(root);

    const agentsDir = path.join(root, ".agents", "agents");
    ensureDir(agentsDir);

    writeTextAtomic(
      path.join(agentsDir, "researcher.md"),
      `---\nname: researcher\ndescription: Research specialist\ncodex:\n  model: gpt-5.3-codex\n  reasoningEffort: low\n  webSearch: true\n---\n\nInvestigate and summarize findings.\n`,
    );

    writeJsonAtomic(path.join(root, ".agents", "mcp.json"), {
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

    const paths = buildScopePaths(root, "local");

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
    });

    const codexConfigPath = path.join(root, ".codex", "config.toml");
    const codexConfig = TOML.parse(
      fs.readFileSync(codexConfigPath, "utf8"),
    ) as {
      features?: { multi_agent?: boolean };
      agents?: Record<string, { config_file?: string }>;
    };

    expect(codexConfig.features?.multi_agent).toBe(true);
    expect(codexConfig.agents?.researcher?.config_file).toBe(
      "./agents/researcher.toml",
    );

    const roleTomlPath = path.join(root, ".codex", "agents", "researcher.toml");
    const roleToml = TOML.parse(fs.readFileSync(roleTomlPath, "utf8")) as {
      model?: string;
      model_reasoning_effort?: string;
      tools?: { web_search?: boolean };
      model_instructions_file?: string;
    };

    expect(roleToml.model).toBe("gpt-5.3-codex");
    expect(roleToml.model_reasoning_effort).toBe("low");
    expect(roleToml.tools?.web_search).toBe(true);
    expect(roleToml.model_instructions_file).toBe(
      "./researcher.instructions.md",
    );
  });

  it("removes codex role config when codex provider is disabled", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sync-"));
    tempDirs.push(root);

    const agentsDir = path.join(root, ".agents", "agents");
    ensureDir(agentsDir);

    const agentPath = path.join(agentsDir, "researcher.md");
    writeTextAtomic(
      agentPath,
      `---\nname: researcher\ndescription: Research specialist\ncodex:\n  model: gpt-5.3-codex\n---\n\nInvestigate and summarize findings.\n`,
    );

    const paths = buildScopePaths(root, "local");

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
    });

    writeTextAtomic(
      agentPath,
      `---\nname: researcher\ndescription: Research specialist\ncodex: false\n---\n\nInvestigate and summarize findings.\n`,
    );

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
    });

    const codexConfigPath = path.join(root, ".codex", "config.toml");
    const codexConfig = TOML.parse(
      fs.readFileSync(codexConfigPath, "utf8"),
    ) as {
      agents?: Record<string, unknown>;
    };
    expect(codexConfig.agents?.researcher).toBeUndefined();
    expect(
      fs.existsSync(path.join(root, ".codex", "agents", "researcher.toml")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".codex", "agents", "researcher.instructions.md"),
      ),
    ).toBe(false);
  });

  it("writes codex commands to global prompts even in local scope", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sync-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(root, home);

    const commandsDir = path.join(root, ".agents", "commands");
    ensureDir(commandsDir);
    writeTextAtomic(
      path.join(commandsDir, "triage.md"),
      `# /triage\n\nTriage the current issue with minimal steps.\n`,
    );

    const paths = buildScopePaths(root, "local", home);

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
    });

    expect(
      fs.existsSync(path.join(home, ".codex", "prompts", "triage.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".codex", "prompts", "triage.md")),
    ).toBe(false);
  });
});
