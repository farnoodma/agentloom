import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cancel, confirm, isCancel, multiselect } from "@clack/prompts";
import TOML from "@iarna/toml";
import YAML from "yaml";
import { ALL_PROVIDERS } from "../types.js";
import type {
  CanonicalAgent,
  AgentloomSettings,
  EntityType,
  Provider,
  ScopePaths,
  SyncManifest,
} from "../types.js";
import {
  getProviderConfig,
  isProviderEnabled,
  parseAgentsDir,
} from "../core/agents.js";
import { parseCommandsDir } from "../core/commands.js";
import {
  ensureDir,
  isObject,
  readJsonIfExists,
  relativePosix,
  removeFileIfExists,
  slugify,
  toPosixPath,
  writeJsonAtomic,
  writeTextAtomic,
} from "../core/fs.js";
import { readManifest, writeManifest } from "../core/manifest.js";
import { readCanonicalMcp, resolveMcpForProvider } from "../core/mcp.js";
import {
  getGlobalSettingsPath,
  readSettings,
  updateLastScope,
  updateLastScopeBestEffort,
} from "../core/settings.js";

export interface SyncOptions {
  paths: ScopePaths;
  providers?: Provider[];
  yes?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
  target?: EntityType | "all";
}

export interface SyncSummary {
  providers: Provider[];
  generatedFiles: string[];
  removedFiles: string[];
}

export async function resolveProvidersForSync(options: {
  paths: ScopePaths;
  explicitProviders?: Provider[];
  nonInteractive?: boolean;
}): Promise<Provider[]> {
  const settings = readSettings(options.paths.settingsPath);
  return resolveProviders({
    explicitProviders: options.explicitProviders,
    settings,
    nonInteractive: options.nonInteractive,
  });
}

export async function syncFromCanonical(
  options: SyncOptions,
): Promise<SyncSummary> {
  const agents = parseAgentsDir(options.paths.agentsDir);
  const commands = parseCommandsDir(options.paths.commandsDir);
  const mcp = readCanonicalMcp(options.paths);
  const manifest = readManifest(options.paths);
  const effectiveManifest: SyncManifest = {
    ...manifest,
    generatedByEntity: normalizeGeneratedByEntity(manifest),
  };

  const providers = await resolveProvidersForSync({
    paths: options.paths,
    explicitProviders: options.providers,
    nonInteractive: options.nonInteractive,
  });
  const target = options.target ?? "all";

  const nextManifest: SyncManifest = {
    version: 1,
    generatedFiles: [],
    generatedByEntity: {},
    codex: {
      roles: [...(effectiveManifest.codex?.roles ?? [])],
      mcpServers: [...(effectiveManifest.codex?.mcpServers ?? [])],
    },
  };

  const generatedAgents = new Set<string>();
  const generatedCommands = new Set<string>();
  const generatedMcp = new Set<string>();

  if (target === "all" || target === "agent") {
    for (const provider of providers) {
      syncProviderAgents({
        provider,
        paths: options.paths,
        agents,
        generated: generatedAgents,
        dryRun: !!options.dryRun,
      });
    }
  }

  if (target === "all" || target === "command") {
    for (const provider of providers) {
      syncProviderCommands({
        provider,
        paths: options.paths,
        commands,
        generated: generatedCommands,
        dryRun: !!options.dryRun,
      });
    }
  }

  if (target === "all" || target === "mcp") {
    syncProviderMcp({
      providers,
      paths: options.paths,
      mcp,
      generated: generatedMcp,
      dryRun: !!options.dryRun,
    });
  }

  if (providers.includes("codex")) {
    const includeRoles = target === "all" || target === "agent";
    const includeMcp = target === "all" || target === "mcp";
    if (includeRoles || includeMcp) {
      syncCodex({
        paths: options.paths,
        agents,
        resolvedMcp: resolveMcpForProvider(mcp, "codex"),
        generated: includeRoles ? generatedAgents : generatedMcp,
        manifest: effectiveManifest,
        nextManifest,
        dryRun: !!options.dryRun,
        includeRoles,
        includeMcp,
      });
    } else {
      nextManifest.codex = {
        roles: [...(effectiveManifest.codex?.roles ?? [])],
        mcpServers: [...(effectiveManifest.codex?.mcpServers ?? [])],
      };
    }
  }

  const previousByEntity = normalizeGeneratedByEntity(effectiveManifest);
  const nextByEntity = {
    ...previousByEntity,
  };

  if (target === "all" || target === "agent") {
    nextByEntity.agent = [...generatedAgents].sort();
  }
  if (target === "all" || target === "command") {
    nextByEntity.command = [...generatedCommands].sort();
  }
  if (target === "all" || target === "mcp") {
    nextByEntity.mcp = [...generatedMcp].sort();
  }

  nextManifest.generatedByEntity = pruneGeneratedByEntity(nextByEntity);

  nextManifest.generatedFiles = [
    ...new Set([
      ...(nextManifest.generatedByEntity.agent ?? []),
      ...(nextManifest.generatedByEntity.command ?? []),
      ...(nextManifest.generatedByEntity.mcp ?? []),
      ...(nextManifest.generatedByEntity.skill ?? []),
    ]),
  ].sort();

  const removedFiles = await removeStaleGeneratedFiles({
    oldManifest: manifest,
    newManifest: nextManifest,
    dryRun: !!options.dryRun,
    yes: !!options.yes,
    nonInteractive: !!options.nonInteractive,
  });

  if (!options.dryRun) {
    writeManifest(options.paths, nextManifest);
    updateLastScope(options.paths.settingsPath, options.paths.scope, providers);
    const globalSettingsPath = getGlobalSettingsPath(options.paths.homeDir);
    if (options.paths.settingsPath !== globalSettingsPath) {
      updateLastScopeBestEffort(
        globalSettingsPath,
        options.paths.scope,
        providers,
      );
    }
  }

  return {
    providers,
    generatedFiles: nextManifest.generatedFiles,
    removedFiles,
  };
}

