import fs from "node:fs";
import path from "node:path";
import type { ParsedArgs } from "minimist";
import { getStringArrayFlag, parseProvidersFlag } from "../core/argv.js";
import {
  commandFileMatchesSelector,
  parseCommandsDir,
  stripCommandFileExtension as stripCommandFileExt,
} from "../core/commands.js";
import {
  formatUsageError,
  getCommandAddHelpText,
  getCommandDeleteHelpText,
  getCommandHelpText,
  getCommandListHelpText,
} from "../core/copy.js";
import { slugify } from "../core/fs.js";
import { importSource, NonInteractiveConflictError } from "../core/importer.js";
import { readLockfile, writeLockfile } from "../core/lockfile.js";
import { resolveScope } from "../core/scope.js";
import { updateLastScope } from "../core/settings.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";

export async function runCommandCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  const action = argv._[1];

  if (argv.help) {
    if (action === "add") {
      console.log(getCommandAddHelpText());
      return;
    }
    if (action === "list") {
      console.log(getCommandListHelpText());
      return;
    }
    if (action === "delete") {
      console.log(getCommandDeleteHelpText());
      return;
    }

    console.log(getCommandHelpText());
    return;
  }

  if (action !== "add" && action !== "list" && action !== "delete") {
    throw new Error(
      formatUsageError({
        issue: "Invalid command command.",
        usage: "agentloom command <add|list|delete> [options]",
        example: "agentloom command add ./command-pack",
      }),
    );
  }

  const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);
  const paths = await resolveScope({
    cwd,
    global: Boolean(argv.global),
    local: Boolean(argv.local),
    interactive: !nonInteractive,
  });

  if (action === "list") {
    runCommandList(paths.commandsDir, Boolean(argv.json));
    return;
  }

  if (action === "add") {
    const source = argv._[2];
    if (typeof source !== "string" || source.trim() === "") {
      throw new Error(
        formatUsageError({
          issue: "Missing required <source>.",
          usage:
            "agentloom command add <source> [--ref <ref>] [--subdir <path>] [options]",
          example: "agentloom command add ./command-pack",
        }),
      );
    }

    try {
      const commandSelectors = getStringArrayFlag(
        (argv as Record<string, unknown>).command,
      );
      const summary = await importSource({
        source,
        ref: typeof argv.ref === "string" ? argv.ref : undefined,
        subdir: typeof argv.subdir === "string" ? argv.subdir : undefined,
        rename: typeof argv.rename === "string" ? argv.rename : undefined,
        yes: Boolean(argv.yes),
        nonInteractive,
        paths,
        importAgents: false,
        importCommands: true,
        requireCommands: true,
        importMcp: false,
        commandSelectors,
        promptForCommands: commandSelectors.length === 0,
      });

      console.log(`Imported source: ${summary.source}`);
      console.log(`Source type: ${summary.sourceType}`);
      console.log(`Resolved commit: ${summary.resolvedCommit}`);
      console.log(`Imported commands: ${summary.importedCommands.length}`);

      updateLastScope(paths.settingsPath, paths.scope);

      if (!argv["no-sync"]) {
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
    } catch (err) {
      if (err instanceof NonInteractiveConflictError) {
        console.error(err.message);
        process.exit(2);
      }
      throw err;
    }
    return;
  }

  const name = argv._[2];
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(
      formatUsageError({
        issue: "Missing required command name.",
        usage: "agentloom command delete <name> [options]",
        example: "agentloom command delete review",
      }),
    );
  }
  if (/[\\/]/.test(name)) {
    throw new Error(
      formatUsageError({
        issue: "Use a command filename or name, not a path.",
        usage: "agentloom command delete <name> [options]",
        example: "agentloom command delete review",
      }),
    );
  }

  const targetPath = resolveCanonicalCommandPath(
    paths.commandsDir,
    name.trim(),
  );
  if (!targetPath) {
    throw new Error(
      formatUsageError({
        issue: `Command "${name}" was not found in canonical commands.`,
        usage: "agentloom command list [--json] [--local|--global]",
        example: "agentloom command list --json",
      }),
    );
  }

  fs.unlinkSync(targetPath);
  const deletedFileName = path.basename(targetPath);
  removeDeletedCommandFromLock(paths, deletedFileName);
  console.log(`Deleted command: ${deletedFileName}`);

  if (!argv["no-sync"]) {
    const summary = await syncFromCanonical({
      paths,
      providers: parseProvidersFlag(argv.providers),
      yes: Boolean(argv.yes),
      nonInteractive,
      dryRun: Boolean(argv["dry-run"]),
    });
    console.log("");
    console.log(formatSyncSummary(summary, paths.agentsRoot));
  }
}

