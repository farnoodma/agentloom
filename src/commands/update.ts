import path from "node:path";
import type { ParsedArgs } from "minimist";
import { importSource, NonInteractiveConflictError } from "../core/importer.js";
import {
  normalizeCommandSelector,
  stripCommandFileExtension,
} from "../core/commands.js";
import { readLockfile } from "../core/lockfile.js";
import { resolveScope } from "../core/scope.js";
import { prepareSource } from "../core/sources.js";
import { parseProvidersFlag } from "../core/argv.js";
import { getUpdateHelpText } from "../core/copy.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";
import type { LockEntry } from "../types.js";

export async function runUpdateCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getUpdateHelpText());
    return;
  }

  const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);

  const paths = await resolveScope({
    cwd,
    global: Boolean(argv.global),
    local: Boolean(argv.local),
    interactive: !nonInteractive,
  });

  const lockfile = readLockfile(paths);
  if (lockfile.entries.length === 0) {
    console.log(`No lock entries found in ${paths.lockPath}.`);
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const entry of lockfile.entries) {
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

    const isCommandOnlyEntry =
      entry.importedAgents.length === 0 &&
      entry.importedMcpServers.length === 0;
    const commandOptions = getUpdateCommandOptions(entry, isCommandOnlyEntry);

    if (isCommandOnlyEntry && !commandOptions.importCommands) {
      skipped += 1;
      continue;
    }

    try {
      await importSource({
        source: entry.source,
        ref: entry.requestedRef,
        subdir: entry.subdir,
        agents: entry.requestedAgents,
        promptForAgentSelection: false,
        yes: Boolean(argv.yes),
        nonInteractive,
        paths,
        importAgents: !isCommandOnlyEntry,
        importCommands: commandOptions.importCommands,
        requireCommands: isCommandOnlyEntry && commandOptions.importCommands,
        importMcp: !isCommandOnlyEntry,
        commandSelectors: commandOptions.commandSelectors,
        commandRenameMap: commandOptions.commandRenameMap,
      });
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

  if (updated > 0 && !argv["no-sync"]) {
    const syncSummary = await syncFromCanonical({
      paths,
      providers: parseProvidersFlag(argv.providers),
      yes: Boolean(argv.yes),
      nonInteractive,
      dryRun: Boolean(argv["dry-run"]),
    });
    console.log("");
    console.log(formatSyncSummary(syncSummary, paths.agentsRoot));
  }
}

interface UpdateCommandOptions {
  importCommands: boolean;
  commandSelectors?: string[];
  commandRenameMap?: Record<string, string>;
}

function getUpdateCommandOptions(
  entry: LockEntry,
  isCommandOnlyEntry: boolean,
): UpdateCommandOptions {
  const commandSelectors = getUpdateCommandSelectors(entry, isCommandOnlyEntry);

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

function getUpdateCommandSelectors(
  entry: LockEntry,
  isCommandOnlyEntry: boolean,
): string[] | undefined {
  if (entry.selectedSourceCommands) {
    return entry.selectedSourceCommands;
  }

  if (!isCommandOnlyEntry) {
    return undefined;
  }

  const derived = entry.importedCommands
    .map((item) => path.basename(item))
    .filter(Boolean);

  return derived;
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