const PROVIDER_LABELS: Record<Provider, string> = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini",
  copilot: "Copilot",
};

const MULTISELECT_HELP_TEXT = "↑↓ move, space select, enter confirm";

function withMultiselectHelp(message: string): string {
  return `${message}\n${MULTISELECT_HELP_TEXT}`;
}

async function resolveProviders(options: {
  explicitProviders: Provider[] | undefined;
  settings: AgentloomSettings;
  nonInteractive: boolean | undefined;
}): Promise<Provider[]> {
  if (options.explicitProviders && options.explicitProviders.length > 0) {
    return normalizeProviderSelection(options.explicitProviders);
  }

  const defaults = normalizeProviderSelection(
    options.settings.defaultProviders,
  );
  const initialSelection = defaults.length > 0 ? defaults : [...ALL_PROVIDERS];
  const nonInteractive =
    options.nonInteractive ?? !(process.stdin.isTTY && process.stdout.isTTY);

  if (nonInteractive) {
    return initialSelection;
  }

  const selected = await multiselect<Provider>({
    message: withMultiselectHelp("Select providers to sync"),
    options: ALL_PROVIDERS.map((provider) => ({
      value: provider,
      label: PROVIDER_LABELS[provider],
    })),
    initialValues: initialSelection,
    required: true,
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const normalized = normalizeProviderSelection(
    Array.isArray(selected) ? selected : [],
  );
  if (normalized.length === 0) {
    throw new Error("At least one provider must be selected.");
  }

  return normalized;
}

function normalizeProviderSelection(
  providers: readonly string[] | undefined,
): Provider[] {
  const selected = new Set<Provider>();
  for (const provider of providers ?? []) {
    const normalized = provider.trim().toLowerCase() as Provider;
    if (ALL_PROVIDERS.includes(normalized)) {
      selected.add(normalized);
    }
  }
  return [...selected];
}

function syncProviderAgents(options: {
  provider: Provider;
  paths: ScopePaths;
  agents: CanonicalAgent[];
  generated: Set<string>;
  dryRun: boolean;
}): void {
  const providerDir = getProviderAgentsDir(options.paths, options.provider);

  for (const agent of options.agents) {
    if (!isProviderEnabled(agent.frontmatter, options.provider)) continue;

    const providerConfig = getProviderConfig(
      agent.frontmatter,
      options.provider,
    );
    if (providerConfig === null) continue;

    if (options.provider === "codex") {
      continue;
    }

    const fileName =
      options.provider === "copilot"
        ? `${slugify(agent.name) || "agent"}.agent.md`
        : options.provider === "cursor"
          ? `${slugify(agent.name) || "agent"}.mdc`
          : `${slugify(agent.name) || "agent"}.md`;

    const outputPath = path.join(providerDir, fileName);
    const content = buildProviderAgentContent(
      options.provider,
      agent,
      providerConfig ?? {},
    );

    if (!options.dryRun) {
      ensureDir(path.dirname(outputPath));
      writeTextAtomic(outputPath, content);
    }

    options.generated.add(outputPath);
  }
}

function buildProviderAgentContent(
  provider: Provider,
  agent: CanonicalAgent,
  providerConfig: Record<string, unknown>,
): string {
  if (provider === "cursor") {
    const frontmatter = {
      description: agent.description,
      alwaysApply: false,
      ...providerConfig,
    };
    const fm = YAML.stringify(frontmatter).trimEnd();
    return `---\n${fm}\n---\n\n${agent.body.trimStart()}${agent.body.endsWith("\n") ? "" : "\n"}`;
  }

  const frontmatter = {
    name: agent.name,
    description: agent.description,
    ...providerConfig,
  };

  const fm = YAML.stringify(frontmatter).trimEnd();
  return `---\n${fm}\n---\n\n${agent.body.trimStart()}${agent.body.endsWith("\n") ? "" : "\n"}`;
}

function getProviderAgentsDir(paths: ScopePaths, provider: Provider): string {
  const workspaceRoot = paths.workspaceRoot;
  const home = paths.homeDir;

  switch (provider) {
    case "cursor":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".cursor", "rules")
        : path.join(home, ".cursor", "rules");
    case "claude":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".claude", "agents")
        : path.join(home, ".claude", "agents");
    case "codex":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".codex", "agents")
        : path.join(home, ".codex", "agents");
    case "opencode":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".opencode", "agents")
        : path.join(home, ".config", "opencode", "agents");
    case "gemini":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".gemini", "agents")
        : path.join(home, ".gemini", "agents");
    case "copilot":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".github", "agents")
        : path.join(home, ".vscode", "chatmodes");
    default:
      return path.join(workspaceRoot, ".agents", "unknown");
  }
}

