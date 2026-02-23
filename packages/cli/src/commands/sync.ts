import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ParsedArgs } from "minimist";
import { parseProvidersFlag } from "../core/argv.js";
import { getSyncHelpText } from "../core/copy.js";
import {
  formatMigrationSummary,
  initializeCanonicalLayout,
  migrateProviderStateToCanonical,
  MigrationConflictError,
} from "../core/migration.js";
import type { EntityType, ScopePaths } from "../types.js";
import {
  getNonInteractiveMode,
  resolvePathsForCommand,
} from "./entity-utils.js";
import {
  formatSyncSummary,
  resolveProvidersForSync,
  syncFromCanonical,
} from "../sync/index.js";

export async function runSyncCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getSyncHelpText());
    return;
  }

  await runScopedSyncCommand({
    argv,
    cwd,
    target: "all",
  });
}

export async function runScopedSyncCommand(options: {
  argv: ParsedArgs;
  cwd: string;
  target: EntityType | "all";
  skipSync?: boolean;
}): Promise<void> {
  const nonInteractive = getNonInteractiveMode(options.argv);
  let cleanupDryRunPaths: (() => void) | undefined;

  try {
    const paths = await resolvePathsForCommand(options.argv, options.cwd);
    const explicitProviders = parseProvidersFlag(options.argv.providers);
    const providers = await resolveProvidersForSync({
      paths,
      explicitProviders,
      nonInteractive,
    });

    const dryRun = Boolean(options.argv["dry-run"]);
    const effectivePaths = dryRun
      ? createDryRunCanonicalPaths(paths)
      : { paths, cleanup: undefined };
    cleanupDryRunPaths = effectivePaths.cleanup;

    initializeCanonicalLayout(effectivePaths.paths, providers);

    const migrationSummary = await migrateProviderStateToCanonical({
      paths: effectivePaths.paths,
      providers,
      target: options.target,
      yes: Boolean(options.argv.yes),
      nonInteractive,
      dryRun,
      materializeCanonical: dryRun,
    });

    console.log(formatMigrationSummary(migrationSummary));

    if (options.skipSync) {
      return;
    }

    const syncSummary = await syncFromCanonical({
      paths: effectivePaths.paths,
      providers,
      yes: Boolean(options.argv.yes),
      nonInteractive,
      dryRun,
      target: options.target,
    });

    console.log("");
    console.log(formatSyncSummary(syncSummary, paths.agentsRoot));
  } catch (error) {
    if (error instanceof MigrationConflictError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  } finally {
    cleanupDryRunPaths?.();
  }
}

function createDryRunCanonicalPaths(paths: ScopePaths): {
  paths: ScopePaths;
  cleanup: () => void;
} {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-dry-run-"));
  const tempAgentsRoot = path.join(tempRoot, ".agents");

  if (
    fs.existsSync(paths.agentsRoot) &&
    fs.statSync(paths.agentsRoot).isDirectory()
  ) {
    fs.cpSync(paths.agentsRoot, tempAgentsRoot, {
      recursive: true,
      force: true,
    });
  }

  return {
    paths: {
      ...paths,
      agentsRoot: tempAgentsRoot,
      agentsDir: path.join(tempAgentsRoot, "agents"),
      commandsDir: path.join(tempAgentsRoot, "commands"),
      skillsDir: path.join(tempAgentsRoot, "skills"),
      mcpPath: path.join(tempAgentsRoot, "mcp.json"),
      lockPath: path.join(tempAgentsRoot, "agents.lock.json"),
      settingsPath: path.join(tempAgentsRoot, "settings.local.json"),
      manifestPath: path.join(tempAgentsRoot, ".sync-manifest.json"),
    },
    cleanup() {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}
