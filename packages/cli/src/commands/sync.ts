import type { ParsedArgs } from "minimist";
import { parseProvidersFlag } from "../core/argv.js";
import { getSyncHelpText } from "../core/copy.js";
import type { EntityType } from "../types.js";
import {
  getNonInteractiveMode,
  resolvePathsForCommand,
} from "./entity-utils.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";

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
}): Promise<void> {
  const paths = await resolvePathsForCommand(options.argv, options.cwd);

  const summary = await syncFromCanonical({
    paths,
    providers: parseProvidersFlag(options.argv.providers),
    yes: Boolean(options.argv.yes),
    nonInteractive: getNonInteractiveMode(options.argv),
    dryRun: Boolean(options.argv["dry-run"]),
    target: options.target,
  });

  console.log(formatSyncSummary(summary, paths.agentsRoot));
}
