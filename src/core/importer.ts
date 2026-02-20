import fs from "node:fs";
import path from "node:path";
import { cancel, isCancel, select, text as promptText } from "@clack/prompts";
import type { CanonicalMcpFile, LockEntry, ScopePaths } from "../types.js";
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

    ensureDir(options.paths.agentsDir);

    const importedAgents: string[] = [];
    const importedAgentHashes: string[] = [];

    for (const [index, agent] of sourceAgents.entries()) {
      let targetFileName = targetFileNameForAgent(agent);

      if (options.rename && sourceAgents.length === 1) {
        targetFileName = `${slugify(options.rename) || "agent"}.md`;
      }

      const resolvedFileName = await resolveAgentConflict({
        targetFileName,
        agentContent: buildAgentMarkdown(agent.frontmatter, agent.body),
        paths: options.paths,
        yes: !!options.yes,
        nonInteractive: !!options.nonInteractive,
        promptLabel: `${agent.name} (${index + 1}/${sourceAgents.length})`,
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
