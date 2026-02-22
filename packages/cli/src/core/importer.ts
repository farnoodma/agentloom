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
  EntityType,
  Provider,
  LockEntry,
  SelectionMode,
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
  mapProvidersToSkillsAgents,
  parseSkillsDir,
  resolveSkillSelections,
  runSkillsCommand,
  type CanonicalSkill,
} from "./skills.js";
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
  discoverSourceSkillsDir,
  prepareSource,
} from "./sources.js";

export class NonInteractiveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonInteractiveConflictError";
  }
}

const MULTISELECT_HELP_TEXT = "↑↓ move, space select, enter confirm";

function withMultiselectHelp(message: string): string {
  return `${message}\n${MULTISELECT_HELP_TEXT}`;
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
  requireAgents?: boolean;
  importCommands?: boolean;
  requireCommands?: boolean;
  importMcp?: boolean;
  requireMcp?: boolean;
  mcpSelectors?: string[];
  promptForMcp?: boolean;
  importSkills?: boolean;
  requireSkills?: boolean;
  skillSelectors?: string[];
  promptForSkills?: boolean;
  skillsProviders?: Provider[];
  resolveSkillsProviders?: () => Promise<Provider[] | undefined>;
  skillsAgentTargets?: string[];
  selectionMode?: SelectionMode;
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
  importedSkills: string[];
  resolvedCommit: string;
}

interface AgentsToImportResult {
  selectedAgents: CanonicalAgent[];
  requestedAgentsForLock?: string[];
}

interface CommandSelectionResult {
  selectedCommands: ReturnType<typeof parseCommandsDir>;
  selectionMode: SelectionMode;
}

interface McpSelectionResult {
  selectedServerNames: string[];
  selectionMode: SelectionMode;
}

interface SkillSelectionResult {
  selectedSkills: CanonicalSkill[];
  selectionMode: SelectionMode;
}

interface SelectionModeResolution {
  selectionMode: SelectionMode;
  skipImport: boolean;
}