function syncProviderCommands(options: {
  provider: Provider;
  paths: ScopePaths;
  commands: ReturnType<typeof parseCommandsDir>;
  generated: Set<string>;
  dryRun: boolean;
}): void {
  const providerDir = getProviderCommandsDir(options.paths, options.provider);

  for (const command of options.commands) {
    const fileName = mapProviderCommandFileName(
      options.provider,
      command.fileName,
    );
    const outputPath = path.join(providerDir, fileName);

    if (!options.dryRun) {
      ensureDir(path.dirname(outputPath));
      writeTextAtomic(outputPath, command.content);
    }

    options.generated.add(outputPath);
  }
}

function mapProviderCommandFileName(
  provider: Provider,
  fileName: string,
): string {
  const lower = fileName.toLowerCase();

  if (provider === "copilot") {
    if (lower.endsWith(".prompt.md")) return fileName;
    if (lower.endsWith(".md")) {
      return `${fileName.slice(0, -3)}.prompt.md`;
    }
    if (lower.endsWith(".mdc")) {
      return `${fileName.slice(0, -4)}.prompt.md`;
    }

    const ext = path.extname(fileName);
    if (ext) {
      return `${fileName.slice(0, -ext.length)}.prompt.md`;
    }
    return `${fileName}.prompt.md`;
  }

  if (lower.endsWith(".mdc")) {
    return `${fileName.slice(0, -4)}.md`;
  }

  return fileName;
}

function getProviderCommandsDir(paths: ScopePaths, provider: Provider): string {
  const workspaceRoot = paths.workspaceRoot;
  const home = paths.homeDir;

  switch (provider) {
    case "cursor":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".cursor", "commands")
        : path.join(home, ".cursor", "commands");
    case "claude":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".claude", "commands")
        : path.join(home, ".claude", "commands");
    case "codex":
      return path.join(home, ".codex", "prompts");
    case "opencode":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".opencode", "commands")
        : path.join(home, ".config", "opencode", "commands");
    case "gemini":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".gemini", "commands")
        : path.join(home, ".gemini", "commands");
    case "copilot":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".github", "prompts")
        : path.join(home, ".github", "prompts");
    default:
      return path.join(workspaceRoot, ".agents", "unknown", "commands");
  }
}

