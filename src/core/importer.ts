import fs from "node:fs";
import path from "node:path";
import {
  cancel,
  isCancel,
  multiselect,
  select,
  text as promptText,
} from "@clack/prompts";
import type {
  CanonicalAgent,
  CanonicalMcpFile,
  LockEntry,
  ScopePaths,
} from "../types.js";
import {
  buildAgentMarkdown,
  parseAgentsDir,
  targetFileNameForAgent,
} from "./agents.js";
import {
  ensureDir,
  hashContent,
  readJsonIfExists,
  relativePosix,
  slugify,
  writeTextAtomic,
} from "./fs.js";
import { readLockfile, upsertLockEntry, writeLockfile } from "./lockfile.js";
import { readCanonicalMcp, writeCanonicalMcp } from "./mcp.js";
import {
  discoverSourceAgentsDir,
  discoverSourceMcpPath,
  prepareSource,
} from "./sources.js";

export class NonInteractiveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonInteractiveConflictError";
  }
}

export interface ImportOptions {
  source: string;
  ref?: string;
  subdir?: string;
  rename?: string;
  agents?: string[];
  promptForAgentSelection?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  paths: ScopePaths;
}

export interface ImportSummary {
  source: string;
  sourceType: "local" | "github" | "git";
  importedAgents: string[];
  importedMcpServers: string[];
  resolvedCommit: string;
}

interface AgentsToImportResult {
  selectedAgents: CanonicalAgent[];
  requestedAgentsForLock?: string[];
}

export async function importSource(
  options: ImportOptions,
): Promise<ImportSummary> {
  const prepared = prepareSource({
    source: options.source,
    ref: options.ref,
    subdir: options.subdir,
  });

  try {
    const sourceAgentsDir = discoverSourceAgentsDir(prepared.importRoot);
    const sourceMcpPath = discoverSourceMcpPath(prepared.importRoot);

    const sourceAgents = parseAgentsDir(sourceAgentsDir);
    if (sourceAgents.length === 0) {
      throw new Error(`No agent files found in ${sourceAgentsDir}.`);
    }
    const selection = await resolveAgentsToImport({
      sourceAgents,
      requestedAgents: options.agents,
      yes: !!options.yes,
      nonInteractive: !!options.nonInteractive,
      promptForAgentSelection: options.promptForAgentSelection ?? true,
    });
    const { selectedAgents } = selection;

    ensureDir(options.paths.agentsDir);

    const importedAgents: string[] = [];
    const importedAgentHashes: string[] = [];

    for (const [index, agent] of selectedAgents.entries()) {
      let targetFileName = targetFileNameForAgent(agent);

      if (options.rename && selectedAgents.length === 1) {
        targetFileName = `${slugify(options.rename) || "agent"}.md`;
      }

      const resolvedFileName = await resolveAgentConflict({
        targetFileName,
        agentContent: buildAgentMarkdown(agent.frontmatter, agent.body),
        paths: options.paths,
        yes: !!options.yes,
        nonInteractive: !!options.nonInteractive,
        promptLabel: `${agent.name} (${index + 1}/${selectedAgents.length})`,
      });

      if (!resolvedFileName) continue;

      const targetPath = path.join(options.paths.agentsDir, resolvedFileName);
      const content = buildAgentMarkdown(agent.frontmatter, agent.body);
      writeTextAtomic(targetPath, content);
      importedAgents.push(relativePosix(options.paths.agentsRoot, targetPath));
      importedAgentHashes.push(hashContent(content));
    }

    const importedMcpServers: string[] = [];

    if (sourceMcpPath) {
      const sourceMcp = normalizeMcp(
        readJsonIfExists<Record<string, unknown>>(sourceMcpPath),
      );
      const targetMcp = readCanonicalMcp(options.paths);

      const merged = await resolveMcpConflict({
        sourceMcp,
        targetMcp,
        yes: !!options.yes,
        nonInteractive: !!options.nonInteractive,
      });

      writeCanonicalMcp(options.paths, merged);
      importedMcpServers.push(...Object.keys(sourceMcp.mcpServers));
    }

    const lockfile = readLockfile(options.paths);
    const contentHash = hashContent(
      JSON.stringify({
        agents: importedAgentHashes,
        mcp: importedMcpServers,
      }),
    );

    const lockEntry: LockEntry = {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      requestedRef: options.ref,
      requestedAgents: selection.requestedAgentsForLock,
      resolvedCommit: prepared.resolvedCommit,
      subdir: options.subdir,
      importedAt: new Date().toISOString(),
      importedAgents,
      importedMcpServers,
      contentHash,
    };

    upsertLockEntry(lockfile, lockEntry);
    writeLockfile(options.paths, lockfile);

    return {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      importedAgents,
      importedMcpServers,
      resolvedCommit: prepared.resolvedCommit,
    };
  } finally {
    prepared.cleanup();
  }
}

