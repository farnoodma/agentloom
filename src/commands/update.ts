import path from "node:path";
import type { ParsedArgs } from "minimist";
import { importSource, NonInteractiveConflictError } from "../core/importer.js";
import {
  normalizeCommandSelector,
  stripCommandFileExtension,
} from "../core/commands.js";
import { readLockfile } from "../core/lockfile.js";
import { prepareSource, parseSourceSpec } from "../core/sources.js";
import { getUpdateHelpText } from "../core/copy.js";
import type { EntityType, LockEntry } from "../types.js";
import {
  getNonInteractiveMode,
  resolvePathsForCommand,
  runPostMutationSync,
} from "./entity-utils.js";

export async function runUpdateCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getUpdateHelpText());
    return;
  }

  await runEntityAwareUpdate({
    argv,
    cwd,
    target: "all",
    sourceIndex: 1,
  });
}

export async function runScopedUpdateCommand(options: {
  argv: ParsedArgs;
  cwd: string;
  entity: EntityType;
  sourceIndex: number;
}): Promise<void> {
  await runEntityAwareUpdate({
    argv: options.argv,
    cwd: options.cwd,
    target: options.entity,
    sourceIndex: options.sourceIndex,
  });
}

async function runEntityAwareUpdate(options: {
  argv: ParsedArgs;
  cwd: string;
  target: EntityType | "all";
  sourceIndex: number;
}): Promise<void> {
  const nonInteractive = getNonInteractiveMode(options.argv);
  const paths = await resolvePathsForCommand(options.argv, options.cwd);

  const lockfile = readLockfile(paths);
  if (lockfile.entries.length === 0) {
    console.log(`No lock entries found in ${paths.lockPath}.`);
    return;
  }

  const sourceFilter = resolveSourceFilter(options.argv, options.sourceIndex);
  const entries = lockfile.entries.filter((entry) =>
    matchesSourceFilter(entry, sourceFilter),
  );

  if (entries.length === 0) {
    console.log("No lock entries matched the requested source filter.");
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entryIncludesTarget(entry, options.target)) {
      skipped += 1;
      continue;
    }

    const probe = prepareSource({
      source: entry.source,
      ref: entry.requestedRef,
      subdir: entry.subdir,
    });

    const hasNewCommit = probe.resolvedCommit !== entry.resolvedCommit;
    probe.cleanup();

    if (!hasNewCommit) {
      skipped += 1;
      continue;
    }

    const updatePlan = buildEntryUpdatePlan(entry, options.target);
    if (
      !updatePlan.importAgents &&
      !updatePlan.importCommands &&
      !updatePlan.importMcp &&
      !updatePlan.importSkills
    ) {
      skipped += 1;
      continue;
    }

    try {
      const importOptions: Parameters<typeof importSource>[0] = {
        source: entry.source,
        ref: entry.requestedRef,
        subdir: entry.subdir,
        agents: updatePlan.requestedAgents,
        promptForAgentSelection: false,
        promptForCommands: false,
        promptForMcp: false,
        promptForSkills: false,
        yes: Boolean(options.argv.yes),
        nonInteractive,
        paths,
        importAgents: updatePlan.importAgents,
        importCommands: updatePlan.importCommands,
        importMcp: updatePlan.importMcp,
      };

      if (updatePlan.importSkills) {
        importOptions.importSkills = true;
      }

      if (updatePlan.commandSelectors) {
        importOptions.commandSelectors = updatePlan.commandSelectors;
        importOptions.commandRenameMap = updatePlan.commandRenameMap;
      }

      if (updatePlan.mcpSelectors) {
        importOptions.mcpSelectors = updatePlan.mcpSelectors;
      }

      if (updatePlan.skillSelectors) {
        importOptions.skillSelectors = updatePlan.skillSelectors;
      }

      if (updatePlan.skillsAgentTargets) {
        importOptions.skillsAgentTargets = updatePlan.skillsAgentTargets;
      }

      await importSource(importOptions);
      updated += 1;
    } catch (err) {
      if (err instanceof NonInteractiveConflictError) {
        console.error(err.message);
        process.exit(2);
      }
      throw err;
    }
  }

  console.log(`Updated entries: ${updated}`);
  console.log(`Unchanged entries: ${skipped}`);

  if (updated > 0) {
    await runPostMutationSync({
      argv: options.argv,
      paths,
      target: options.target,
    });
  }
}

interface EntryUpdatePlan {
  importAgents: boolean;
  importCommands: boolean;
  importMcp: boolean;
  importSkills: boolean;
  requestedAgents?: string[];
  commandSelectors?: string[];
  commandRenameMap?: Record<string, string>;
  mcpSelectors?: string[];
  skillSelectors?: string[];
  skillsAgentTargets?: string[];
}

function buildEntryUpdatePlan(
  entry: LockEntry,
  target: EntityType | "all",
): EntryUpdatePlan {
  const includeAgents = shouldUpdateEntity(entry, "agent", target);
  const includeCommands = shouldUpdateEntity(entry, "command", target);
  const includeMcp = shouldUpdateEntity(entry, "mcp", target);
  const includeSkills = shouldUpdateEntity(entry, "skill", target);

  const commandOptions = getUpdateCommandOptions(entry, includeCommands);

  return {
    importAgents: includeAgents,
    importCommands: commandOptions.importCommands,
    importMcp: includeMcp,
    importSkills: includeSkills,
    requestedAgents: includeAgents ? entry.requestedAgents : undefined,
    commandSelectors: commandOptions.commandSelectors,
    commandRenameMap: commandOptions.commandRenameMap,
    mcpSelectors: includeMcp ? entry.selectedSourceMcpServers : undefined,
    skillSelectors: includeSkills ? entry.selectedSourceSkills : undefined,
    skillsAgentTargets: includeSkills ? entry.skillsAgentTargets : undefined,
  };
}

