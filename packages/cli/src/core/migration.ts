import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { cancel, isCancel, select } from "@clack/prompts";
import TOML from "@iarna/toml";
import matter from "gray-matter";
import { buildAgentMarkdown, parseAgentsDir } from "./agents.js";
import { parseCommandsDir } from "./commands.js";
import { ensureDir, isObject, readJsonIfExists, slugify } from "./fs.js";
import { readLockfile, writeLockfile } from "./lockfile.js";
import { readManifest, writeManifest } from "./manifest.js";
import { readCanonicalMcp, writeCanonicalMcp } from "./mcp.js";
import {
  getClaudeMcpPath,
  getCodexConfigPath,
  getCopilotMcpPath,
  getCursorMcpPath,
  getGeminiSettingsPath,
  getOpenCodeConfigPath,
  getPiMcpPath,
  getProviderAgentsDir,
  getProviderCommandsDir,
  getProviderSkillsPaths,
} from "./provider-paths.js";
import { readSettings, writeSettings } from "./settings.js";
import {
  applySkillProviderSideEffects,
  copySkillArtifacts,
  parseSkillsDir,
  skillContentMatchesTarget,
} from "./skills.js";
import { ALL_PROVIDERS } from "../types.js";
import type {
  AgentFrontmatter,
  CanonicalMcpFile,
  CanonicalMcpServer,
  EntityType,
  Provider,
  ScopePaths,
  SyncManifest,
} from "../types.js";

const PROVIDER_NAME_KEYS = new Set<string>(ALL_PROVIDERS);

export interface MigrationOptions {
  paths: ScopePaths;
  providers: Provider[];
  target: EntityType | "all";
  yes?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
  materializeCanonical?: boolean;
}

export interface MigrationEntitySummary {
  detected: number;
  imported: number;
  conflicts: number;
  skipped: number;
}

export interface MigrationSummary {
  providers: Provider[];
  target: EntityType | "all";
  entities: Record<EntityType, MigrationEntitySummary>;
}

export class MigrationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationConflictError";
  }
}

export function createEmptyMigrationSummary(
  providers: Provider[],
  target: EntityType | "all",
): MigrationSummary {
  return {
    providers: [...providers],
    target,
    entities: {
      agent: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      command: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      mcp: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
      skill: { detected: 0, imported: 0, conflicts: 0, skipped: 0 },
    },
  };
}

export function initializeCanonicalLayout(
  paths: ScopePaths,
  providers?: Provider[],
): void {
  ensureDir(paths.agentsRoot);
  ensureDir(paths.agentsDir);
  ensureDir(paths.commandsDir);
  ensureDir(paths.skillsDir);

  if (!fs.existsSync(paths.mcpPath)) {
    writeCanonicalMcp(
      { mcpPath: paths.mcpPath },
      { version: 1, mcpServers: {} },
    );
  }

  if (!fs.existsSync(paths.lockPath)) {
    writeLockfile(paths, {
      version: 1,
      entries: [],
    });
  } else {
    // Normalize existing lock format but never create synthetic entries.
    const current = readLockfile(paths);
    writeLockfile(paths, current);
  }

  const existingSettings = readSettings(paths.settingsPath);
  writeSettings(paths.settingsPath, {
    ...existingSettings,
    version: 1,
    lastScope: paths.scope,
    defaultProviders:
      providers && providers.length > 0
        ? dedupeProviders(providers)
        : existingSettings.defaultProviders,
  });

  if (!fs.existsSync(paths.manifestPath)) {
    const manifest: SyncManifest = {
      version: 1,
      generatedFiles: [],
      generatedByEntity: {},
    };
    writeManifest(paths, manifest);
    return;
  }

  const manifest = readManifest(paths);
  writeManifest(paths, manifest);
}

