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
      `---\nname: researcher\ndescription: Research specialist\ncodex:\n  model: gpt-5.3-codex\n  reasoningEffort: low\n  reasoningSummary: auto\n  verbosity: high\n  webSearch: true\n---\n\nInvestigate and summarize findings.\n`,
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
      developer_instructions?: string;
      model_reasoning_effort?: string;
      model_reasoning_summary?: string;
      model_verbosity?: string;
      web_search?: boolean;
    };

    expect(roleToml.model).toBe("gpt-5.3-codex");
    expect(roleToml.developer_instructions).toBe(
      "Investigate and summarize findings.",
    );
    expect(roleToml.model_reasoning_effort).toBe("low");
    expect(roleToml.model_reasoning_summary).toBe("auto");
    expect(roleToml.model_verbosity).toBe("high");
    expect(roleToml.web_search).toBe(true);
  });

  it("prefers explicit codex developer instructions overrides", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sync-"));
    tempDirs.push(root);

    const agentsDir = path.join(root, ".agents", "agents");
    ensureDir(agentsDir);

    writeTextAtomic(
      path.join(agentsDir, "researcher.md"),
      `---\nname: researcher\ndescription: Research specialist\ncodex:\n  developerInstructions: Use structured bullet points.\n---\n\nInvestigate and summarize findings.\n`,
    );

    const paths = buildScopePaths(root, "local");

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
    });

    const roleTomlPath = path.join(root, ".codex", "agents", "researcher.toml");
    const roleToml = TOML.parse(fs.readFileSync(roleTomlPath, "utf8")) as {
      developer_instructions?: string;
    };

    expect(roleToml.developer_instructions).toBe(
      "Use structured bullet points.",
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

  it("removes stale codex agent entries when manifest codex metadata is missing", async () => {
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

    const manifestPath = path.join(root, ".agents", ".sync-manifest.json");
    const legacyManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as {
      codex?: unknown;
      [key: string]: unknown;
    };
    delete legacyManifest.codex;
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(legacyManifest, null, 2)}\n`,
    );

    fs.unlinkSync(agentPath);

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
      target: "agent",
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

  it("removes stale codex mcp entries when manifest codex metadata is missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sync-"));
    tempDirs.push(root);

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

    const manifestPath = path.join(root, ".agents", ".sync-manifest.json");
    const legacyManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as {
      codex?: unknown;
      [key: string]: unknown;
    };
    delete legacyManifest.codex;
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(legacyManifest, null, 2)}\n`,
    );

    writeJsonAtomic(path.join(root, ".agents", "mcp.json"), {
      version: 1,
      mcpServers: {},
    });

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
      target: "mcp",
    });

    const codexConfigPath = path.join(root, ".codex", "config.toml");
    const codexConfig = TOML.parse(
      fs.readFileSync(codexConfigPath, "utf8"),
    ) as {
      mcp_servers?: Record<string, unknown>;
    };

    expect(codexConfig.mcp_servers?.browser).toBeUndefined();
  });

  it("preserves provider-local codex mcp settings while updating managed fields", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-sync-"));
    tempDirs.push(root);

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

    writeTextAtomic(
      path.join(root, ".codex", "config.toml"),
      `[mcp_servers.browser]
command = "old-command"
args = ["old-arg"]
enabled = false
startup_timeout_sec = 30
`,
    );

    const paths = buildScopePaths(root, "local");

    await syncFromCanonical({
      paths,
      providers: ["codex"],
      yes: true,
      nonInteractive: true,
      target: "mcp",
    });

    const codexConfigPath = path.join(root, ".codex", "config.toml");
    const codexConfig = TOML.parse(
      fs.readFileSync(codexConfigPath, "utf8"),
    ) as {
      mcp_servers?: Record<string, Record<string, unknown>>;
    };

    expect(codexConfig.mcp_servers?.browser?.command).toBe("npx");
    expect(codexConfig.mcp_servers?.browser?.args).toEqual(["browser-tools"]);
    expect(codexConfig.mcp_servers?.browser?.enabled).toBe(false);
    expect(codexConfig.mcp_servers?.browser?.startup_timeout_sec).toBe(30);
  });
});
