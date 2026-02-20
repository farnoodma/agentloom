export const ALL_PROVIDERS = [
	"cursor",
	"claude",
	"codex",
	"opencode",
	"gemini",
	"copilot",
] as const;

export type Provider = (typeof ALL_PROVIDERS)[number];

export type Scope = "local" | "global";

export interface AgentFrontmatter {
	name: string;
	description: string;
	cursor?: Record<string, unknown> | false;
	claude?: Record<string, unknown> | false;
	codex?: Record<string, unknown> | false;
	opencode?: Record<string, unknown> | false;
	gemini?: Record<string, unknown> | false;
	copilot?: Record<string, unknown> | false;
	[key: string]: unknown;
}

export interface CanonicalAgent {
	name: string;
	description: string;
	body: string;
	frontmatter: AgentFrontmatter;
	sourcePath: string;
	fileName: string;
}

export interface LockEntry {
	source: string;
	sourceType: "local" | "github" | "git";
	requestedRef?: string;
	resolvedCommit: string;
	subdir?: string;
	importedAt: string;
	importedAgents: string[];
	importedMcpServers: string[];
	contentHash: string;
}

export interface AgentsLockFile {
	version: 1;
	entries: LockEntry[];
}

export interface CanonicalMcpServer {
	base?: Record<string, unknown>;
	providers?: Partial<Record<Provider, Record<string, unknown> | false>>;
	[key: string]: unknown;
}

export interface CanonicalMcpFile {
	version: 1;
	mcpServers: Record<string, CanonicalMcpServer>;
}

export interface ScopePaths {
	scope: Scope;
	workspaceRoot: string;
	homeDir: string;
	agentsRoot: string;
	agentsDir: string;
	mcpPath: string;
	lockPath: string;
	settingsPath: string;
	manifestPath: string;
}

export interface DotagentsSettings {
	version: 1;
	lastScope?: Scope;
	defaultProviders?: Provider[];
	telemetry?: {
		enabled?: boolean;
	};
}

export interface SyncManifest {
	version: 1;
	generatedFiles: string[];
	codex?: {
		roles?: string[];
		mcpServers?: string[];
	};
}