export async function migrateProviderStateToCanonical(
  options: MigrationOptions,
): Promise<MigrationSummary> {
  const summary = createEmptyMigrationSummary(
    options.providers,
    options.target,
  );

  if (includesTarget(options.target, "agent")) {
    await migrateAgents(options, summary.entities.agent);
  }

  if (includesTarget(options.target, "command")) {
    await migrateCommands(options, summary.entities.command);
  }

  if (includesTarget(options.target, "mcp")) {
    await migrateMcp(options, summary.entities.mcp);
  }

  if (includesTarget(options.target, "skill")) {
    await migrateSkills(options, summary.entities.skill);
  }

  return summary;
}

export function formatMigrationSummary(summary: MigrationSummary): string {
  const lines = ["Migration summary (provider -> canonical):"];
  for (const entity of ["agent", "command", "mcp", "skill"] as const) {
    const row = summary.entities[entity];
    lines.push(
      `${entity}: detected=${row.detected}, imported=${row.imported}, conflicts=${row.conflicts}, skipped=${row.skipped}`,
    );
  }
  return lines.join("\n");
}

interface ProviderAgentRecord {
  provider: Provider;
  sourcePath: string;
  key: string;
  name: string;
  description: string;
  body: string;
  providerConfig: Record<string, unknown>;
}

async function migrateAgents(
  options: MigrationOptions,
  summary: MigrationEntitySummary,
): Promise<void> {
  const canonicalAgents = parseAgentsDir(options.paths.agentsDir);
  const canonicalByKey = new Map<string, (typeof canonicalAgents)[number]>();
  for (const agent of canonicalAgents) {
    const key = agentKey(agent.name, agent.fileName);
    if (!canonicalByKey.has(key)) {
      canonicalByKey.set(key, agent);
    }
  }

  const recordsByKey = new Map<string, ProviderAgentRecord[]>();
  for (const provider of options.providers) {
    const records =
      provider === "codex"
        ? readCodexProviderAgents(options.paths)
        : readMarkdownProviderAgents(options.paths, provider);
    summary.detected += records.length;
    for (const record of records) {
      const next = recordsByKey.get(record.key) ?? [];
      next.push(record);
      recordsByKey.set(record.key, next);
    }
  }

  for (const [key, records] of recordsByKey.entries()) {
    if (records.length === 0) continue;
    const canonical = canonicalByKey.get(key);
    const existingRaw = canonical
      ? fs.readFileSync(canonical.sourcePath, "utf8")
      : null;

    const resolved = await resolveAgentMerge({
      key,
      canonical,
      records,
      paths: options.paths,
      yes: Boolean(options.yes),
      nonInteractive: Boolean(options.nonInteractive),
      onConflict() {
        summary.conflicts += 1;
      },
    });

    if (!resolved) {
      summary.skipped += 1;
      continue;
    }

    const changed =
      existingRaw === null ? true : existingRaw !== resolved.markdown;
    if (!changed) {
      summary.skipped += 1;
      continue;
    }

    if (shouldWriteCanonical(options)) {
      ensureDir(options.paths.agentsDir);
      fs.writeFileSync(resolved.outputPath, resolved.markdown, "utf8");
    }

    summary.imported += 1;
  }
}

function readMarkdownProviderAgents(
  paths: ScopePaths,
  provider: Provider,
): ProviderAgentRecord[] {
  const dirPath = getProviderAgentsDir(paths, provider);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .sort();

  const records: ProviderAgentRecord[] = [];
  for (const fileName of entries) {
    const sourcePath = path.join(dirPath, fileName);
    const raw = fs.readFileSync(sourcePath, "utf8");
    const parsed = matter(raw);
    const data = isObject(parsed.data) ? parsed.data : {};
    const parsedName =
      typeof data.name === "string" && data.name.trim().length > 0
        ? data.name.trim()
        : guessAgentNameFromFile(fileName);
    const parsedDescription =
      typeof data.description === "string" && data.description.trim().length > 0
        ? data.description.trim()
        : `Migrated from ${provider}`;
    const providerConfig = extractProviderConfigFromAgentFrontmatter(
      data,
      provider,
    );
    records.push({
      provider,
      sourcePath,
      key: agentKey(parsedName, fileName),
      name: parsedName,
      description: parsedDescription,
      body: parsed.content.trimStart(),
      providerConfig,
    });
  }

  return records;
}