function syncProviderMcp(options: {
  providers: Provider[];
  paths: ScopePaths;
  mcp: ReturnType<typeof readCanonicalMcp>;
  generated: Set<string>;
  dryRun: boolean;
}): void {
  for (const provider of options.providers) {
    if (provider === "codex") continue;
    const resolved = resolveMcpForProvider(options.mcp, provider);

    if (provider === "cursor") {
      const outputPath =
        options.paths.scope === "local"
          ? path.join(options.paths.workspaceRoot, ".cursor", "mcp.json")
          : path.join(options.paths.homeDir, ".cursor", "mcp.json");

      const payload = {
        mcpServers: mapMcpServers(resolved, ["url", "command", "args", "env"]),
      };

      maybeWriteJson(outputPath, payload, options.dryRun);
      options.generated.add(outputPath);
      continue;
    }

    if (provider === "claude") {
      const mcpPath =
        options.paths.scope === "local"
          ? path.join(options.paths.workspaceRoot, ".mcp.json")
          : path.join(options.paths.homeDir, ".mcp.json");

      const settingsPath =
        options.paths.scope === "local"
          ? path.join(options.paths.workspaceRoot, ".claude", "settings.json")
          : path.join(options.paths.homeDir, ".claude.json");

      const claudeServers = mapMcpServers(resolved, [
        "type",
        "url",
        "command",
        "args",
        "env",
      ]);

      for (const [serverName, config] of Object.entries(claudeServers)) {
        if (!("type" in config) && typeof config.url === "string") {
          config.type = "http";
        }
      }

      maybeWriteJson(mcpPath, { mcpServers: claudeServers }, options.dryRun);
      options.generated.add(mcpPath);

      const settings =
        readJsonIfExists<Record<string, unknown>>(settingsPath) ?? {};
      settings.enabledMcpjsonServers = Object.keys(claudeServers).sort();
      maybeWriteJson(settingsPath, settings, options.dryRun);
      options.generated.add(settingsPath);
      continue;
    }

    if (provider === "opencode") {
      const outputPath =
        options.paths.scope === "local"
          ? path.join(options.paths.workspaceRoot, ".opencode", "opencode.json")
          : path.join(
              options.paths.homeDir,
              ".config",
              "opencode",
              "opencode.json",
            );

      const existing =
        readJsonIfExists<Record<string, unknown>>(outputPath) ?? {};
      const mcp: Record<string, Record<string, unknown>> = {};

      for (const [serverName, config] of Object.entries(resolved)) {
        if (typeof config.url === "string") {
          mcp[serverName] = {
            type: "remote",
            url: config.url,
          };
        } else {
          mcp[serverName] = {
            type: "local",
            command: config.command,
            args: Array.isArray(config.args) ? config.args : undefined,
          };
        }

        if (isObject(config.env)) {
          mcp[serverName].environment = config.env;
        }
      }

      const payload = {
        ...existing,
        mcp,
      };

      maybeWriteJson(outputPath, payload, options.dryRun);
      options.generated.add(outputPath);
      continue;
    }

    if (provider === "gemini") {
      const outputPath =
        options.paths.scope === "local"
          ? path.join(options.paths.workspaceRoot, ".gemini", "settings.json")
          : path.join(options.paths.homeDir, ".gemini", "settings.json");

      const existing =
        readJsonIfExists<Record<string, unknown>>(outputPath) ?? {};
      const experimental = isObject(existing.experimental)
        ? { ...existing.experimental }
        : {};
      experimental.enableAgents = true;

      const mcpServers: Record<string, Record<string, unknown>> = {};
      for (const [serverName, config] of Object.entries(resolved)) {
        const mapped: Record<string, unknown> = {};
        if (typeof config.url === "string") mapped.httpUrl = config.url;
        if (typeof config.command === "string") mapped.command = config.command;
        if (Array.isArray(config.args)) mapped.args = config.args;
        if (isObject(config.env)) mapped.env = config.env;
        mcpServers[serverName] = mapped;
      }

      const payload = {
        ...existing,
        experimental,
        mcpServers,
      };

      maybeWriteJson(outputPath, payload, options.dryRun);
      options.generated.add(outputPath);
      continue;
    }

    if (provider === "copilot") {
      const profileMcpPath =
        options.paths.scope === "local"
          ? path.join(options.paths.workspaceRoot, ".vscode", "mcp.json")
          : path.join(options.paths.homeDir, ".vscode", "mcp.json");

      const copilotServers = mapMcpServers(resolved, [
        "type",
        "url",
        "command",
        "args",
        "env",
        "tools",
      ]);

      for (const config of Object.values(copilotServers)) {
        if (!Array.isArray(config.tools)) {
          config.tools = ["*"];
        }
        if (!config.type) {
          config.type = config.url ? "http" : "local";
        }
      }

      maybeWriteJson(
        profileMcpPath,
        { mcpServers: copilotServers },
        options.dryRun,
      );
      options.generated.add(profileMcpPath);

      if (options.paths.scope === "global") {
        const settingsPath = getVsCodeSettingsPath(options.paths.homeDir);
        const settings =
          readJsonIfExists<Record<string, unknown>>(settingsPath) ?? {};
        settings["mcp.servers"] = copilotServers;
        maybeWriteJson(settingsPath, settings, options.dryRun);
        options.generated.add(settingsPath);
      }
    }
  }
}