export async function importSource(
  options: ImportOptions,
): Promise<ImportSummary> {
  const shouldImportAgents = options.importAgents ?? true;
  const requireAgents = options.requireAgents ?? shouldImportAgents;
  const shouldImportCommands = options.importCommands ?? true;
  const shouldImportMcp = options.importMcp ?? true;
  const shouldImportSkills = options.importSkills ?? false;

  if (
    !shouldImportAgents &&
    !shouldImportCommands &&
    !shouldImportMcp &&
    !shouldImportSkills
  ) {
    throw new Error("No import targets selected.");
  }

  const prepared = prepareSource({
    source: options.source,
    ref: options.ref,
    subdir: options.subdir,
  });
  const normalizedSubdir = options.subdir?.replace(/^\/+|\/+$/g, "");
  const sourceLocation =
    prepared.spec.type === "github"
      ? `https://github.com/${prepared.spec.source}/tree/${prepared.resolvedCommit}${normalizedSubdir ? `/${normalizedSubdir}` : ""}`
      : options.subdir
        ? `${options.source} (subdir: ${options.subdir})`
        : options.source;

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
    const sourceSkillsDir = shouldImportSkills
      ? discoverSourceSkillsDir(prepared.importRoot)
      : null;

    const sourceAgents = sourceAgentsDir ? parseAgentsDir(sourceAgentsDir) : [];
    const sourceCommands = sourceCommandsDir
      ? parseCommandsDir(sourceCommandsDir)
      : [];
    const sourceMcp = sourceMcpPath
      ? normalizeMcp(readJsonIfExists<Record<string, unknown>>(sourceMcpPath))
      : null;
    const sourceSkills = sourceSkillsDir ? parseSkillsDir(sourceSkillsDir) : [];
    const hasExplicitCommandSelection =
      (options.commandSelectors?.length ?? 0) > 0;
    const isAggregateImport =
      shouldImportAgents &&
      shouldImportCommands &&
      shouldImportMcp &&
      shouldImportSkills;

    if (shouldImportAgents && requireAgents && !sourceAgentsDir) {
      throw new Error(
        `No source agents directory found under ${prepared.importRoot} (expected agents/ or .agents/agents/).`,
      );
    }
    if (shouldImportAgents && requireAgents && sourceAgents.length === 0) {
      throw new Error(`No agent files found in ${sourceAgentsDir}.`);
    }
    if (shouldImportCommands && options.requireCommands && !sourceCommandsDir) {
      throw new Error(
        `No source commands directory found under ${prepared.importRoot} (expected .agents/commands/, commands/, or prompts/).`,
      );
    }
    if (
      shouldImportCommands &&
      options.requireCommands &&
      sourceCommands.length === 0
    ) {
      throw new Error(`No command files found in ${sourceCommandsDir}.`);
    }
    if (shouldImportMcp && options.requireMcp && !sourceMcpPath) {
      throw new Error(
        `No source mcp.json found under ${prepared.importRoot} (expected mcp.json or .agents/mcp.json).`,
      );
    }
    if (shouldImportSkills && options.requireSkills && !sourceSkillsDir) {
      throw new Error(
        `No source skills directory found under ${prepared.importRoot} (expected .agents/skills/, skills/, or root SKILL.md).`,
      );
    }
    if (
      shouldImportSkills &&
      options.requireSkills &&
      sourceSkills.length === 0
    ) {
      throw new Error(`No skills found in ${sourceSkillsDir}.`);
    }

    if (
      isAggregateImport &&
      sourceAgents.length === 0 &&
      sourceCommands.length === 0 &&
      sourceSkills.length === 0 &&
      Object.keys(sourceMcp?.mcpServers ?? {}).length === 0
    ) {
      throw new Error(
        `No importable entities found in source "${sourceLocation}".\nExpected agents/, .agents/agents/, commands/, .agents/commands/, prompts/, mcp.json/.agents/mcp.json, skills/, .agents/skills/, or root SKILL.md.`,
      );
    }

    const shouldResolveAgents =
      shouldImportAgents &&
      (sourceAgents.length > 0 ||
        (options.agents?.length ?? 0) > 0 ||
        requireAgents);

    const selection: AgentsToImportResult = shouldResolveAgents
      ? await resolveAgentsToImport({
          sourceAgents,
          requestedAgents: options.agents,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptForAgentSelection: options.promptForAgentSelection ?? true,
          selectionMode: options.selectionMode,
        })
      : { selectedAgents: [] };

    let selectedSourceCommands: ReturnType<typeof parseCommandsDir> = [];
    let selectedSourceCommandFiles: string[] = [];
    let commandSelectionMode: SelectionMode = "all";
    if (shouldImportCommands && sourceCommandsDir) {
      const commandSelection = await resolveCommandsToImport({
        sourceCommands,
        selectors: options.commandSelectors ?? [],
        promptForCommands: Boolean(options.promptForCommands),
        nonInteractive: Boolean(options.nonInteractive),
        selectionMode: options.selectionMode,
      });
      selectedSourceCommands = commandSelection.selectedCommands;
      commandSelectionMode = commandSelection.selectionMode;
      selectedSourceCommandFiles = selectedSourceCommands.map(
        (command) => command.fileName,
      );
    }

    let selectedSourceMcpServers: string[] = [];
    let sourceMcpServerNames: string[] = sourceMcp
      ? Object.keys(sourceMcp.mcpServers).sort()
      : [];
    let mcpSelectionMode: SelectionMode = "all";

    if (shouldImportMcp && sourceMcp) {
      const mcpSelection = await resolveMcpServersToImport({
        sourceMcp,
        selectors: options.mcpSelectors ?? [],
        promptForMcp: options.promptForMcp ?? true,
        nonInteractive: Boolean(options.nonInteractive),
        selectionMode: options.selectionMode,
      });
      selectedSourceMcpServers = mcpSelection.selectedServerNames;
      mcpSelectionMode = mcpSelection.selectionMode;
    }

    let selectedSkills: CanonicalSkill[] = [];
    let selectedSourceSkills: string[] = [];
    let skillSelectionMode: SelectionMode = "all";

    if (shouldImportSkills && sourceSkillsDir) {
      const skillSelection = await resolveSkillsToImport({
        sourceSkills,
        selectors: options.skillSelectors ?? [],
        promptForSkills: options.promptForSkills ?? true,
        nonInteractive: Boolean(options.nonInteractive),
        selectionMode: options.selectionMode,
      });
      selectedSkills = skillSelection.selectedSkills;
      skillSelectionMode = skillSelection.selectionMode;
      selectedSourceSkills = selectedSkills.map((skill) => skill.name);
    }

    const importedAgents: string[] = [];
    if (shouldImportAgents && selection.selectedAgents.length > 0) {
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
    if (shouldImportCommands && sourceCommandsDir) {
      if (selectedSourceCommands.length > 0) {
        ensureDir(options.paths.commandsDir);
      }

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
    if (shouldImportMcp && sourceMcp) {
      const selectedSourceMcp: CanonicalMcpFile = {
        version: 1,
        mcpServers: Object.fromEntries(
          selectedSourceMcpServers.map((serverName) => [
            serverName,
            sourceMcp.mcpServers[serverName] ?? {},
          ]),
        ),
      };

      if (selectedSourceMcpServers.length > 0) {
        const targetMcp = readCanonicalMcp(options.paths);

        const merged = await resolveMcpConflict({
          sourceMcp: selectedSourceMcp,
          targetMcp,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
        });

        writeCanonicalMcp(options.paths, merged);
      }

      importedMcpServers.push(...selectedSourceMcpServers);
    }

    const importedSkills: string[] = [];
    let skillsAgentTargetsForLock: string[] | undefined;
    if (shouldImportSkills && sourceSkillsDir) {
      if (selectedSkills.length > 0) {
        const args = ["add", prepared.importRoot, "--yes"];

        if (
          skillSelectionMode === "custom" ||
          selectedSkills.length < sourceSkills.length
        ) {
          for (const skill of selectedSkills) {
            args.push("--skill", skill.name);
          }
        }

        if (options.paths.scope === "global") {
          args.push("--global");
        }

        if (
          options.skillsAgentTargets &&
          options.skillsAgentTargets.length > 0
        ) {
          for (const target of options.skillsAgentTargets) {
            args.push("--agent", target);
          }
          skillsAgentTargetsForLock = [...new Set(options.skillsAgentTargets)];
        } else {
          const resolvedSkillsProviders =
            options.skillsProviders && options.skillsProviders.length > 0
              ? options.skillsProviders
              : await options.resolveSkillsProviders?.();

          if (resolvedSkillsProviders && resolvedSkillsProviders.length > 0) {
            const mappedTargets = mapProvidersToSkillsAgents(
              resolvedSkillsProviders,
            );
            for (const target of mappedTargets) {
              args.push("--agent", target);
            }
            skillsAgentTargetsForLock = mappedTargets;
          }
        }

        runSkillsCommand({
          args,
          cwd: options.paths.workspaceRoot,
          inheritStdio: !options.nonInteractive,
        });
      }

      importedSkills.push(...selectedSourceSkills);
    }

    const selectedSubsetOfSourceCommands =
      sourceCommands.length > 0 &&
      selectedSourceCommandFiles.length < sourceCommands.length;
    const selectedSubsetOfSourceMcp =
      sourceMcpServerNames.length > 0 &&
      selectedSourceMcpServers.length < sourceMcpServerNames.length;
    const selectedSubsetOfSourceSkills =
      sourceSkills.length > 0 &&
      selectedSourceSkills.length < sourceSkills.length;
    const shouldPersistCommandSelection =
      shouldImportCommands && commandSelectionMode === "custom";
    const shouldPersistMcpSelection =
      shouldImportMcp && mcpSelectionMode === "custom";
    const shouldPersistSkillSelection =
      shouldImportSkills && skillSelectionMode === "custom";

    const selectedSourceCommandsForLock =
      shouldPersistCommandSelection || selectedSubsetOfSourceCommands
        ? selectedSourceCommandFiles
        : undefined;
    const selectedSourceMcpServersForLock =
      shouldPersistMcpSelection || selectedSubsetOfSourceMcp
        ? selectedSourceMcpServers
        : undefined;
    const selectedSourceSkillsForLock =
      shouldPersistSkillSelection || selectedSubsetOfSourceSkills
        ? selectedSourceSkills
        : undefined;

    const lockfile = readLockfile(options.paths);
    const isCommandOnlyImport =
      !shouldImportAgents &&
      shouldImportCommands &&
      !shouldImportMcp &&
      !shouldImportSkills;
    const existingEntry = isCommandOnlyImport
      ? findRelaxedCommandEntry(lockfile.entries, {
          source: prepared.spec.source,
          sourceType: prepared.spec.type,
          subdir: options.subdir,
          requestedAgents: options.agents,
        })
      : findMatchingLockEntry(lockfile.entries, {
          source: prepared.spec.source,
          sourceType: prepared.spec.type,
          subdir: options.subdir,
          requestedAgents: shouldImportAgents
            ? selection.requestedAgentsForLock
            : options.agents,
          selectedSourceCommands: selectedSourceCommandsForLock,
          selectedSourceMcpServers: selectedSourceMcpServersForLock,
          selectedSourceSkills: selectedSourceSkillsForLock,
          skillsAgentTargets: skillsAgentTargetsForLock,
        });
    const shouldMergeCommandOnlyEntry =
      isCommandOnlyImport &&
      Boolean(existingEntry) &&
      (existingEntry?.importedAgents.length ?? 0) === 0 &&
      (existingEntry?.importedMcpServers.length ?? 0) === 0 &&
      (existingEntry?.importedSkills.length ?? 0) === 0;

    const lockImportedAgents = shouldImportAgents
      ? importedAgents
      : (existingEntry?.importedAgents ?? []);
    const lockImportedCommands = shouldImportCommands
      ? shouldMergeCommandOnlyEntry
        ? uniqueStrings([
            ...(existingEntry?.importedCommands ?? []),
            ...importedCommands,
          ])
        : importedCommands
      : (existingEntry?.importedCommands ?? []);
    const lockImportedMcpServers = shouldImportMcp
      ? importedMcpServers
      : (existingEntry?.importedMcpServers ?? []);
    const lockImportedSkills = shouldImportSkills
      ? importedSkills
      : (existingEntry?.importedSkills ?? []);

    let lockSelectedSourceCommands: string[] | undefined;
    if (shouldImportCommands) {
      if (shouldMergeCommandOnlyEntry) {
        if (shouldPersistCommandSelection || selectedSubsetOfSourceCommands) {
          lockSelectedSourceCommands = uniqueStrings([
            ...(existingEntry?.selectedSourceCommands ?? []),
            ...selectedSourceCommandFiles,
          ]);
        } else {
          lockSelectedSourceCommands = undefined;
        }
      } else if (
        shouldPersistCommandSelection ||
        selectedSubsetOfSourceCommands
      ) {
        lockSelectedSourceCommands = [...selectedSourceCommandFiles];
      } else {
        lockSelectedSourceCommands = undefined;
      }
    } else {
      lockSelectedSourceCommands = existingEntry?.selectedSourceCommands;
    }

    const lockSelectedSourceMcpServers = shouldImportMcp
      ? shouldPersistMcpSelection || selectedSubsetOfSourceMcp
        ? [...selectedSourceMcpServers]
        : undefined
      : existingEntry?.selectedSourceMcpServers;

    const lockSelectedSourceSkills = shouldImportSkills
      ? shouldPersistSkillSelection || selectedSubsetOfSourceSkills
        ? [...selectedSourceSkills]
        : undefined
      : existingEntry?.selectedSourceSkills;
    const lockSkillsAgentTargets = shouldImportSkills
      ? (skillsAgentTargetsForLock ?? existingEntry?.skillsAgentTargets)
      : existingEntry?.skillsAgentTargets;
    let lockCommandRenameMap: Record<string, string> | undefined;
    if (shouldImportCommands) {
      if (shouldMergeCommandOnlyEntry) {
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

    const lockRequestedAgents = shouldImportAgents
      ? selection.requestedAgentsForLock
      : existingEntry?.requestedAgents;
    const trackedEntities = computeTrackedEntitiesForLock({
      requestedAgents: lockRequestedAgents,
      importedAgents: lockImportedAgents,
      importedCommands: lockImportedCommands,
      selectedSourceCommands: lockSelectedSourceCommands,
      commandRenameMap: lockCommandRenameMap,
      importedMcpServers: lockImportedMcpServers,
      selectedSourceMcpServers: lockSelectedSourceMcpServers,
      importedSkills: lockImportedSkills,
      selectedSourceSkills: lockSelectedSourceSkills,
      skillsAgentTargets: lockSkillsAgentTargets,
    });

    const contentHash = hashContent(
      JSON.stringify({
        agents: lockImportedAgents,
        commands: lockImportedCommands,
        selectedSourceCommands: lockSelectedSourceCommands ?? [],
        commandRenameMap: lockCommandRenameMap ?? {},
        mcp: lockImportedMcpServers,
        selectedSourceMcpServers: lockSelectedSourceMcpServers ?? [],
        skills: lockImportedSkills,
        selectedSourceSkills: lockSelectedSourceSkills ?? [],
        skillsAgentTargets: lockSkillsAgentTargets ?? [],
        trackedEntities: trackedEntities ?? [],
      }),
    );

    const lockEntry: LockEntry = {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      requestedRef: options.ref,
      requestedAgents: lockRequestedAgents,
      resolvedCommit: prepared.resolvedCommit,
      subdir: options.subdir,
      importedAt: new Date().toISOString(),
      importedAgents: lockImportedAgents,
      importedCommands: lockImportedCommands,
      selectedSourceCommands: lockSelectedSourceCommands,
      commandRenameMap: lockCommandRenameMap,
      importedMcpServers: lockImportedMcpServers,
      selectedSourceMcpServers: lockSelectedSourceMcpServers,
      importedSkills: lockImportedSkills,
      selectedSourceSkills: lockSelectedSourceSkills,
      skillsAgentTargets: lockSkillsAgentTargets,
      trackedEntities,
      contentHash,
    };

    if (existingEntry) {
      const existingIndex = lockfile.entries.indexOf(existingEntry);
      if (existingIndex >= 0) {
        lockfile.entries[existingIndex] = lockEntry;
      } else {
        upsertLockEntry(lockfile, lockEntry);
      }
    } else {
      upsertLockEntry(lockfile, lockEntry);
    }
    writeLockfile(options.paths, lockfile);

    return {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      importedAgents,
      importedCommands,
      importedMcpServers,
      importedSkills,
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
  selectionMode?: SelectionMode;
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

  const selectionMode = await resolveSelectionMode({
    entityLabel: "agents",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForAgentSelection,
    nonInteractive: options.nonInteractive,
  });

  if (selectionMode === "all") {
    return { selectedAgents: options.sourceAgents };
  }

  if (
    options.yes ||
    options.nonInteractive ||
    options.sourceAgents.length <= 1 ||
    !options.promptForAgentSelection
  ) {
    return {
      selectedAgents: options.sourceAgents,
      requestedAgentsForLock: getStableRequestedAgentsForLock({
        selectedAgents: options.sourceAgents,
        sourceAgents: options.sourceAgents,
      }),
    };
  }

  const selected = await promptAgentSelection(options.sourceAgents);
  if (selected.length === 0) {
    throw new Error(
      "No agents selected. Use --agent <name> or rerun and select at least one agent.",
    );
  }
  const requestedAgentsForLock = getStableRequestedAgentsForLock({
    selectedAgents: selected,
    sourceAgents: options.sourceAgents,
  });
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
    message: withMultiselectHelp("Select agents to import"),
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
  key: Pick<
    LockEntry,
    | "source"
    | "sourceType"
    | "subdir"
    | "requestedAgents"
    | "selectedSourceCommands"
    | "selectedSourceMcpServers"
    | "selectedSourceSkills"
    | "skillsAgentTargets"
  >,
): LockEntry | undefined {
  return entries.find(
    (entry) =>
      entry.source === key.source &&
      entry.sourceType === key.sourceType &&
      entry.subdir === key.subdir &&
      sameRequestedAgentsForMatch(entry.requestedAgents, key.requestedAgents) &&
      sameStringSelectionForMatch(
        entry.selectedSourceCommands,
        key.selectedSourceCommands,
      ) &&
      sameStringSelectionForMatch(
        entry.selectedSourceMcpServers,
        key.selectedSourceMcpServers,
      ) &&
      sameStringSelectionForMatch(
        entry.selectedSourceSkills,
        key.selectedSourceSkills,
        { wildcardWhenRightIsUndefined: true },
      ) &&
      sameStringSelectionForMatch(
        entry.skillsAgentTargets,
        key.skillsAgentTargets,
        {
          wildcardWhenRightIsUndefined: true,
        },
      ),
  );
}

function findRelaxedCommandEntry(
  entries: LockEntry[],
  key: Pick<LockEntry, "source" | "sourceType" | "subdir" | "requestedAgents">,
): LockEntry | undefined {
  const matches = entries.filter(
    (entry) =>
      entry.source === key.source &&
      entry.sourceType === key.sourceType &&
      entry.subdir === key.subdir &&
      sameRequestedAgentsForMatch(entry.requestedAgents, key.requestedAgents),
  );

  if (matches.length === 0) return undefined;

  const mixed = matches.find(
    (entry) =>
      entry.importedAgents.length > 0 ||
      entry.importedMcpServers.length > 0 ||
      entry.importedSkills.length > 0,
  );

  return mixed ?? matches[0];
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

function sameStringSelectionForMatch(
  left: string[] | undefined,
  right: string[] | undefined,
  options: { wildcardWhenRightIsUndefined?: boolean } = {},
): boolean {
  if (options.wildcardWhenRightIsUndefined && right === undefined) {
    return true;
  }

  const normalizedLeft = normalizeRequestedAgentsForMatch(left);
  const normalizedRight = normalizeRequestedAgentsForMatch(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function computeTrackedEntitiesForLock(options: {
  requestedAgents?: string[];
  importedAgents: string[];
  importedCommands: string[];
  selectedSourceCommands?: string[];
  commandRenameMap?: Record<string, string>;
  importedMcpServers: string[];
  selectedSourceMcpServers?: string[];
  importedSkills: string[];
  selectedSourceSkills?: string[];
  skillsAgentTargets?: string[];
}): EntityType[] | undefined {
  const tracked: EntityType[] = [];

  if (
    options.importedAgents.length > 0 ||
    (options.requestedAgents?.length ?? 0) > 0
  ) {
    tracked.push("agent");
  }

  if (
    options.importedCommands.length > 0 ||
    (options.selectedSourceCommands?.length ?? 0) > 0 ||
    Object.keys(options.commandRenameMap ?? {}).length > 0
  ) {
    tracked.push("command");
  }

  if (
    options.importedMcpServers.length > 0 ||
    (options.selectedSourceMcpServers?.length ?? 0) > 0
  ) {
    tracked.push("mcp");
  }

  if (
    options.importedSkills.length > 0 ||
    (options.selectedSourceSkills?.length ?? 0) > 0 ||
    (options.skillsAgentTargets?.length ?? 0) > 0
  ) {
    tracked.push("skill");
  }

  return tracked.length > 0 ? tracked : undefined;
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
  selectionMode?: SelectionMode;
}): Promise<CommandSelectionResult> {
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

    return {
      selectedCommands: selected,
      selectionMode: "custom",
    };
  }

  const selectionResolution = await resolveSelectionModeWithSkip({
    entityLabel: "commands",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForCommands,
    nonInteractive: options.nonInteractive,
  });
  const selectionMode = selectionResolution.selectionMode;
  if (selectionResolution.skipImport) {
    return {
      selectedCommands: [],
      selectionMode: "custom",
    };
  }

  if (
    selectionMode === "all" ||
    !options.promptForCommands ||
    options.nonInteractive
  ) {
    return {
      selectedCommands: options.sourceCommands,
      selectionMode,
    };
  }

  const selected = await multiselect({
    message: withMultiselectHelp("Select commands to import"),
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

  return {
    selectedCommands: options.sourceCommands.filter((item) =>
      selectedNames.has(item.fileName),
    ),
    selectionMode,
  };
}

async function resolveMcpServersToImport(options: {
  sourceMcp: CanonicalMcpFile;
  selectors: string[];
  promptForMcp: boolean;
  nonInteractive: boolean;
  selectionMode?: SelectionMode;
}): Promise<McpSelectionResult> {
  const available = Object.keys(options.sourceMcp.mcpServers).sort();
  const selectors = options.selectors
    .map((item) => item.trim())
    .filter(Boolean);

  if (selectors.length > 0) {
    const selected = new Set<string>();
    const unmatched: string[] = [];

    for (const selector of selectors) {
      if (
        !Object.prototype.hasOwnProperty.call(
          options.sourceMcp.mcpServers,
          selector,
        )
      ) {
        unmatched.push(selector);
        continue;
      }
      selected.add(selector);
    }

    if (unmatched.length > 0) {
      throw new Error(
        `MCP server(s) not found in source: ${unmatched.join(", ")}. Available: ${available.join(", ")}`,
      );
    }

    return {
      selectedServerNames: [...selected],
      selectionMode: "custom",
    };
  }

  const selectionResolution = await resolveSelectionModeWithSkip({
    entityLabel: "MCP servers",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForMcp,
    nonInteractive: options.nonInteractive,
  });
  const selectionMode = selectionResolution.selectionMode;
  if (selectionResolution.skipImport) {
    return {
      selectedServerNames: [],
      selectionMode: "custom",
    };
  }

  if (
    selectionMode === "all" ||
    !options.promptForMcp ||
    options.nonInteractive
  ) {
    return {
      selectedServerNames: available,
      selectionMode,
    };
  }

  const selected = await multiselect({
    message: withMultiselectHelp("Select MCP servers to import"),
    options: available.map((serverName) => ({
      value: serverName,
      label: serverName,
    })),
    initialValues: available,
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selectedNames = Array.isArray(selected)
    ? new Set(selected.map((value) => String(value)))
    : new Set<string>();

  return {
    selectedServerNames: available.filter((serverName) =>
      selectedNames.has(serverName),
    ),
    selectionMode,
  };
}

async function resolveSkillsToImport(options: {
  sourceSkills: CanonicalSkill[];
  selectors: string[];
  promptForSkills: boolean;
  nonInteractive: boolean;
  selectionMode?: SelectionMode;
}): Promise<SkillSelectionResult> {
  const selectors = options.selectors
    .map((item) => item.trim())
    .filter(Boolean);
  if (selectors.length > 0) {
    const { selected, unmatched } = resolveSkillSelections(
      options.sourceSkills,
      selectors,
    );

    if (unmatched.length > 0) {
      throw new Error(
        `Skill(s) not found in source: ${unmatched.join(", ")}. Available: ${options.sourceSkills.map((skill) => skill.name).join(", ")}`,
      );
    }

    return {
      selectedSkills: selected,
      selectionMode: "custom",
    };
  }

  const selectionResolution = await resolveSelectionModeWithSkip({
    entityLabel: "skills",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForSkills,
    nonInteractive: options.nonInteractive,
  });
  const selectionMode = selectionResolution.selectionMode;
  if (selectionResolution.skipImport) {
    return {
      selectedSkills: [],
      selectionMode: "custom",
    };
  }

  if (
    selectionMode === "all" ||
    !options.promptForSkills ||
    options.nonInteractive
  ) {
    return {
      selectedSkills: options.sourceSkills,
      selectionMode,
    };
  }

  const selected = await multiselect({
    message: withMultiselectHelp("Select skills to import"),
    options: options.sourceSkills.map((skill) => ({
      value: skill.name,
      label: skill.name,
    })),
    initialValues: options.sourceSkills.map((skill) => skill.name),
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selectedNames = Array.isArray(selected)
    ? new Set(selected.map((value) => String(value)))
    : new Set<string>();

  return {
    selectedSkills: options.sourceSkills.filter((skill) =>
      selectedNames.has(skill.name),
    ),
    selectionMode,
  };
}

async function resolveSelectionMode(options: {
  entityLabel: string;
  selectionMode?: SelectionMode;
  promptForSelection: boolean;
  nonInteractive: boolean;
}): Promise<SelectionMode> {
  if (options.selectionMode) {
    return options.selectionMode;
  }

  if (!options.promptForSelection || options.nonInteractive) {
    return "all";
  }

  const choice = await select({
    message: `How should ${options.entityLabel} be tracked for future updates?`,
    options: [
      {
        value: "all",
        label: "Sync everything from source",
        hint: "Include new items on update",
      },
      {
        value: "custom",
        label: "Use custom selection",
        hint: "Update only currently selected items",
      },
    ],
    initialValue: "all",
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return choice === "custom" ? "custom" : "all";
}

async function resolveSelectionModeWithSkip(options: {
  entityLabel: string;
  selectionMode?: SelectionMode;
  promptForSelection: boolean;
  nonInteractive: boolean;
}): Promise<SelectionModeResolution> {
  if (options.selectionMode) {
    return {
      selectionMode: options.selectionMode,
      skipImport: false,
    };
  }

  if (!options.promptForSelection || options.nonInteractive) {
    return {
      selectionMode: "all",
      skipImport: false,
    };
  }

  const choice = await select({
    message: `How should ${options.entityLabel} be tracked for future updates?`,
    options: [
      {
        value: "all",
        label: "Sync everything from source",
        hint: "Include new items on update",
      },
      {
        value: "custom",
        label: "Use custom selection",
        hint: "Update only currently selected items",
      },
      {
        value: "skip",
        label: `Skip importing ${options.entityLabel}`,
        hint: "Track none from this source",
      },
    ],
    initialValue: "all",
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "skip") {
    return {
      selectionMode: "custom",
      skipImport: true,
    };
  }

  return {
    selectionMode: choice === "custom" ? "custom" : "all",
    skipImport: false,
  };
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