function readCodexProviderAgents(paths: ScopePaths): ProviderAgentRecord[] {
  const configPath = getCodexConfigPath(paths);
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
    return [];
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = raw.trim() ? (TOML.parse(raw) as Record<string, unknown>) : {};
  const codexRootDir = path.dirname(configPath);
  const agentsTable = isObject(parsed.agents)
    ? (parsed.agents as Record<string, unknown>)
    : {};
  const records: ProviderAgentRecord[] = [];

  for (const [roleName, roleEntry] of Object.entries(agentsTable)) {
    const roleConfigFile = isObject(roleEntry)
      ? roleEntry.config_file
      : undefined;
    if (typeof roleConfigFile !== "string" || roleConfigFile.trim() === "") {
      continue;
    }

    const roleTomlPath = resolveCodexPath(codexRootDir, roleConfigFile);
    if (!fs.existsSync(roleTomlPath) || !fs.statSync(roleTomlPath).isFile()) {
      continue;
    }

    const roleTomlRaw = fs.readFileSync(roleTomlPath, "utf8");
    const roleToml = roleTomlRaw.trim()
      ? (TOML.parse(roleTomlRaw) as Record<string, unknown>)
      : {};
    const instructionRef = roleToml.model_instructions_file;
    const instructionPath =
      typeof instructionRef === "string" && instructionRef.trim().length > 0
        ? resolveCodexPath(path.dirname(roleTomlPath), instructionRef)
        : null;
    const body =
      instructionPath && fs.existsSync(instructionPath)
        ? fs.readFileSync(instructionPath, "utf8").trimStart()
        : "";

    const description =
      isObject(roleEntry) && typeof roleEntry.description === "string"
        ? roleEntry.description.trim()
        : roleName;

    const providerConfig: Record<string, unknown> = {};
    if (typeof roleToml.model === "string") {
      providerConfig.model = roleToml.model;
    }
    if (typeof roleToml.model_reasoning_effort === "string") {
      providerConfig.reasoningEffort = roleToml.model_reasoning_effort;
    }
    if (typeof roleToml.approval_policy === "string") {
      providerConfig.approvalPolicy = roleToml.approval_policy;
    }
    if (typeof roleToml.sandbox_mode === "string") {
      providerConfig.sandboxMode = roleToml.sandbox_mode;
    }
    if (
      isObject(roleToml.tools) &&
      typeof roleToml.tools.web_search === "boolean"
    ) {
      providerConfig.webSearch = roleToml.tools.web_search;
    }

    records.push({
      provider: "codex",
      sourcePath: roleTomlPath,
      key: agentKey(roleName, `${roleName}.md`),
      name: roleName,
      description: description || roleName,
      body,
      providerConfig,
    });
  }

  return records;
}

function resolveCodexPath(baseDir: string, referencePath: string): string {
  const trimmed = referencePath.trim();
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(baseDir, trimmed);
}

function extractProviderConfigFromAgentFrontmatter(
  data: Record<string, unknown>,
  provider: Provider,
): Record<string, unknown> {
  const explicit = data[provider];
  if (isObject(explicit)) {
    return cloneRecord(explicit);
  }

  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "name" || key === "description") continue;
    if (PROVIDER_NAME_KEYS.has(key)) continue;
    config[key] = value;
  }
  return config;
}

function guessAgentNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.agent\.md$/i, "").replace(/\.md$/i, "");
  return base.trim() || "agent";
}