function runCommandList(commandsDir: string, asJson: boolean): void {
  const commands = parseCommandsDir(commandsDir);

  if (asJson) {
    const payload = {
      version: 1,
      commands: commands.map((command) => command.fileName),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (commands.length === 0) {
    console.log("No canonical command files configured.");
    return;
  }

  for (const command of commands) {
    console.log(command.fileName);
  }
}

function resolveCanonicalCommandPath(
  commandsDir: string,
  commandName: string,
): string | null {
  const trimmed = commandName.trim();
  const commands = parseCommandsDir(commandsDir);
  if (commands.length === 0) return null;

  const directCandidates = new Set<string>([
    trimmed,
    `${trimmed}.md`,
    `${slugify(trimmed) || "command"}.md`,
  ]);

  for (const candidate of directCandidates) {
    const candidatePath = path.join(commandsDir, candidate);
    if (fs.existsSync(candidatePath)) return candidatePath;
  }

  const slug = slugify(trimmed);

  for (const command of commands) {
    const withoutExt = stripCommandFileExt(command.fileName);
    if (
      command.fileName === trimmed ||
      withoutExt === trimmed ||
      (slug.length > 0 && slug === withoutExt)
    ) {
      return command.sourcePath;
    }
  }

  return null;
}

function removeDeletedCommandFromLock(
  paths: Parameters<typeof readLockfile>[0],
  deletedFileName: string,
): void {
  const lockfile = readLockfile(paths);
  if (lockfile.entries.length === 0) return;

  let changed = false;
  const nextEntries = lockfile.entries.flatMap((entry) => {
    const importedCommands = entry.importedCommands.filter(
      (importedPath) => path.basename(importedPath) !== deletedFileName,
    );
    const importedChanged =
      importedCommands.length !== entry.importedCommands.length;
    if (!importedChanged) {
      return [entry];
    }

    changed = true;

    let selectedSourceCommands = entry.selectedSourceCommands;
    let commandRenameMap = entry.commandRenameMap;

    if (selectedSourceCommands && selectedSourceCommands.length > 0) {
      const filtered = selectedSourceCommands.filter(
        (selector) => !commandFileMatchesSelector(deletedFileName, selector),
      );

      selectedSourceCommands = filtered;
    }

    if (commandRenameMap && Object.keys(commandRenameMap).length > 0) {
      const importedCommandNames = new Set(
        importedCommands.map((importedPath) => path.basename(importedPath)),
      );
      const filteredRenameEntries = Object.entries(commandRenameMap).filter(
        ([sourceSelector, importedFileName]) =>
          !commandFileMatchesSelector(deletedFileName, sourceSelector) &&
          importedCommandNames.has(path.basename(importedFileName)),
      );
      commandRenameMap =
        filteredRenameEntries.length > 0
          ? Object.fromEntries(filteredRenameEntries)
          : undefined;
    }

    if (importedCommands.length === 0) {
      if (
        entry.importedAgents.length === 0 &&
        entry.importedMcpServers.length === 0
      ) {
        selectedSourceCommands = undefined;
      } else {
        selectedSourceCommands = [];
      }
      commandRenameMap = undefined;
    } else if (selectedSourceCommands === undefined) {
      const selectorsFromRenameMap = commandRenameMap
        ? Object.keys(commandRenameMap)
        : [];
      const remainingSelectors = importedCommands.map((item) =>
        path.basename(item),
      );
      selectedSourceCommands =
        selectorsFromRenameMap.length > 0
          ? selectorsFromRenameMap
          : remainingSelectors.length > 0
            ? remainingSelectors
            : undefined;
    }

    const nextEntry = {
      ...entry,
      importedCommands,
      selectedSourceCommands,
      commandRenameMap,
    };

    if (
      nextEntry.importedAgents.length === 0 &&
      nextEntry.importedCommands.length === 0 &&
      nextEntry.importedMcpServers.length === 0
    ) {
      changed = true;
      return [];
    }

    return [nextEntry];
  });

  if (!changed) return;
  lockfile.entries = nextEntries;
  writeLockfile(paths, lockfile);
}