async function resolveAgentsToImport(options: {
  sourceAgents: CanonicalAgent[];
  requestedAgents?: string[];
  yes: boolean;
  nonInteractive: boolean;
  promptForAgentSelection: boolean;
}): Promise<AgentsToImportResult> {
  const requestedAgents = normalizeRequestedAgents(options.requestedAgents);
  if (requestedAgents && requestedAgents.length > 0) {
    const selected = resolveRequestedAgents(
      options.sourceAgents,
      requestedAgents,
    );
    if (selected.length === 0) {
      throw new Error("No agents matched the requested --agent filters.");
    }
    return {
      selectedAgents: selected,
      // Persist stable selectors so updates keep targeting the same source agents
      // even if a previously-fallback selector later gains a new exact match.
      requestedAgentsForLock: getStableRequestedAgentsForLock({
        selectedAgents: selected,
        sourceAgents: options.sourceAgents,
      }),
    };
  }

  if (
    options.yes ||
    options.nonInteractive ||
    options.sourceAgents.length <= 1 ||
    !options.promptForAgentSelection
  ) {
    return { selectedAgents: options.sourceAgents };
  }

  const selected = await promptAgentSelection(options.sourceAgents);
  if (selected.length === 0) {
    throw new Error(
      "No agents selected. Use --agent <name> or rerun and select at least one agent.",
    );
  }
  const requestedAgentsForLock =
    selected.length < options.sourceAgents.length
      ? getStableRequestedAgentsForLock({
          selectedAgents: selected,
          sourceAgents: options.sourceAgents,
        })
      : undefined;
  return { selectedAgents: selected, requestedAgentsForLock };
}