function agentKey(name: string, fileName: string): string {
  return slugify(name) || slugify(fileName.replace(/\.md$/i, "")) || "agent";
}

async function resolveAgentMerge(options: {
  key: string;
  canonical: ReturnType<typeof parseAgentsDir>[number] | undefined;
  records: ProviderAgentRecord[];
  paths: ScopePaths;
  yes: boolean;
  nonInteractive: boolean;
  onConflict: () => void;
}): Promise<{ outputPath: string; markdown: string } | null> {
  const records = dedupeAgentRecords(options.records);
  if (records.length === 0) {
    return null;
  }

  let name = options.canonical?.name ?? records[0].name;
  let description = options.canonical?.description ?? records[0].description;
  let body = options.canonical?.body ?? records[0].body;
  const frontmatter: AgentFrontmatter = options.canonical
    ? ({ ...options.canonical.frontmatter } as AgentFrontmatter)
    : ({
        name,
        description,
      } as AgentFrontmatter);

  if (!options.canonical && records.length > 1) {
    const first = records[0];
    const different = records.some(
      (record) => !sameAgentContent(first, record),
    );
    if (different) {
      options.onConflict();
      const chosen = await chooseProviderSource({
        conflictLabel: `agent "${options.key}"`,
        records,
        yes: options.yes,
        nonInteractive: options.nonInteractive,
      });
      name = chosen.name;
      description = chosen.description;
      body = chosen.body;
    }
  }

  if (options.canonical) {
    for (const record of records) {
      if (!sameAgentContent({ name, description, body }, record)) {
        options.onConflict();
        const decision = await resolveCanonicalConflict({
          conflictLabel: `agent "${record.key}" from ${record.provider}`,
          yes: options.yes,
          nonInteractive: options.nonInteractive,
        });
        if (decision === "provider") {
          name = record.name;
          description = record.description;
          body = record.body;
        }
      }
    }
  }

  for (const record of records) {
    frontmatter[record.provider] = cloneRecord(record.providerConfig);
  }
  frontmatter.name = name;
  frontmatter.description = description;

  const markdown = buildAgentMarkdown(frontmatter, body);
  const outputPath = options.canonical
    ? options.canonical.sourcePath
    : path.join(options.paths.agentsDir, `${options.key}.md`);

  return {
    outputPath,
    markdown,
  };
}

function dedupeAgentRecords(
  records: ProviderAgentRecord[],
): ProviderAgentRecord[] {
  const unique: ProviderAgentRecord[] = [];
  for (const record of records) {
    const match = unique.find(
      (item) =>
        item.provider === record.provider &&
        item.sourcePath === record.sourcePath,
    );
    if (!match) unique.push(record);
  }
  return unique;
}

function sameAgentContent(
  left: { name: string; description: string; body: string },
  right: { name: string; description: string; body: string },
): boolean {
  return (
    left.name.trim() === right.name.trim() &&
    left.description.trim() === right.description.trim() &&
    normalizeBody(left.body) === normalizeBody(right.body)
  );
}

interface ProviderCommandRecord {
  provider: Provider;
  sourcePath: string;
  targetFileName: string;
  content: string;
}

