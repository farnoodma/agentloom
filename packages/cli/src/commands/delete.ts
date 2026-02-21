import fs from "node:fs";
import path from "node:path";
import { multiselect, isCancel, cancel, select } from "@clack/prompts";
import type { ParsedArgs } from "minimist";
import { parseAgentsDir } from "../core/agents.js";
import { parseCommandsDir } from "../core/commands.js";
import { formatUsageError } from "../core/copy.js";
import { readLockfile, writeLockfile } from "../core/lockfile.js";
import { readCanonicalMcp, writeCanonicalMcp } from "../core/mcp.js";
import { parseSourceSpec } from "../core/sources.js";
import { parseSkillsDir, runSkillsCommand } from "../core/skills.js";
import type { AgentsLockFile, EntityType, LockEntry } from "../types.js";
import {
  getNonInteractiveMode,
  resolvePathsForCommand,
  runPostMutationSync,
} from "./entity-utils.js";

const ALL_ENTITIES: EntityType[] = ["agent", "command", "mcp", "skill"];
const MULTISELECT_HELP_TEXT = "↑↓ move, space select, enter confirm";

function withMultiselectHelp(message: string): string {
  return `${message}\n${MULTISELECT_HELP_TEXT}`;
}

export async function runDeleteCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  await runEntityAwareDelete({
    argv,
    cwd,
    target: "all",
    sourceIndex: 1,
  });
}

export async function runScopedDeleteCommand(options: {
  argv: ParsedArgs;
  cwd: string;
  entity: EntityType;
  sourceIndex: number;
}): Promise<void> {
  await runEntityAwareDelete({
    argv: options.argv,
    cwd: options.cwd,
    target: options.entity,
    sourceIndex: options.sourceIndex,
  });
}

async function runEntityAwareDelete(options: {
  argv: ParsedArgs;
  cwd: string;
  target: EntityType | "all";
  sourceIndex: number;
}): Promise<void> {
  const candidate = getDeleteCandidate(options.argv, options.sourceIndex);
  if (!candidate) {
    throw new Error(
      formatUsageError({
        issue: "Missing required <source|name>.",
        usage:
          options.target === "all"
            ? "agentloom delete <source|name> [options]"
            : `agentloom ${options.target} delete <source|name> [options]`,
        example:
          options.target === "all"
            ? "agentloom delete farnoodma/agents"
            : `agentloom ${options.target} delete reviewer`,
      }),
    );
  }

  const nonInteractive = getNonInteractiveMode(options.argv);
  const paths = await resolvePathsForCommand(options.argv, options.cwd);

  const lockfile = readLockfile(paths);
  const sourceMatches = lockfile.entries.filter((entry) =>
    matchesSource(entry, candidate),
  );

  const sourceMode =
    sourceMatches.length > 0 ||
    (typeof options.argv.source === "string" &&
      options.argv.source.trim() !== "");

  const entities = await resolveEntitiesForDelete({
    argv: options.argv,
    target: options.target,
    sourceMode,
    nonInteractive,
  });

  if (entities.length === 0) {
    console.log("No entities selected for deletion.");
    return;
  }

  if (sourceMode) {
    await deleteBySource({
      paths,
      sourceFilter: candidate,
      lockfile,
      lockEntries: sourceMatches,
      entities,
      nonInteractive,
    });
  } else {
    await deleteByName({
      candidate,
      argv: options.argv,
      paths,
      entities,
      nonInteractive,
    });
  }

  await runPostMutationSync({
    argv: options.argv,
    paths,
    target: options.target,
  });
}

function getDeleteCandidate(
  argv: ParsedArgs,
  sourceIndex: number,
): string | undefined {
  const fromSourceFlag =
    typeof argv.source === "string" && argv.source.trim().length > 0
      ? argv.source.trim()
      : undefined;
  if (fromSourceFlag) return fromSourceFlag;

  const fromNameFlag =
    typeof argv.name === "string" && argv.name.trim().length > 0
      ? argv.name.trim()
      : undefined;
  if (fromNameFlag) return fromNameFlag;

  const positional = argv._[sourceIndex];
  if (typeof positional !== "string" || positional.trim().length === 0) {
    return undefined;
  }

  return positional.trim();
}