function syncCodex(options: {
  paths: ScopePaths;
  agents: CanonicalAgent[];
  resolvedMcp: Record<string, Record<string, unknown>>;
  generated: Set<string>;
  manifest: SyncManifest;
  nextManifest: SyncManifest;
  dryRun: boolean;
  includeRoles: boolean;
  includeMcp: boolean;
}): void {
  const codexDir =
    options.paths.scope === "local"
      ? path.join(options.paths.workspaceRoot, ".codex")
      : path.join(options.paths.homeDir, ".codex");
  const codexConfigPath = path.join(codexDir, "config.toml");
  const codexAgentsDir = path.join(codexDir, "agents");

  const rawConfig = fs.existsSync(codexConfigPath)
    ? fs.readFileSync(codexConfigPath, "utf8")
    : "";

  const parsed = rawConfig.trim()
    ? (TOML.parse(rawConfig) as Record<string, unknown>)
    : {};

  const features = isObject(parsed.features) ? { ...parsed.features } : {};
  features.multi_agent = true;
  parsed.features = features;

  const agentsTable = isObject(parsed.agents) ? { ...parsed.agents } : {};
  const trackedRoles = resolveTrackedCodexEntries(
    options.manifest.codex?.roles,
    Object.keys(agentsTable),
  );
  const mcpServers = isObject(parsed.mcp_servers)
    ? { ...parsed.mcp_servers }
    : {};
  const trackedServers = resolveTrackedCodexEntries(
    options.manifest.codex?.mcpServers,
    Object.keys(mcpServers),
  );

  let nextRoles = [...trackedRoles];
  if (options.includeRoles) {
    const previousRoles = new Set(trackedRoles);
    nextRoles = [];
    const enabledCodexRoles = new Set(
      options.agents
        .filter((agent) => isProviderEnabled(agent.frontmatter, "codex"))
        .map((agent) => slugify(agent.name))
        .filter((role) => role.length > 0),
    );

    for (const oldRole of previousRoles) {
      if (!enabledCodexRoles.has(oldRole)) {
        delete agentsTable[oldRole];
      }
    }

    for (const agent of options.agents) {
      if (!isProviderEnabled(agent.frontmatter, "codex")) continue;
      const codexConfig = getProviderConfig(agent.frontmatter, "codex") ?? {};
      const role = slugify(agent.name);
      if (!role) continue;

      const roleTomlPath = path.join(codexAgentsDir, `${role}.toml`);
      const roleInstructionsPath = path.join(
        codexAgentsDir,
        `${role}.instructions.md`,
      );

      const roleToml = buildCodexRoleToml(roleInstructionsPath, codexConfig);

      if (!options.dryRun) {
        ensureDir(codexAgentsDir);
        writeTextAtomic(roleInstructionsPath, `${agent.body.trimStart()}\n`);
        writeTextAtomic(roleTomlPath, TOML.stringify(roleToml as TOML.JsonMap));
      }

      options.generated.add(roleTomlPath);
      options.generated.add(roleInstructionsPath);

      agentsTable[role] = {
        description: agent.description,
        config_file: `./agents/${role}.toml`,
      };

      nextRoles.push(role);
    }

    parsed.agents = agentsTable;
  }

  let nextServers = [...trackedServers];
  if (options.includeMcp) {
    const previousServers = new Set(trackedServers);

    for (const oldServer of previousServers) {
      if (
        !Object.prototype.hasOwnProperty.call(options.resolvedMcp, oldServer)
      ) {
        delete mcpServers[oldServer];
      }
    }

    for (const [serverName, config] of Object.entries(options.resolvedMcp)) {
      const mapped: Record<string, unknown> = {};
      if (typeof config.url === "string") mapped.url = config.url;
      if (typeof config.command === "string") mapped.command = config.command;
      if (Array.isArray(config.args)) mapped.args = config.args;
      if (isObject(config.env)) mapped.env = config.env;
      mcpServers[serverName] = mapped;
    }

    parsed.mcp_servers = mcpServers;
    nextServers = Object.keys(options.resolvedMcp).sort();
  }

  if (!options.dryRun) {
    ensureDir(codexDir);
    writeTextAtomic(codexConfigPath, TOML.stringify(parsed as TOML.JsonMap));
  }

  options.generated.add(codexConfigPath);

  options.nextManifest.codex = {
    roles: nextRoles.sort(),
    mcpServers: nextServers.sort(),
  };
}