async function migrateCommands(
  options: MigrationOptions,
  summary: MigrationEntitySummary,
): Promise<void> {
  const canonicalCommands = parseCommandsDir(options.paths.commandsDir);
  const canonicalByFile = new Map(
    canonicalCommands.map((command) => [command.fileName, command] as const),
  );

  const grouped = new Map<string, ProviderCommandRecord[]>();
  for (const provider of options.providers) {
    const records = readProviderCommands(options.paths, provider);
    summary.detected += records.length;
    for (const record of records) {
      const next = grouped.get(record.targetFileName) ?? [];
      next.push(record);
      grouped.set(record.targetFileName, next);
    }
  }

  for (const [fileName, records] of grouped.entries()) {
    const canonical = canonicalByFile.get(fileName);
    let content = canonical?.content ?? records[0].content;
    let hadConflict = false;

    if (!canonical) {
      const allSame = records.every(
        (record) =>
          normalizeBody(record.content) === normalizeBody(records[0].content),
      );
      if (!allSame) {
        hadConflict = true;
        summary.conflicts += 1;
        const chosen = await resolveProviderDuplicateConflict({
          conflictLabel: `command "${fileName}"`,
          records,
          yes: Boolean(options.yes),
          nonInteractive: Boolean(options.nonInteractive),
        });
        content = chosen.content;
      }
    } else {
      for (const record of records) {
        if (normalizeBody(record.content) === normalizeBody(content)) continue;
        hadConflict = true;
        summary.conflicts += 1;
        const decision = await resolveCanonicalConflict({
          conflictLabel: `command "${fileName}" from ${record.provider}`,
          yes: Boolean(options.yes),
          nonInteractive: Boolean(options.nonInteractive),
        });
        if (decision === "provider") {
          content = record.content;
        }
      }
    }

    const hasChanged = canonical
      ? canonical.content !== content
      : records.length > 0;
    if (!hasChanged) {
      summary.skipped += hadConflict ? 0 : 1;
      continue;
    }

    if (shouldWriteCanonical(options)) {
      ensureDir(options.paths.commandsDir);
      fs.writeFileSync(
        path.join(options.paths.commandsDir, fileName),
        content,
        "utf8",
      );
    }

    summary.imported += 1;
  }
}

function readProviderCommands(
  paths: ScopePaths,
  provider: Provider,
): ProviderCommandRecord[] {
  // Codex prompts are home-scoped; importing them into local canonical state
  // causes unrelated global prompts to appear in fresh repositories.
  if (provider === "codex" && paths.scope === "local") {
    return [];
  }

  const commandsDir = getProviderCommandsDir(paths, provider);
  if (!fs.existsSync(commandsDir) || !fs.statSync(commandsDir).isDirectory()) {
    return [];
  }

  const files = parseCommandsDir(commandsDir);
  return files.map((file) => ({
    provider,
    sourcePath: file.sourcePath,
    targetFileName: toCanonicalCommandFileName(file.fileName),
    content: file.content,
  }));
}

function toCanonicalCommandFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".prompt.md")) {
    return `${fileName.slice(0, -".prompt.md".length)}.md`;
  }
  if (lower.endsWith(".mdc")) {
    return `${fileName.slice(0, -".mdc".length)}.md`;
  }
  if (lower.endsWith(".md")) {
    return fileName;
  }

  const ext = path.extname(fileName);
  if (ext.length > 0) {
    return `${fileName.slice(0, -ext.length)}.md`;
  }
  return `${fileName}.md`;
}

async function migrateMcp(
  options: MigrationOptions,
  summary: MigrationEntitySummary,
): Promise<void> {
  const canonical = readCanonicalMcp(options.paths);
  const merged: CanonicalMcpFile = {
    version: 1,
    mcpServers: cloneRecord(canonical.mcpServers),
  };

  const providerServers = collectProviderMcpServers(
    options.paths,
    options.providers,
  );
  summary.detected = providerServers.detected;

  for (const [serverName, byProvider] of providerServers.servers.entries()) {
    const existingServer = merged.mcpServers[serverName];
    const hasExisting = Boolean(existingServer);
    const normalizedExisting = normalizeCanonicalServer(existingServer);

    let base = normalizedExisting.base;
    let providerOverrides = cloneRecord(normalizedExisting.providers);

    if (!hasExisting) {
      const firstProvider = options.providers.find(
        (provider) => byProvider[provider],
      );
      if (!firstProvider) continue;
      base = cloneRecord(byProvider[firstProvider] ?? {});
      providerOverrides = {};

      for (const provider of ALL_PROVIDERS) {
        const config = byProvider[provider];
        if (!config) {
          providerOverrides[provider] = false;
          continue;
        }
        if (!isDeepStrictEqual(config, base)) {
          providerOverrides[provider] = cloneRecord(config);
        }
      }
    } else {
      for (const provider of options.providers) {
        const config = byProvider[provider];
        if (!config) continue;
        if (isDeepStrictEqual(config, base)) {
          delete providerOverrides[provider];
          continue;
        }
        providerOverrides[provider] = cloneRecord(config);
      }
    }

    const nextServer: CanonicalMcpServer = {
      base,
    };
    if (Object.keys(providerOverrides).length > 0) {
      nextServer.providers = providerOverrides;
    }

    if (isCanonicalServerEqual(existingServer, nextServer)) {
      summary.skipped += 1;
      continue;
    }

    merged.mcpServers[serverName] = nextServer;
    summary.imported += 1;
  }

  if (summary.imported > 0 && shouldWriteCanonical(options)) {
    writeCanonicalMcp(options.paths, merged);
  }
}