async function resolveEntitiesForDelete(options: {
  argv: ParsedArgs;
  target: EntityType | "all";
  sourceMode: boolean;
  nonInteractive: boolean;
}): Promise<EntityType[]> {
  if (options.target !== "all") return [options.target];

  const entityFlag =
    typeof options.argv.entity === "string" ? options.argv.entity.trim() : "";
  if (entityFlag) {
    if (!ALL_ENTITIES.includes(entityFlag as EntityType)) {
      throw new Error(
        `Unknown --entity value "${entityFlag}". Expected one of: ${ALL_ENTITIES.join(", ")}.`,
      );
    }
    return [entityFlag as EntityType];
  }

  if (options.sourceMode) {
    if (options.nonInteractive) {
      return [...ALL_ENTITIES];
    }

    const selected = await multiselect({
      message: withMultiselectHelp("Delete from which entities?"),
      options: ALL_ENTITIES.map((entity) => ({
        value: entity,
        label: entity,
      })),
      initialValues: [...ALL_ENTITIES],
    });

    if (isCancel(selected)) {
      cancel("Operation cancelled.");
      process.exit(1);
    }

    return Array.isArray(selected)
      ? selected.map((value) => value as EntityType)
      : [];
  }

  return [...ALL_ENTITIES];
}

function matchesSource(entry: LockEntry, input: string): boolean {
  if (entry.source === input) return true;
  try {
    const spec = parseSourceSpec(input);
    return entry.source === spec.source;
  } catch {
    return false;
  }
}

async function deleteBySource(options: {
  paths: Awaited<ReturnType<typeof resolvePathsForCommand>>;
  sourceFilter: string;
  lockfile: AgentsLockFile;
  lockEntries: LockEntry[];
  entities: EntityType[];
  nonInteractive: boolean;
}): Promise<void> {
  if (options.lockEntries.length === 0) {
    throw new Error("No matching lock entries found for the provided source.");
  }

  const mcp = readCanonicalMcp(options.paths);
  const skillsToDelete = new Set<string>();

  for (const entry of options.lockEntries) {
    if (options.entities.includes("agent")) {
      for (const imported of entry.importedAgents) {
        removeIfExists(path.join(options.paths.agentsRoot, imported));
      }
    }

    if (options.entities.includes("command")) {
      for (const imported of entry.importedCommands) {
        removeIfExists(path.join(options.paths.agentsRoot, imported));
      }
    }

    if (options.entities.includes("mcp")) {
      for (const server of entry.importedMcpServers) {
        delete mcp.mcpServers[server];
      }
    }

    if (options.entities.includes("skill")) {
      for (const skill of entry.importedSkills) {
        skillsToDelete.add(skill);
      }
    }
  }

  if (options.entities.includes("mcp")) {
    writeCanonicalMcp(options.paths, mcp);
  }

  if (options.entities.includes("skill") && skillsToDelete.size > 0) {
    const args = ["remove", ...[...skillsToDelete], "--yes"];
    if (options.paths.scope === "global") {
      args.push("--global");
    }
    runSkillsCommand({
      args,
      cwd: options.paths.workspaceRoot,
      inheritStdio: !options.nonInteractive,
    });
  }

  options.lockfile.entries = options.lockfile.entries
    .map((entry) => {
      if (!matchesSource(entry, options.sourceFilter)) return entry;
      return removeEntityDataFromEntry(entry, options.entities);
    })
    .filter((entry): entry is LockEntry => Boolean(entry));
  writeLockfile(options.paths, options.lockfile);
}