function normalizeRequestedAgents(
  requestedAgents?: string[],
): string[] | undefined {
  if (!requestedAgents || requestedAgents.length === 0) return undefined;

  const normalized = requestedAgents.map((item) => item.trim()).filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function getStableRequestedAgentsForLock(options: {
  selectedAgents: CanonicalAgent[];
  sourceAgents: CanonicalAgent[];
}): string[] | undefined {
  const nameCounts = new Map<string, number>();

  for (const agent of options.sourceAgents) {
    const normalizedName = normalizeAgentSelector(agent.name);
    if (!normalizedName) continue;
    nameCounts.set(normalizedName, (nameCounts.get(normalizedName) ?? 0) + 1);
  }

  const selectors = options.selectedAgents.map((agent) => {
    const normalizedName = normalizeAgentSelector(agent.name);
    if (normalizedName && nameCounts.get(normalizedName) === 1) {
      return agent.name;
    }
    return agent.fileName.replace(/\.md$/i, "");
  });

  return normalizeRequestedAgents(selectors);
}

function resolveRequestedAgents(
  sourceAgents: CanonicalAgent[],
  requestedAgents: string[],
): CanonicalAgent[] {
  const selectedPaths = new Set<string>();
  const missing: string[] = [];
  const ambiguous: string[] = [];

  for (const requestedAgent of requestedAgents) {
    const exactMatches = sourceAgents.filter((agent) =>
      agentMatchesSelector(agent, requestedAgent, false),
    );
    const matches =
      exactMatches.length > 0
        ? exactMatches
        : sourceAgents.filter((agent) =>
            agentMatchesSelector(agent, requestedAgent, true),
          );

    if (matches.length === 0) {
      missing.push(requestedAgent);
      continue;
    }

    if (matches.length > 1) {
      ambiguous.push(
        `${requestedAgent} (${matches.map((agent) => agent.name).join(", ")})`,
      );
      continue;
    }

    if (matches[0]) {
      selectedPaths.add(matches[0].sourcePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Requested agent(s) not found: ${missing.join(", ")}. Available agents: ${sourceAgents.map((agent) => agent.name).join(", ")}.`,
    );
  }

  if (ambiguous.length > 0) {
    throw new Error(
      `Requested agent selector is ambiguous: ${ambiguous.join("; ")}. Use the exact frontmatter name.`,
    );
  }

  return sourceAgents.filter((agent) => selectedPaths.has(agent.sourcePath));
}

function agentMatchesSelector(
  agent: CanonicalAgent,
  selector: string,
  includeSlugFallback: boolean,
): boolean {
  const normalizedSelector = normalizeAgentSelector(selector);
  if (!normalizedSelector) return false;
  if (getExactAgentSelectorCandidates(agent).has(normalizedSelector)) {
    return true;
  }
  if (!includeSlugFallback) return false;

  const selectorSlug = normalizeAgentSelector(slugify(selector));
  return (
    selectorSlug !== "" &&
    getSlugAgentSelectorCandidates(agent).has(selectorSlug)
  );
}

function getExactAgentSelectorCandidates(agent: CanonicalAgent): Set<string> {
  const fileBaseName = agent.fileName.replace(/\.md$/i, "");
  return new Set(
    [
      agent.name,
      fileBaseName,
      path.basename(agent.sourcePath).replace(/\.md$/i, ""),
    ]
      .map(normalizeAgentSelector)
      .filter(Boolean),
  );
}

function getSlugAgentSelectorCandidates(agent: CanonicalAgent): Set<string> {
  const fileBaseName = agent.fileName.replace(/\.md$/i, "");
  return new Set(
    [
      slugify(agent.name),
      slugify(fileBaseName),
      slugify(path.basename(agent.sourcePath).replace(/\.md$/i, "")),
    ]
      .map(normalizeAgentSelector)
      .filter(Boolean),
  );
}

function normalizeAgentSelector(value: string): string {
  return value.trim().toLowerCase();
}

async function promptAgentSelection(
  sourceAgents: CanonicalAgent[],
): Promise<CanonicalAgent[]> {
  const choice = await multiselect({
    message: "Select agents to import",
    options: sourceAgents.map((agent) => ({
      value: agent.sourcePath,
      label: agent.name,
      hint: agent.description,
    })),
    initialValues: sourceAgents.map((agent) => agent.sourcePath),
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selected = new Set(Array.isArray(choice) ? choice.map(String) : []);
  return sourceAgents.filter((agent) => selected.has(agent.sourcePath));
}

async function resolveAgentConflict(options: {
  targetFileName: string;
  agentContent: string;
  paths: ScopePaths;
  yes: boolean;
  nonInteractive: boolean;
  promptLabel: string;
}): Promise<string | null> {
  const targetPath = path.join(options.paths.agentsDir, options.targetFileName);
  if (!fs.existsSync(targetPath)) return options.targetFileName;

  const existing = fs.readFileSync(targetPath, "utf8");
  if (existing === options.agentContent) return options.targetFileName;

  if (options.yes) {
    return options.targetFileName;
  }

  if (options.nonInteractive) {
    throw new NonInteractiveConflictError(
      `Conflict for ${options.targetFileName}. Use --yes or run interactively.`,
    );
  }

  const choice = await select({
    message: `Agent conflict for ${options.promptLabel}`,
    options: [
      { value: "overwrite", label: `Overwrite ${options.targetFileName}` },
      { value: "skip", label: "Skip this agent" },
      { value: "rename", label: "Rename imported agent" },
    ],
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "skip") return null;

  if (choice === "rename") {
    const entered = await promptText({
      message: `New filename (without extension) for ${options.promptLabel}`,
      placeholder: options.targetFileName.replace(/\.md$/, ""),
      validate(value) {
        if (!value.trim()) return "Name is required.";
        if (/[\\/]/.test(value)) return "Use a simple filename.";
        return undefined;
      },
    });

    if (isCancel(entered)) {
      cancel("Operation cancelled.");
      process.exit(1);
    }

    const renamedFileName = `${slugify(String(entered)) || "agent"}.md`;
    return resolveAgentConflict({
      ...options,
      targetFileName: renamedFileName,
    });
  }

  return options.targetFileName;
}

function normalizeMcp(raw: Record<string, unknown> | null): CanonicalMcpFile {
  if (!raw) {
    return {
      version: 1,
      mcpServers: {},
    };
  }

  if (typeof raw.mcpServers === "object" && raw.mcpServers !== null) {
    return {
      version: 1,
      mcpServers: raw.mcpServers as Record<string, Record<string, unknown>>,
    };
  }

  return {
    version: 1,
    mcpServers: {},
  };
}

async function resolveMcpConflict(options: {
  sourceMcp: CanonicalMcpFile;
  targetMcp: CanonicalMcpFile;
  yes: boolean;
  nonInteractive: boolean;
}): Promise<CanonicalMcpFile> {
  const sourceNames = Object.keys(options.sourceMcp.mcpServers);
  const targetNames = new Set(Object.keys(options.targetMcp.mcpServers));
  const overlap = sourceNames.filter((name) => targetNames.has(name));

  if (overlap.length === 0 || options.yes) {
    return mergeMcp(options.targetMcp, options.sourceMcp);
  }

  if (options.nonInteractive) {
    throw new NonInteractiveConflictError(
      "MCP server conflicts found. Use --yes or run interactively.",
    );
  }

  const choice = await select({
    message: `MCP conflicts detected for: ${overlap.join(", ")}`,
    options: [
      { value: "merge", label: "Merge (source servers override overlaps)" },
      { value: "replace", label: "Replace destination MCP with source MCP" },
    ],
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "replace") {
    return {
      version: 1,
      mcpServers: { ...options.sourceMcp.mcpServers },
    };
  }

  return mergeMcp(options.targetMcp, options.sourceMcp);
}

function mergeMcp(
  target: CanonicalMcpFile,
  source: CanonicalMcpFile,
): CanonicalMcpFile {
  return {
    version: 1,
    mcpServers: {
      ...target.mcpServers,
      ...source.mcpServers,
    },
  };
}