function collectProviderMcpServers(
  paths: ScopePaths,
  providers: Provider[],
): {
  detected: number;
  servers: Map<string, Partial<Record<Provider, Record<string, unknown>>>>;
} {
  let detected = 0;
  const servers = new Map<
    string,
    Partial<Record<Provider, Record<string, unknown>>>
  >();

  for (const provider of providers) {
    const providerServers = readProviderMcp(paths, provider);
    for (const [name, config] of Object.entries(providerServers)) {
      detected += 1;
      const current = servers.get(name) ?? {};
      current[provider] = cloneRecord(config);
      servers.set(name, current);
    }
  }

  return { detected, servers };
}

function readProviderMcp(
  paths: ScopePaths,
  provider: Provider,
): Record<string, Record<string, unknown>> {
  if (provider === "cursor") {
    return readJsonMcpServers(getCursorMcpPath(paths));
  }
  if (provider === "claude") {
    return readJsonMcpServers(getClaudeMcpPath(paths));
  }
  if (provider === "copilot") {
    return readJsonMcpServers(getCopilotMcpPath(paths));
  }
  if (provider === "opencode") {
    return readOpenCodeMcp(getOpenCodeConfigPath(paths));
  }
  if (provider === "gemini") {
    return readGeminiMcp(getGeminiSettingsPath(paths));
  }
  if (provider === "codex") {
    return readCodexMcp(getCodexConfigPath(paths));
  }
  if (provider === "pi") {
    return readJsonMcpServers(getPiMcpPath(paths));
  }
  return {};
}

function readJsonMcpServers(
  filePath: string,
): Record<string, Record<string, unknown>> {
  const parsed = readJsonIfExists<Record<string, unknown>>(filePath);
  if (!parsed || !isObject(parsed.mcpServers)) {
    return {};
  }
  return normalizeMcpServerRecord(parsed.mcpServers);
}

function readOpenCodeMcp(
  filePath: string,
): Record<string, Record<string, unknown>> {
  const parsed = readJsonIfExists<Record<string, unknown>>(filePath);
  if (!parsed || !isObject(parsed.mcp)) return {};

  const mapped: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(parsed.mcp)) {
    if (!isObject(config)) continue;
    const next: Record<string, unknown> = {};
    if (typeof config.url === "string") next.url = config.url;
    if (typeof config.command === "string") next.command = config.command;
    if (Array.isArray(config.args)) next.args = [...config.args];
    if (isObject(config.environment)) {
      next.env = cloneRecord(config.environment);
    }
    if (Object.keys(next).length > 0) {
      mapped[name] = next;
    }
  }
  return mapped;
}

