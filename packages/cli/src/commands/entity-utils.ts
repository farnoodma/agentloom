import type { ParsedArgs } from "minimist";
import { getStringArrayFlag, parseProvidersFlag } from "../core/argv.js";
import { resolveScope } from "../core/scope.js";
import {
  getGlobalSettingsPath,
  updateLastScope,
  updateLastScopeBestEffort,
} from "../core/settings.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";
import type { EntityType, Provider, ScopePaths } from "../types.js";

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
  const paths = await resolveScope({
    cwd,
    global: Boolean(argv.global),
    local: Boolean(argv.local),
    interactive: !getNonInteractiveMode(argv),
  });
  const globalSettingsPath = getGlobalSettingsPath(paths.homeDir);
  updateLastScopeBestEffort(globalSettingsPath, paths.scope);
  return paths;
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
  providers?: Provider[];
}): Promise<void> {
  markScopeAsUsed(options.paths);

  if (options.argv["no-sync"]) return;

  const summary = await syncFromCanonical({
    paths: options.paths,
    providers: options.providers ?? parseProvidersFlag(options.argv.providers),
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
  const globalSettingsPath = getGlobalSettingsPath(paths.homeDir);
  if (paths.settingsPath !== globalSettingsPath) {
    updateLastScopeBestEffort(globalSettingsPath, paths.scope);
  }
}
