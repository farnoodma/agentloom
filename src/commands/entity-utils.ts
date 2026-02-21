import type { ParsedArgs } from "minimist";
import { getStringArrayFlag, parseProvidersFlag } from "../core/argv.js";
import { resolveScope } from "../core/scope.js";
import { updateLastScope } from "../core/settings.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";
import type { EntityType, ScopePaths } from "../types.js";

export function isInteractiveSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function getNonInteractiveMode(argv: ParsedArgs): boolean {
  if (argv.yes) return true;
  return !isInteractiveSession();
}

export async function resolvePathsForCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<ScopePaths> {
  return resolveScope({
    cwd,
    global: Boolean(argv.global),
    local: Boolean(argv.local),
    interactive: !getNonInteractiveMode(argv),
  });
}

export function getEntitySelectors(
  argv: ParsedArgs,
  entity: EntityType,
): string[] {
  const argsRecord = argv as Record<string, unknown>;

  if (entity === "agent") {
    return getStringArrayFlag(
      argsRecord.agents,
      getStringArrayFlag(argv.agent),
    );
  }
  if (entity === "command") {
    return getStringArrayFlag(
      argsRecord.commands,
      getStringArrayFlag(argsRecord.command),
    );
  }
  if (entity === "mcp") {
    return getStringArrayFlag(
      argsRecord.mcps,
      getStringArrayFlag(argsRecord.mcp),
    );
  }
  return getStringArrayFlag(
    argsRecord.skills,
    getStringArrayFlag(argsRecord.skill),
  );
}

export async function runPostMutationSync(options: {
  argv: ParsedArgs;
  paths: ScopePaths;
  target: EntityType | "all";
}): Promise<void> {
  if (options.argv["no-sync"]) return;

  const summary = await syncFromCanonical({
    paths: options.paths,
    providers: parseProvidersFlag(options.argv.providers),
    yes: Boolean(options.argv.yes),
    nonInteractive: getNonInteractiveMode(options.argv),
    dryRun: Boolean(options.argv["dry-run"]),
    target: options.target,
  });

  console.log("");
  console.log(formatSyncSummary(summary, options.paths.agentsRoot));
}

export function markScopeAsUsed(paths: ScopePaths): void {
  updateLastScope(paths.settingsPath, paths.scope);
}