function readGeminiMcp(
  filePath: string,
): Record<string, Record<string, unknown>> {
  const parsed = readJsonIfExists<Record<string, unknown>>(filePath);
  if (!parsed || !isObject(parsed.mcpServers)) return {};

  const mapped: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(parsed.mcpServers)) {
    if (!isObject(config)) continue;
    const next: Record<string, unknown> = {};
    if (typeof config.httpUrl === "string") next.url = config.httpUrl;
    if (typeof config.command === "string") next.command = config.command;
    if (Array.isArray(config.args)) next.args = [...config.args];
    if (isObject(config.env)) next.env = cloneRecord(config.env);
    if (Object.keys(next).length > 0) {
      mapped[name] = next;
    }
  }
  return mapped;
}

function readCodexMcp(
  filePath: string,
): Record<string, Record<string, unknown>> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = raw.trim() ? (TOML.parse(raw) as Record<string, unknown>) : {};
  if (!isObject(parsed.mcp_servers)) return {};
  return normalizeMcpServerRecord(parsed.mcp_servers);
}

function normalizeMcpServerRecord(
  raw: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(raw)) {
    if (!isObject(config)) continue;
    servers[name] = cloneRecord(config);
  }
  return servers;
}

function normalizeCanonicalServer(server: CanonicalMcpServer | undefined): {
  base: Record<string, unknown>;
  providers: Partial<Record<Provider, Record<string, unknown> | false>>;
} {
  if (!server) {
    return {
      base: {},
      providers: {},
    };
  }

  const base: Record<string, unknown> = isObject(server.base)
    ? cloneRecord(server.base)
    : {};
  for (const [key, value] of Object.entries(server)) {
    if (key === "base" || key === "providers") continue;
    base[key] = value;
  }

  const providers = isObject(server.providers)
    ? (cloneRecord(server.providers) as Partial<
        Record<Provider, Record<string, unknown> | false>
      >)
    : {};

  return { base, providers };
}

function isCanonicalServerEqual(
  left: CanonicalMcpServer | undefined,
  right: CanonicalMcpServer,
): boolean {
  if (!left) return false;
  return isDeepStrictEqual(
    normalizeCanonicalServer(left),
    normalizeCanonicalServer(right),
  );
}

async function migrateSkills(
  options: MigrationOptions,
  summary: MigrationEntitySummary,
): Promise<void> {
  const providerSkillDirs = getProviderSkillsPaths(
    options.paths,
    options.providers,
  )
    .filter((dirPath) => fs.existsSync(dirPath))
    .filter((dirPath) => {
      try {
        return fs.lstatSync(dirPath).isDirectory();
      } catch {
        return false;
      }
    });

  for (const providerSkillsDir of providerSkillDirs) {
    const providerLabel = providerSkillsDir.includes(
      `${path.sep}.cursor${path.sep}`,
    )
      ? "cursor"
      : providerSkillsDir.includes(`${path.sep}.pi${path.sep}`)
        ? "pi"
        : "claude";
    const skills = parseSkillsDir(providerSkillsDir);
    summary.detected += skills.length;

    for (const skill of skills) {
      const targetName =
        skill.layout === "nested"
          ? path.basename(skill.sourcePath)
          : slugify(skill.name) || "skill";
      const targetDir = path.join(options.paths.skillsDir, targetName);

      if (!fs.existsSync(targetDir)) {
        if (shouldWriteCanonical(options)) {
          ensureDir(options.paths.skillsDir);
          copySkillArtifacts(skill, targetDir);
        }
        summary.imported += 1;
        continue;
      }

      if (!fs.statSync(targetDir).isDirectory()) {
        summary.conflicts += 1;
        const decision = await resolveCanonicalConflict({
          conflictLabel: `skill "${targetName}" from ${providerLabel}`,
          yes: Boolean(options.yes),
          nonInteractive: Boolean(options.nonInteractive),
        });
        if (decision === "canonical") {
          summary.skipped += 1;
          continue;
        }

        if (shouldWriteCanonical(options)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
          ensureDir(options.paths.skillsDir);
          copySkillArtifacts(skill, targetDir);
        }

        summary.imported += 1;
        continue;
      }

      if (skillContentMatchesTarget(skill, targetDir)) {
        summary.skipped += 1;
        continue;
      }

      summary.conflicts += 1;
      const decision = await resolveCanonicalConflict({
        conflictLabel: `skill "${targetName}" from ${providerLabel}`,
        yes: Boolean(options.yes),
        nonInteractive: Boolean(options.nonInteractive),
      });

      if (decision === "canonical") {
        summary.skipped += 1;
        continue;
      }

      if (shouldWriteCanonical(options)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        copySkillArtifacts(skill, targetDir);
      }
      summary.imported += 1;
    }
  }

  applySkillProviderSideEffects({
    paths: options.paths,
    providers: options.providers,
    dryRun: Boolean(options.dryRun),
    warn(message) {
      // Keep migration non-fatal for provider-side cleanup path noise.
      console.warn(`Warning: ${message}`);
    },
  });
}

