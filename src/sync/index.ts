import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import TOML from "@iarna/toml";
import YAML from "yaml";
import type {
	CanonicalAgent,
	DotagentsSettings,
	Provider,
	ScopePaths,
	SyncManifest,
} from "../types.js";
import {
	getProviderConfig,
	isProviderEnabled,
	parseAgentsDir,
} from "../core/agents.js";
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
} from "../core/settings.js";

export interface SyncOptions {
	paths: ScopePaths;
	providers?: Provider[];
	yes?: boolean;
	nonInteractive?: boolean;
	dryRun?: boolean;
}

export interface SyncSummary {
	providers: Provider[];
	generatedFiles: string[];
	removedFiles: string[];
}

export async function syncFromCanonical(
	options: SyncOptions,
): Promise<SyncSummary> {
	const agents = parseAgentsDir(options.paths.agentsDir);
	const mcp = readCanonicalMcp(options.paths);
	const manifest = readManifest(options.paths);
	const settings = readSettings(options.paths.settingsPath);

	const providers = resolveProviders(options.providers, settings);

	const nextManifest: SyncManifest = {
		version: 1,
		generatedFiles: [],
		codex: {
			roles: [],
			mcpServers: [],
		},
	};

	const generated = new Set<string>();

	for (const provider of providers) {
		syncProviderAgents({
			provider,
			paths: options.paths,
			agents,
			generated,
			dryRun: !!options.dryRun,
		});
	}

	syncProviderMcp({
		providers,
		paths: options.paths,
		agents,
		mcp,
		generated,
		manifest,
		nextManifest,
		dryRun: !!options.dryRun,
	});

	nextManifest.generatedFiles = [...generated].sort();

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
		updateLastScope(
			getGlobalSettingsPath(options.paths.homeDir),
			options.paths.scope,
		);
	}

	return {
		providers,
		generatedFiles: nextManifest.generatedFiles,
		removedFiles,
	};
}

function resolveProviders(
	explicitProviders: Provider[] | undefined,
	settings: DotagentsSettings,
): Provider[] {
	if (explicitProviders && explicitProviders.length > 0) {
		return [...new Set(explicitProviders)];
	}

	if (settings.defaultProviders && settings.defaultProviders.length > 0) {
		return [...new Set(settings.defaultProviders)];
	}

	return ["cursor", "claude", "codex", "opencode", "gemini", "copilot"];
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

function syncProviderMcp(options: {
	providers: Provider[];
	paths: ScopePaths;
	agents: CanonicalAgent[];
	mcp: ReturnType<typeof readCanonicalMcp>;
	generated: Set<string>;
	manifest: SyncManifest;
	nextManifest: SyncManifest;
	dryRun: boolean;
}): void {
	for (const provider of options.providers) {
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

		if (provider === "codex") {
			syncCodex({
				paths: options.paths,
				agents: options.agents,
				resolvedMcp: resolved,
				generated: options.generated,
				manifest: options.manifest,
				nextManifest: options.nextManifest,
				dryRun: options.dryRun,
			});
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

	const previousRoles = new Set(options.manifest.codex?.roles ?? []);
	const nextRoles: string[] = [];
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

	const previousServers = new Set(options.manifest.codex?.mcpServers ?? []);
	const mcpServers = isObject(parsed.mcp_servers)
		? { ...parsed.mcp_servers }
		: {};

	for (const oldServer of previousServers) {
		if (!Object.prototype.hasOwnProperty.call(options.resolvedMcp, oldServer)) {
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

	if (!options.dryRun) {
		ensureDir(codexDir);
		writeTextAtomic(codexConfigPath, TOML.stringify(parsed as TOML.JsonMap));
	}

	options.generated.add(codexConfigPath);

	options.nextManifest.codex = {
		roles: nextRoles.sort(),
		mcpServers: Object.keys(options.resolvedMcp).sort(),
	};
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