async function deleteByName(options: {
  candidate: string;
  argv: ParsedArgs;
  paths: Awaited<ReturnType<typeof resolvePathsForCommand>>;
  entities: EntityType[];
  nonInteractive: boolean;
}): Promise<void> {
  let selectedEntities = options.entities;

  if (selectedEntities.length > 1) {
    const matches = detectNameMatches(options.paths, options.candidate);
    const matchingEntities = selectedEntities.filter((entity) =>
      matches.includes(entity),
    );

    if (matchingEntities.length === 0) {
      throw new Error(
        `No installed entity named "${options.candidate}" found.`,
      );
    }

    if (matchingEntities.length > 1) {
      if (options.nonInteractive) {
        throw new Error(
          `Name "${options.candidate}" matches multiple entities (${matchingEntities.join(", ")}). Use --entity for non-interactive deletion.`,
        );
      }

      const picked = await select({
        message: `Name "${options.candidate}" exists in multiple entities. Which should be deleted?`,
        options: matchingEntities.map((entity) => ({
          value: entity,
          label: entity,
        })),
      });

      if (isCancel(picked)) {
        cancel("Operation cancelled.");
        process.exit(1);
      }

      selectedEntities = [picked as EntityType];
    } else {
      selectedEntities = matchingEntities;
    }
  }

  const mcp = readCanonicalMcp(options.paths);
  for (const entity of selectedEntities) {
    if (entity === "agent") {
      deleteAgentByName(options.paths, options.candidate);
    } else if (entity === "command") {
      deleteCommandByName(options.paths, options.candidate);
    } else if (entity === "mcp") {
      const existing = Object.keys(mcp.mcpServers).find(
        (name) => normalizeName(name) === normalizeName(options.candidate),
      );
      if (!existing) {
        throw new Error(`MCP server "${options.candidate}" was not found.`);
      }
      delete mcp.mcpServers[existing];
    } else if (entity === "skill") {
      const args = ["remove", options.candidate, "--yes"];
      if (options.paths.scope === "global") {
        args.push("--global");
      }
      runSkillsCommand({
        args,
        cwd: options.paths.workspaceRoot,
        inheritStdio: !options.nonInteractive,
      });
    }
  }

  if (selectedEntities.includes("mcp")) {
    writeCanonicalMcp(options.paths, mcp);
  }

  const lockfile = readLockfile(options.paths);
  lockfile.entries = lockfile.entries
    .map((entry) =>
      removeNameFromEntry(entry, selectedEntities, options.candidate),
    )
    .filter((entry): entry is LockEntry => Boolean(entry));
  writeLockfile(options.paths, lockfile);
}

function deleteAgentByName(
  paths: Awaited<ReturnType<typeof resolvePathsForCommand>>,
  name: string,
): void {
  const agents = parseAgentsDir(paths.agentsDir);
  const target = agents.find(
    (agent) =>
      normalizeName(agent.name) === normalizeName(name) ||
      normalizeName(agent.fileName.replace(/\.md$/i, "")) ===
        normalizeName(name),
  );
  if (!target) {
    throw new Error(`Agent "${name}" was not found in canonical agents.`);
  }
  removeIfExists(target.sourcePath);
}

function deleteCommandByName(
  paths: Awaited<ReturnType<typeof resolvePathsForCommand>>,
  name: string,
): void {
  const commands = parseCommandsDir(paths.commandsDir);
  const target = commands.find(
    (command) =>
      normalizeName(command.fileName) === normalizeName(name) ||
      normalizeName(command.fileName.replace(/\.(md|mdc)$/i, "")) ===
        normalizeName(name),
  );
  if (!target) {
    throw new Error(`Command "${name}" was not found in canonical commands.`);
  }
  removeIfExists(target.sourcePath);
}

function removeIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function detectNameMatches(
  paths: Awaited<ReturnType<typeof resolvePathsForCommand>>,
  candidate: string,
): EntityType[] {
  const normalized = normalizeName(candidate);
  const matches: EntityType[] = [];

  const hasAgent = parseAgentsDir(paths.agentsDir).some(
    (agent) =>
      normalizeName(agent.name) === normalized ||
      normalizeName(agent.fileName.replace(/\.md$/i, "")) === normalized,
  );
  if (hasAgent) matches.push("agent");

  const hasCommand = parseCommandsDir(paths.commandsDir).some(
    (command) =>
      normalizeName(command.fileName) === normalized ||
      normalizeName(command.fileName.replace(/\.(md|mdc)$/i, "")) ===
        normalized,
  );
  if (hasCommand) matches.push("command");

  const mcp = readCanonicalMcp(paths);
  const hasMcp = Object.keys(mcp.mcpServers).some(
    (name) => normalizeName(name) === normalized,
  );
  if (hasMcp) matches.push("mcp");

  const hasSkill = parseSkillsDir(paths.skillsDir).some(
    (skill) => normalizeName(skill.name) === normalized,
  );
  if (hasSkill) matches.push("skill");

  return matches;
}