async function resolveCanonicalConflict(options: {
  conflictLabel: string;
  yes: boolean;
  nonInteractive: boolean;
}): Promise<"canonical" | "provider"> {
  if (options.yes || options.nonInteractive) {
    throw new MigrationConflictError(
      `Migration conflict for ${options.conflictLabel}.\nRun without --yes in an interactive terminal to choose between canonical and provider content.`,
    );
  }

  const choice = await select({
    message: `Conflict for ${options.conflictLabel}`,
    options: [
      { value: "canonical", label: "Keep canonical version" },
      { value: "provider", label: "Use provider version" },
    ],
    initialValue: "canonical",
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return choice === "provider" ? "provider" : "canonical";
}

async function resolveProviderDuplicateConflict(options: {
  conflictLabel: string;
  records: ProviderCommandRecord[];
  yes: boolean;
  nonInteractive: boolean;
}): Promise<ProviderCommandRecord> {
  if (options.yes || options.nonInteractive) {
    throw new MigrationConflictError(
      `Migration conflict for ${options.conflictLabel} across multiple providers.\nRun without --yes in an interactive terminal to select a source provider.`,
    );
  }

  const choice = await select({
    message: `Duplicate provider content for ${options.conflictLabel}`,
    options: options.records.map((record) => ({
      value: record.sourcePath,
      label: `${record.provider}: ${path.basename(record.sourcePath)}`,
    })),
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selected = options.records.find(
    (record) => record.sourcePath === choice,
  );
  if (!selected) {
    return options.records[0];
  }
  return selected;
}

async function chooseProviderSource(options: {
  conflictLabel: string;
  records: ProviderAgentRecord[];
  yes: boolean;
  nonInteractive: boolean;
}): Promise<ProviderAgentRecord> {
  if (options.yes || options.nonInteractive) {
    throw new MigrationConflictError(
      `Migration conflict for ${options.conflictLabel} across multiple providers.\nRun without --yes in an interactive terminal to select a source provider.`,
    );
  }

  const choice = await select({
    message: `Duplicate provider content for ${options.conflictLabel}`,
    options: options.records.map((record) => ({
      value: record.sourcePath,
      label: `${record.provider}: ${path.basename(record.sourcePath)}`,
    })),
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selected = options.records.find(
    (record) => record.sourcePath === choice,
  );
  if (!selected) {
    return options.records[0];
  }
  return selected;
}

function includesTarget(
  target: EntityType | "all",
  entity: EntityType,
): boolean {
  return target === "all" || target === entity;
}

function normalizeBody(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dedupeProviders(providers: Provider[]): Provider[] {
  const seen = new Set<Provider>();
  for (const provider of providers) {
    if (ALL_PROVIDERS.includes(provider)) {
      seen.add(provider);
    }
  }
  return [...seen];
}

function shouldWriteCanonical(options: MigrationOptions): boolean {
  return !options.dryRun || Boolean(options.materializeCanonical);
}