function resolveSourceFilter(
  argv: ParsedArgs,
  sourceIndex: number,
): string | undefined {
  const sourceFromFlag =
    typeof argv.source === "string" && argv.source.trim().length > 0
      ? argv.source.trim()
      : undefined;
  if (sourceFromFlag) return sourceFromFlag;

  const sourceFromArg = argv._[sourceIndex];
  if (typeof sourceFromArg !== "string" || sourceFromArg.trim().length === 0) {
    return undefined;
  }

  return sourceFromArg.trim();
}

function matchesSourceFilter(
  entry: LockEntry,
  filter: string | undefined,
): boolean {
  if (!filter) return true;
  if (entry.source === filter) return true;

  try {
    const parsed = parseSourceSpec(filter);
    return entry.source === parsed.source;
  } catch {
    return false;
  }
}

function entryIncludesTarget(
  entry: LockEntry,
  target: EntityType | "all",
): boolean {
  if (target === "all") return true;
  return tracksEntity(entry, target);
}

function shouldUpdateEntity(
  entry: LockEntry,
  entity: EntityType,
  target: EntityType | "all",
): boolean {
  if (target !== "all" && target !== entity) return false;
  if (target === "all" && !entry.trackedEntities) {
    if (entity === "skill") {
      return tracksEntity(entry, entity);
    }
    return true;
  }
  return tracksEntity(entry, entity);
}

function tracksEntity(entry: LockEntry, entity: EntityType): boolean {
  const importedAgents = Array.isArray(entry.importedAgents)
    ? entry.importedAgents
    : [];
  const importedCommands = Array.isArray(entry.importedCommands)
    ? entry.importedCommands
    : [];
  const importedMcpServers = Array.isArray(entry.importedMcpServers)
    ? entry.importedMcpServers
    : [];
  const importedSkills = Array.isArray(entry.importedSkills)
    ? entry.importedSkills
    : [];

  if (entry.trackedEntities?.includes(entity)) return true;

  if (entity === "agent") {
    return importedAgents.length > 0 || Boolean(entry.requestedAgents);
  }
  if (entity === "command") {
    return (
      importedCommands.length > 0 ||
      Boolean(entry.selectedSourceCommands) ||
      Boolean(entry.commandRenameMap)
    );
  }
  if (entity === "mcp") {
    return (
      importedMcpServers.length > 0 || Boolean(entry.selectedSourceMcpServers)
    );
  }
  return (
    importedSkills.length > 0 ||
    Boolean(entry.selectedSourceSkills) ||
    Boolean(entry.skillsAgentTargets)
  );
}

interface UpdateCommandOptions {
  importCommands: boolean;
  commandSelectors?: string[];
  commandRenameMap?: Record<string, string>;
}

function getUpdateCommandOptions(
  entry: LockEntry,
  includeCommands: boolean,
): UpdateCommandOptions {
  if (!includeCommands) {
    return { importCommands: false };
  }

  const commandSelectors = getUpdateCommandSelectors(entry);
  if (commandSelectors && commandSelectors.length === 0) {
    return { importCommands: false };
  }

  if (!commandSelectors) {
    return { importCommands: true };
  }

  return {
    importCommands: true,
    commandSelectors,
    commandRenameMap: getUpdateCommandRenameMap(entry, commandSelectors),
  };
}

function getUpdateCommandSelectors(entry: LockEntry): string[] | undefined {
  if (entry.selectedSourceCommands !== undefined) {
    return entry.selectedSourceCommands;
  }
  return undefined;
}

function getUpdateCommandRenameMap(
  entry: LockEntry,
  commandSelectors: string[],
): Record<string, string> | undefined {
  const renameMapFromLock = filterRenameMapBySelectors(
    entry.commandRenameMap,
    commandSelectors,
  );
  if (renameMapFromLock) {
    return renameMapFromLock;
  }

  const inferredRename = inferUpdateCommandRename(entry, commandSelectors);
  if (!inferredRename) return undefined;

  return {
    [commandSelectors[0]]: inferredRename,
  };
}

function inferUpdateCommandRename(
  entry: LockEntry,
  commandSelectors: string[] | undefined,
): string | undefined {
  if (!commandSelectors || commandSelectors.length !== 1) {
    return undefined;
  }

  if (entry.importedCommands.length !== 1) {
    return undefined;
  }

  const sourceName = stripCommandFileExtension(commandSelectors[0]);
  const importedName = stripCommandFileExtension(
    path.basename(entry.importedCommands[0]),
  );

  if (!sourceName || !importedName || sourceName === importedName) {
    return undefined;
  }

  return importedName;
}

function filterRenameMapBySelectors(
  renameMap: Record<string, string> | undefined,
  selectors: string[],
): Record<string, string> | undefined {
  if (!renameMap) return undefined;

  const selectorSet = new Set(selectors.map(normalizeCommandSelector));
  const filteredEntries = Object.entries(renameMap)
    .filter(([sourceSelector]) =>
      selectorSet.has(normalizeCommandSelector(sourceSelector)),
    )
    .map(([sourceSelector, importedFileName]) => [
      sourceSelector,
      path.basename(importedFileName),
    ]);

  if (filteredEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(filteredEntries);
}
