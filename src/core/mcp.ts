import type {
	CanonicalMcpFile,
	CanonicalMcpServer,
	Provider,
	ScopePaths,
} from "../types.js";
import { isObject, readJsonIfExists, writeJsonAtomic } from "./fs.js";

const EMPTY_MCP: CanonicalMcpFile = {
	version: 1,
	mcpServers: {},
};

export function readCanonicalMcp(
	paths: Pick<ScopePaths, "mcpPath">,
): CanonicalMcpFile {
	const parsed = readJsonIfExists<Record<string, unknown>>(paths.mcpPath);
	if (!parsed) return { ...EMPTY_MCP };

	if (isObject(parsed) && isObject(parsed.mcpServers)) {
		return {
			version: 1,
			mcpServers: parsed.mcpServers as Record<string, CanonicalMcpServer>,
		};
	}

	return {
		version: 1,
		mcpServers: {},
	};
}

export function writeCanonicalMcp(
	paths: Pick<ScopePaths, "mcpPath">,
	value: CanonicalMcpFile,
): void {
	writeJsonAtomic(paths.mcpPath, {
		version: 1,
		mcpServers: value.mcpServers,
	});
}

function deepMerge(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base };

	for (const [key, value] of Object.entries(override)) {
		const prev = result[key];
		if (isObject(prev) && isObject(value)) {
			result[key] = deepMerge(prev, value);
		} else {
			result[key] = value;
		}
	}

	return result;
}

function normalizeServer(server: CanonicalMcpServer): {
	base: Record<string, unknown>;
	providers: Partial<Record<Provider, Record<string, unknown> | false>>;
} {
	const normalizedBase: Record<string, unknown> = {};
	const providers: Partial<Record<Provider, Record<string, unknown> | false>> =
		isObject(server.providers)
			? (server.providers as Partial<
					Record<Provider, Record<string, unknown> | false>
				>)
			: {};

	if (isObject(server.base)) {
		Object.assign(normalizedBase, server.base);
	}

	for (const [key, value] of Object.entries(server)) {
		if (key === "base" || key === "providers") continue;
		normalizedBase[key] = value;
	}

	return {
		base: normalizedBase,
		providers,
	};
}

export function resolveMcpForProvider(
	mcp: CanonicalMcpFile,
	provider: Provider,
): Record<string, Record<string, unknown>> {
	const resolved: Record<string, Record<string, unknown>> = {};

	for (const [serverName, rawServer] of Object.entries(mcp.mcpServers)) {
		const server = normalizeServer(rawServer);
		const providerOverride = server.providers[provider];

		if (providerOverride === false) continue;

		if (isObject(providerOverride)) {
			resolved[serverName] = deepMerge(server.base, providerOverride);
		} else {
			resolved[serverName] = { ...server.base };
		}
	}

	return resolved;
}
