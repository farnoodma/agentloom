import type { ParsedArgs } from "minimist";
import { parseProvidersFlag, parseSelectionModeFlag } from "../core/argv.js";
import { formatUsageError, getAddHelpText } from "../core/copy.js";
import { importSource, NonInteractiveConflictError } from "../core/importer.js";
import type { EntityType } from "../types.js";
import {
  getEntitySelectors,
  getNonInteractiveMode,
  markScopeAsUsed,
  resolvePathsForCommand,
  runPostMutationSync,
} from "./entity-utils.js";

export async function runAddCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getAddHelpText());
    return;
  }

  await runEntityAwareAdd({
    argv,
    cwd,
    target: "all",
    sourceIndex: 1,
  });
}

export async function runScopedAddCommand(options: {
  argv: ParsedArgs;
  cwd: string;
  entity: EntityType;
  sourceIndex: number;
}): Promise<void> {
  await runEntityAwareAdd({
    argv: options.argv,
    cwd: options.cwd,
    target: options.entity,
    sourceIndex: options.sourceIndex,
  });
}

async function runEntityAwareAdd(options: {
  argv: ParsedArgs;
  cwd: string;
  target: EntityType | "all";
  sourceIndex: number;
}): Promise<void> {
  const source = options.argv._[options.sourceIndex];
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error(
      formatUsageError({
        issue: "Missing required <source>.",
        usage: buildAddUsage(options.target),
        example: buildAddExample(options.target),
      }),
    );
  }

  const nonInteractive = getNonInteractiveMode(options.argv);
  const paths = await resolvePathsForCommand(options.argv, options.cwd);

  const providers = parseProvidersFlag(options.argv.providers);
  const selectionMode = parseSelectionModeFlag(
    (options.argv as Record<string, unknown>)["selection-mode"],
  );
  const importAgents = options.target === "all" || options.target === "agent";
  const importCommands =
    options.target === "all" || options.target === "command";
  const importMcp = options.target === "all" || options.target === "mcp";
  const importSkills = options.target === "all" || options.target === "skill";

  const agentSelectors = getEntitySelectors(options.argv, "agent");
  const commandSelectors = getEntitySelectors(options.argv, "command");
  const mcpSelectors = getEntitySelectors(options.argv, "mcp");
  const skillSelectors = getEntitySelectors(options.argv, "skill");

  try {
    const summary = await importSource({
      source,
      ref: typeof options.argv.ref === "string" ? options.argv.ref : undefined,
      subdir:
        typeof options.argv.subdir === "string"
          ? options.argv.subdir
          : undefined,
      rename:
        typeof options.argv.rename === "string"
          ? options.argv.rename
          : undefined,
      agents: agentSelectors,
      yes: Boolean(options.argv.yes),
      nonInteractive,
      paths,
      importAgents,
      importCommands,
      requireCommands: options.target === "command",
      importMcp,
      requireMcp: options.target === "mcp",
      mcpSelectors,
      promptForMcp: mcpSelectors.length === 0,
      importSkills,
      requireSkills: options.target === "skill",
      skillSelectors,
      promptForSkills: skillSelectors.length === 0,
      skillsProviders: providers,
      commandSelectors,
      promptForCommands: commandSelectors.length === 0,
      promptForAgentSelection: agentSelectors.length === 0,
      selectionMode,
    });

    console.log(`Imported source: ${summary.source}`);
    console.log(`Source type: ${summary.sourceType}`);
    console.log(`Resolved commit: ${summary.resolvedCommit}`);
    console.log(`Imported agents: ${summary.importedAgents.length}`);
    console.log(`Imported commands: ${summary.importedCommands.length}`);
    console.log(`Imported MCP servers: ${summary.importedMcpServers.length}`);
    console.log(`Imported skills: ${summary.importedSkills.length}`);

    markScopeAsUsed(paths);
    await runPostMutationSync({
      argv: options.argv,
      paths,
      target: options.target,
    });
  } catch (err) {
    if (err instanceof NonInteractiveConflictError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}

function buildAddUsage(target: EntityType | "all"): string {
  if (target === "agent") {
    return "agentloom agent add <source> [--ref <ref>] [--subdir <path>] [--agents <name>] [options]";
  }
  if (target === "command") {
    return "agentloom command add <source> [--ref <ref>] [--subdir <path>] [--commands <name>] [options]";
  }
  if (target === "mcp") {
    return "agentloom mcp add <source> [--ref <ref>] [--subdir <path>] [--mcps <name>] [options]";
  }
  if (target === "skill") {
    return "agentloom skill add <source> [--ref <ref>] [--subdir <path>] [--skills <name>] [options]";
  }
  return "agentloom add <source> [--ref <ref>] [--subdir <path>] [options]";
}

function buildAddExample(target: EntityType | "all"): string {
  if (target === "agent") {
    return "agentloom agent add farnoodma/agents --agents issue-creator";
  }
  if (target === "command") {
    return "agentloom command add farnoodma/agents --commands review";
  }
  if (target === "mcp") {
    return "agentloom mcp add farnoodma/agents --mcps browser";
  }
  if (target === "skill") {
    return "agentloom skill add farnoodma/agents --skills code-review";
  }
  return "agentloom add farnoodma/agents --providers codex,claude";
}