function resolveTrackedCodexEntries(
  trackedEntries: string[] | undefined,
  fallbackEntries: string[],
): string[] {
  const tracked = Array.isArray(trackedEntries) ? trackedEntries : [];
  return [...new Set([...tracked, ...fallbackEntries])].sort();
}

function buildCodexRoleToml(
  roleInstructionsPath: string,
  providerConfig: Record<string, unknown>,
): Record<string, unknown> {
  const roleToml: Record<string, unknown> = {
    model_instructions_file: `./${path.basename(roleInstructionsPath)}`,
  };

  if (typeof providerConfig.model === "string") {
    roleToml.model = providerConfig.model;
  }

  if (typeof providerConfig.reasoningEffort === "string") {
    roleToml.model_reasoning_effort = providerConfig.reasoningEffort;
  }

  if (typeof providerConfig.approvalPolicy === "string") {
    roleToml.approval_policy = providerConfig.approvalPolicy;
  }

  if (typeof providerConfig.sandboxMode === "string") {
    roleToml.sandbox_mode = providerConfig.sandboxMode;
  }

  if (typeof providerConfig.webSearch === "boolean") {
    roleToml.tools = {
      web_search: providerConfig.webSearch,
    };
  }

  return roleToml;
}

function mapMcpServers(
  servers: Record<string, Record<string, unknown>>,
  allowedKeys: string[],
): Record<string, Record<string, unknown>> {
  const allowed = new Set(allowedKeys);
  const mapped: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(servers)) {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (allowed.has(key)) {
        next[key] = value;
      }
    }
    mapped[name] = next;
  }

  return mapped;
}

function maybeWriteJson(
  filePath: string,
  payload: unknown,
  dryRun: boolean,
): void {
  if (dryRun) return;
  ensureDir(path.dirname(filePath));
  writeJsonAtomic(filePath, payload);
}

async function removeStaleGeneratedFiles(options: {
  oldManifest: SyncManifest;
  newManifest: SyncManifest;
  dryRun: boolean;
  yes: boolean;
  nonInteractive: boolean;
}): Promise<string[]> {
  const oldSet = new Set(options.oldManifest.generatedFiles);
  const newSet = new Set(options.newManifest.generatedFiles);
  const stale = [...oldSet].filter((filePath) => !newSet.has(filePath));

  const removed: string[] = [];

  for (const filePath of stale) {
    if (!fs.existsSync(filePath)) continue;

    if (options.dryRun) {
      removed.push(filePath);
      continue;
    }

    if (!options.yes && !options.nonInteractive) {
      const shouldDelete = await confirm({
        message: `Remove stale generated file ${toPosixPath(filePath)}?`,
        initialValue: true,
      });

      if (isCancel(shouldDelete)) {
        continue;
      }

      if (!shouldDelete) {
        continue;
      }
    }

    removeFileIfExists(filePath);
    removed.push(filePath);
  }

  return removed;
}

function getVsCodeSettingsPath(homeDir: string): string {
  switch (os.platform()) {
    case "darwin":
      return path.join(
        homeDir,
        "Library",
        "Application Support",
        "Code",
        "User",
        "settings.json",
      );
    case "win32": {
      const appData = process.env.APPDATA;
      if (!appData) {
        return path.join(
          homeDir,
          "AppData",
          "Roaming",
          "Code",
          "User",
          "settings.json",
        );
      }
      return path.join(appData, "Code", "User", "settings.json");
    }
    default:
      return path.join(homeDir, ".config", "Code", "User", "settings.json");
  }
}