function removeEntityDataFromEntry(
  entry: LockEntry,
  entities: EntityType[],
): LockEntry | null {
  let next = { ...entry };

  if (entities.includes("agent")) {
    next = {
      ...next,
      importedAgents: [],
      requestedAgents: undefined,
    };
  }

  if (entities.includes("command")) {
    next = {
      ...next,
      importedCommands: [],
      selectedSourceCommands: undefined,
      commandRenameMap: undefined,
    };
  }

  if (entities.includes("mcp")) {
    next = {
      ...next,
      importedMcpServers: [],
      selectedSourceMcpServers: undefined,
    };
  }

  if (entities.includes("skill")) {
    next = {
      ...next,
      importedSkills: [],
      selectedSourceSkills: undefined,
      skillsAgentTargets: undefined,
    };
  }

  return finalizeEntry(next);
}

function removeNameFromEntry(
  entry: LockEntry,
  entities: EntityType[],
  candidate: string,
): LockEntry | null {
  let next = { ...entry };
  const normalized = normalizeName(candidate);

  if (entities.includes("agent")) {
    next.importedAgents = next.importedAgents.filter((item) => {
      const base = path.basename(item).replace(/\.md$/i, "");
      return normalizeName(base) !== normalized;
    });
  }

  if (entities.includes("command")) {
    const before = [...next.importedCommands];
    next.importedCommands = next.importedCommands.filter((item) => {
      const base = path.basename(item).replace(/\.(md|mdc)$/i, "");
      return normalizeName(base) !== normalized;
    });

    if (next.importedCommands.length !== before.length) {
      const remainingImportedNames = new Set(
        next.importedCommands.map((item) => path.basename(item)),
      );

      if (next.commandRenameMap) {
        const filteredRenameEntries = Object.entries(
          next.commandRenameMap,
        ).filter(([, importedName]) =>
          remainingImportedNames.has(path.basename(importedName)),
        );
        next.commandRenameMap =
          filteredRenameEntries.length > 0
            ? Object.fromEntries(filteredRenameEntries)
            : undefined;
      }

      const selectorsFromRenameMap = next.commandRenameMap
        ? Object.keys(next.commandRenameMap)
        : [];
      next.selectedSourceCommands =
        selectorsFromRenameMap.length > 0
          ? selectorsFromRenameMap
          : next.importedCommands.map((item) => path.basename(item));
    }
  }

  if (entities.includes("mcp")) {
    const before = [...next.importedMcpServers];
    next.importedMcpServers = next.importedMcpServers.filter(
      (name) => normalizeName(name) !== normalized,
    );
    if (next.importedMcpServers.length !== before.length) {
      next.selectedSourceMcpServers = [...next.importedMcpServers];
    }
  }

  if (entities.includes("skill")) {
    next.importedSkills = next.importedSkills.filter(
      (name) => normalizeName(name) !== normalized,
    );
    if (next.selectedSourceSkills) {
      next.selectedSourceSkills = next.selectedSourceSkills.filter(
        (name) => normalizeName(name) !== normalized,
      );
    }
  }

  return finalizeEntry(next);
}

function finalizeEntry(entry: LockEntry): LockEntry | null {
  const hasOtherEntities =
    entry.importedAgents.length > 0 ||
    entry.importedMcpServers.length > 0 ||
    entry.importedSkills.length > 0;

  if (entry.importedCommands.length === 0) {
    entry.commandRenameMap = undefined;
    entry.selectedSourceCommands = hasOtherEntities ? [] : undefined;
  }

  const trackedEntities = (entry.trackedEntities ?? []).filter((entity) => {
    if (entity === "agent") {
      return entry.importedAgents.length > 0 || Boolean(entry.requestedAgents);
    }
    if (entity === "command") {
      return (
        entry.importedCommands.length > 0 ||
        Boolean(entry.selectedSourceCommands) ||
        Boolean(entry.commandRenameMap)
      );
    }
    if (entity === "mcp") {
      return (
        entry.importedMcpServers.length > 0 ||
        Boolean(entry.selectedSourceMcpServers)
      );
    }
    return (
      entry.importedSkills.length > 0 ||
      Boolean(entry.selectedSourceSkills) ||
      Boolean(entry.skillsAgentTargets)
    );
  });

  const next: LockEntry = {
    ...entry,
    trackedEntities: trackedEntities.length > 0 ? trackedEntities : undefined,
  };

  if (
    next.importedAgents.length === 0 &&
    next.importedCommands.length === 0 &&
    next.importedMcpServers.length === 0 &&
    next.importedSkills.length === 0
  ) {
    return null;
  }

  return next;
}
