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
  normalizeCommandSelector,
  parseCommandsDir,
  resolveCommandSelections,
} from "./commands.js";
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
  discoverSourceCommandsDir,
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
  importAgents?: boolean;
  importCommands?: boolean;
  requireCommands?: boolean;
  importMcp?: boolean;
  commandSelectors?: string[];
  commandRenameMap?: Record<string, string>;
  promptForCommands?: boolean;
}

export interface ImportSummary {
  source: string;
  sourceType: "local" | "github" | "git";
  importedAgents: string[];
  importedCommands: string[];
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
  const shouldImportAgents = options.importAgents ?? true;
  const shouldImportCommands = options.importCommands ?? true;
  const shouldImportMcp = options.importMcp ?? true;

  if (!shouldImportAgents && !shouldImportCommands && !shouldImportMcp) {
    throw new Error("No import targets selected.");
  }

  const prepared = prepareSource({
    source: options.source,
    ref: options.ref,
    subdir: options.subdir,
  });

  try {
    const sourceAgentsDir = shouldImportAgents
      ? discoverSourceAgentsDir(prepared.importRoot)
      : null;
    const sourceCommandsDir = shouldImportCommands
      ? discoverSourceCommandsDir(prepared.importRoot)
      : null;
    const sourceMcpPath = shouldImportMcp
      ? discoverSourceMcpPath(prepared.importRoot)
      : null;

    const sourceAgents = sourceAgentsDir ? parseAgentsDir(sourceAgentsDir) : [];
    const sourceCommands = sourceCommandsDir
      ? parseCommandsDir(sourceCommandsDir)
      : [];
    const hasExplicitCommandSelection =
      (options.commandSelectors?.length ?? 0) > 0;

    if (shouldImportAgents && sourceAgents.length === 0) {
      throw new Error(`No agent files found in ${sourceAgentsDir}.`);
    }
    if (shouldImportCommands && options.requireCommands && !sourceCommandsDir) {
      throw new Error(
        `No source commands directory found under ${prepared.importRoot} (expected commands/ or .agents/commands/).`,
      );
    }
    if (
      shouldImportCommands &&
      options.requireCommands &&
      sourceCommands.length === 0
    ) {
      throw new Error(`No command files found in ${sourceCommandsDir}.`);
    }

    const selection: AgentsToImportResult = shouldImportAgents
      ? await resolveAgentsToImport({
          sourceAgents,
          requestedAgents: options.agents,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptForAgentSelection: options.promptForAgentSelection ?? true,
        })
      : { selectedAgents: [] };

    const importedAgents: string[] = [];
    if (shouldImportAgents) {
      ensureDir(options.paths.agentsDir);

      for (const [index, agent] of selection.selectedAgents.entries()) {
        let targetFileName = targetFileNameForAgent(agent);

        if (
          options.rename &&
          selection.selectedAgents.length === 1 &&
          !(shouldImportCommands && hasExplicitCommandSelection)
        ) {
          targetFileName = `${slugify(options.rename) || "agent"}.md`;
        }

        const resolvedFileName = await resolveAgentConflict({
          targetFileName,
          agentContent: buildAgentMarkdown(agent.frontmatter, agent.body),
          paths: options.paths,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptLabel: `${agent.name} (${index + 1}/${selection.selectedAgents.length})`,
        });

        if (!resolvedFileName) continue;

        const targetPath = path.join(options.paths.agentsDir, resolvedFileName);
        const content = buildAgentMarkdown(agent.frontmatter, agent.body);
        writeTextAtomic(targetPath, content);
        importedAgents.push(
          relativePosix(options.paths.agentsRoot, targetPath),
        );
      }
    }

    const importedCommands: string[] = [];
    const importedCommandRenameMap: Record<string, string> = {};
    let selectedSourceCommandFiles: string[] = [];
    if (shouldImportCommands && sourceCommandsDir) {
      const selectedSourceCommands = await resolveCommandsToImport({
        sourceCommands,
        selectors: options.commandSelectors ?? [],
        promptForCommands: Boolean(options.promptForCommands),
        nonInteractive: Boolean(options.nonInteractive),
      });
      selectedSourceCommandFiles = selectedSourceCommands.map(
        (command) => command.fileName,
      );

      ensureDir(options.paths.commandsDir);

      for (const [index, command] of selectedSourceCommands.entries()) {
        let targetFileName = command.fileName;

        const mappedTargetFileName = resolveMappedTargetFileName(
          command.fileName,
          options.commandRenameMap,
        );
        if (mappedTargetFileName) {
          targetFileName = mappedTargetFileName;
        } else if (
          options.rename &&
          selectedSourceCommands.length === 1 &&
          (!shouldImportAgents || hasExplicitCommandSelection)
        ) {
          targetFileName = `${slugify(options.rename) || "command"}.md`;
        }

        const resolvedFileName = await resolveCommandConflict({
          targetFileName,
          commandContent: command.content,
          paths: options.paths,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptLabel: `${command.fileName} (${index + 1}/${selectedSourceCommands.length})`,
        });

        if (!resolvedFileName) continue;

        const targetPath = path.join(
          options.paths.commandsDir,
          resolvedFileName,
        );
        writeTextAtomic(targetPath, command.content);
        importedCommands.push(
          relativePosix(options.paths.agentsRoot, targetPath),
        );
        importedCommandRenameMap[command.fileName] = resolvedFileName;
      }
    }

    const importedMcpServers: string[] = [];

    if (shouldImportMcp && sourceMcpPath) {
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
    const existingEntry = findMatchingLockEntry(lockfile.entries, {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      subdir: options.subdir,
      requestedAgents: shouldImportAgents
        ? selection.requestedAgentsForLock
        : options.agents,
    });
    const isCommandOnlyImport =
      !shouldImportAgents && shouldImportCommands && !shouldImportMcp;

    const lockImportedAgents = shouldImportAgents
      ? importedAgents
      : (existingEntry?.importedAgents ?? []);
    const lockImportedCommands = shouldImportCommands
      ? isCommandOnlyImport
        ? uniqueStrings([
            ...(existingEntry?.importedCommands ?? []),
            ...importedCommands,
          ])
        : importedCommands
      : (existingEntry?.importedCommands ?? []);
    const lockImportedMcpServers = shouldImportMcp
      ? importedMcpServers
      : (existingEntry?.importedMcpServers ?? []);
    const selectedSubsetOfSourceCommands =
      sourceCommands.length > 0 &&
      selectedSourceCommandFiles.length < sourceCommands.length;

    let lockSelectedSourceCommands: string[] | undefined;
    if (shouldImportCommands) {
      if (isCommandOnlyImport) {
        lockSelectedSourceCommands = uniqueStrings([
          ...(existingEntry?.selectedSourceCommands ?? []),
          ...selectedSourceCommandFiles,
        ]);
      } else if (
        hasExplicitCommandSelection ||
        selectedSubsetOfSourceCommands
      ) {
        lockSelectedSourceCommands = [...selectedSourceCommandFiles];
      } else {
        lockSelectedSourceCommands = undefined;
      }
    } else {
      lockSelectedSourceCommands = existingEntry?.selectedSourceCommands;
    }
    let lockCommandRenameMap: Record<string, string> | undefined;
    if (shouldImportCommands) {
      if (isCommandOnlyImport) {
        lockCommandRenameMap = mergeCommandRenameMaps(
          existingEntry?.commandRenameMap,
          importedCommandRenameMap,
        );
      } else {
        lockCommandRenameMap = normalizeCommandRenameMap(
          importedCommandRenameMap,
        );
      }
    } else {
      lockCommandRenameMap = existingEntry?.commandRenameMap;
    }

    const contentHash = hashContent(
      JSON.stringify({
        agents: lockImportedAgents,
        commands: lockImportedCommands,
        selectedSourceCommands: lockSelectedSourceCommands ?? [],
        commandRenameMap: lockCommandRenameMap ?? {},
        mcp: lockImportedMcpServers,
      }),
    );

    const lockEntry: LockEntry = {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      requestedRef: options.ref,
      requestedAgents: shouldImportAgents
        ? selection.requestedAgentsForLock
        : existingEntry?.requestedAgents,
      resolvedCommit: prepared.resolvedCommit,
      subdir: options.subdir,
      importedAt: new Date().toISOString(),
      importedAgents: lockImportedAgents,
      importedCommands: lockImportedCommands,
      selectedSourceCommands: lockSelectedSourceCommands,
      commandRenameMap: lockCommandRenameMap,
      importedMcpServers: lockImportedMcpServers,
      contentHash,
    };

    upsertLockEntry(lockfile, lockEntry);
    writeLockfile(options.paths, lockfile);

    return {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      importedAgents,
      importedCommands,
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

function findMatchingLockEntry(
  entries: LockEntry[],
  key: Pick<LockEntry, "source" | "sourceType" | "subdir" | "requestedAgents">,
): LockEntry | undefined {
  return entries.find(
    (entry) =>
      entry.source === key.source &&
      entry.sourceType === key.sourceType &&
      entry.subdir === key.subdir &&
      sameRequestedAgentsForMatch(entry.requestedAgents, key.requestedAgents),
  );
}

function sameRequestedAgentsForMatch(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const normalizedLeft = normalizeRequestedAgentsForMatch(left);
  const normalizedRight = normalizeRequestedAgentsForMatch(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function normalizeRequestedAgentsForMatch(
  value: string[] | undefined,
): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  return [
    ...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean)),
  ].sort();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeCommandRenameMap(
  renameMap: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!renameMap) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(renameMap).filter(
      ([sourceFileName, importedFileName]) =>
        sourceFileName.trim().length > 0 && importedFileName.trim().length > 0,
    ),
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function mergeCommandRenameMaps(
  existing: Record<string, string> | undefined,
  updates: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const merged = {
    ...(existing ?? {}),
    ...(updates ?? {}),
  };

  return normalizeCommandRenameMap(merged);
}

function resolveMappedTargetFileName(
  sourceFileName: string,
  renameMap: Record<string, string> | undefined,
): string | undefined {
  if (!renameMap) return undefined;

  const normalizedSourceName = normalizeCommandSelector(sourceFileName);
  for (const [sourceSelector, importedName] of Object.entries(renameMap)) {
    if (normalizeCommandSelector(sourceSelector) !== normalizedSourceName) {
      continue;
    }

    const importedBaseName = path.basename(importedName.trim());
    if (!importedBaseName) return undefined;

    const importedExtension = path.extname(importedBaseName);
    if (importedExtension) return importedBaseName;

    const sourceExtension = path.extname(sourceFileName) || ".md";
    return `${slugify(importedBaseName) || "command"}${sourceExtension}`;
  }

  return undefined;
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

async function resolveCommandConflict(options: {
  targetFileName: string;
  commandContent: string;
  paths: ScopePaths;
  yes: boolean;
  nonInteractive: boolean;
  promptLabel: string;
}): Promise<string | null> {
  const targetPath = path.join(
    options.paths.commandsDir,
    options.targetFileName,
  );
  if (!fs.existsSync(targetPath)) return options.targetFileName;

  const existing = fs.readFileSync(targetPath, "utf8");
  if (existing === options.commandContent) return options.targetFileName;

  if (options.yes) {
    return options.targetFileName;
  }

  if (options.nonInteractive) {
    throw new NonInteractiveConflictError(
      `Conflict for ${options.targetFileName}. Use --yes or run interactively.`,
    );
  }

  const choice = await select({
    message: `Command conflict for ${options.promptLabel}`,
    options: [
      { value: "overwrite", label: `Overwrite ${options.targetFileName}` },
      { value: "skip", label: "Skip this command" },
      { value: "rename", label: "Rename imported command" },
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
      placeholder: options.targetFileName.replace(/\.(md|mdc)$/i, ""),
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

    const extension = path.extname(options.targetFileName) || ".md";
    const renamedFileName = `${slugify(String(entered)) || "command"}${extension}`;
    return resolveCommandConflict({
      ...options,
      targetFileName: renamedFileName,
    });
  }

  return options.targetFileName;
}

async function resolveCommandsToImport(options: {
  sourceCommands: ReturnType<typeof parseCommandsDir>;
  selectors: string[];
  promptForCommands: boolean;
  nonInteractive: boolean;
}): Promise<ReturnType<typeof parseCommandsDir>> {
  const selectors = options.selectors
    .map((selector) => selector.trim())
    .filter(Boolean);

  if (selectors.length > 0) {
    const { selected, unmatched } = resolveCommandSelections(
      options.sourceCommands,
      selectors,
    );

    if (unmatched.length > 0) {
      throw new Error(
        `Command(s) not found in source: ${unmatched.join(", ")}. Available: ${options.sourceCommands.map((item) => item.fileName).join(", ")}`,
      );
    }

    return selected;
  }

  if (!options.promptForCommands || options.nonInteractive) {
    return options.sourceCommands;
  }

  const selected = await multiselect({
    message: "Select commands to import",
    options: options.sourceCommands.map((item) => ({
      value: item.fileName,
      label: item.fileName,
    })),
    initialValues: options.sourceCommands.map((item) => item.fileName),
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selectedNames = Array.isArray(selected)
    ? new Set(selected.map((value) => String(value)))
    : new Set<string>();

  return options.sourceCommands.filter((item) =>
    selectedNames.has(item.fileName),
  );
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