function normalizeGeneratedByEntity(
  manifest: SyncManifest,
): Partial<Record<EntityType, string[]>> {
  const source = manifest.generatedByEntity;
  if (!source || typeof source !== "object") {
    return inferGeneratedByEntityFromLegacyFiles(manifest.generatedFiles);
  }

  return {
    agent: Array.isArray(source.agent) ? [...source.agent] : [],
    command: Array.isArray(source.command) ? [...source.command] : [],
    mcp: Array.isArray(source.mcp) ? [...source.mcp] : [],
    skill: Array.isArray(source.skill) ? [...source.skill] : [],
  };
}

function inferGeneratedByEntityFromLegacyFiles(
  generatedFiles: string[],
): Partial<Record<EntityType, string[]>> {
  const byEntity: Partial<Record<EntityType, string[]>> = {
    agent: [],
    command: [],
    mcp: [],
    skill: [],
  };

  for (const filePath of generatedFiles) {
    for (const entity of classifyLegacyGeneratedFile(filePath)) {
      byEntity[entity]?.push(filePath);
    }
  }

  return pruneGeneratedByEntity(byEntity);
}

function classifyLegacyGeneratedFile(filePath: string): EntityType[] {
  const normalized = toPosixPath(filePath).toLowerCase();

  if (isLegacyCodexConfigPath(normalized)) {
    return ["agent", "mcp"];
  }

  if (isLegacyCommandOutputPath(normalized)) {
    return ["command"];
  }

  if (isLegacyAgentOutputPath(normalized)) {
    return ["agent"];
  }

  if (isLegacyMcpOutputPath(normalized)) {
    return ["mcp"];
  }

  // Preserve unknown generated paths during scoped syncs.
  return ["agent", "command", "mcp"];
}

function isLegacyCommandOutputPath(normalizedPath: string): boolean {
  return (
    normalizedPath.includes("/.cursor/commands/") ||
    normalizedPath.includes("/.claude/commands/") ||
    normalizedPath.includes("/.opencode/commands/") ||
    normalizedPath.includes("/.gemini/commands/") ||
    normalizedPath.includes("/.github/prompts/") ||
    normalizedPath.includes("/.codex/prompts/")
  );
}

function isLegacyAgentOutputPath(normalizedPath: string): boolean {
  return (
    normalizedPath.includes("/.cursor/rules/") ||
    normalizedPath.includes("/.claude/agents/") ||
    normalizedPath.includes("/.opencode/agents/") ||
    normalizedPath.includes("/.gemini/agents/") ||
    normalizedPath.includes("/.github/agents/") ||
    normalizedPath.includes("/.codex/agents/")
  );
}

function isLegacyMcpOutputPath(normalizedPath: string): boolean {
  return (
    normalizedPath.endsWith("/.cursor/mcp.json") ||
    normalizedPath.endsWith("/.mcp.json") ||
    normalizedPath.endsWith("/.claude/settings.json") ||
    normalizedPath.endsWith("/.opencode/opencode.json") ||
    normalizedPath.endsWith("/.gemini/settings.json") ||
    normalizedPath.endsWith("/.vscode/mcp.json") ||
    normalizedPath.endsWith("/code/user/settings.json")
  );
}

function isLegacyCodexConfigPath(normalizedPath: string): boolean {
  return normalizedPath.endsWith("/.codex/config.toml");
}

function pruneGeneratedByEntity(
  value: Partial<Record<EntityType, string[]>>,
): Partial<Record<EntityType, string[]>> {
  const next: Partial<Record<EntityType, string[]>> = {};

  for (const entity of ["agent", "command", "mcp", "skill"] as const) {
    const files = value[entity];
    if (!files || files.length === 0) continue;
    next[entity] = [...new Set(files)].sort();
  }

  return next;
}

export function formatSyncSummary(
  summary: SyncSummary,
  agentsRoot: string,
): string {
  const generated = summary.generatedFiles
    .map((filePath) => relativePosix(agentsRoot, filePath))
    .sort();
  const removed = summary.removedFiles
    .map((filePath) => relativePosix(agentsRoot, filePath))
    .sort();

  const lines = [
    `Providers: ${summary.providers.join(", ")}`,
    `Generated/updated files: ${generated.length}`,
  ];

  if (removed.length > 0) {
    lines.push(`Removed stale files: ${removed.length}`);
  }

  return lines.join("\n");
}
