import type { ParsedArgs } from "minimist";
import { parseProvidersFlag } from "../core/argv.js";
import { getInitHelpText } from "../core/copy.js";
import {
  getNonInteractiveMode,
  resolvePathsForCommand,
} from "./entity-utils.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";

export async function runInitCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getInitHelpText());
    return;
  }

  const paths = await resolvePathsForCommand(argv, cwd);
  const summary = await syncFromCanonical({
    paths,
    providers: parseProvidersFlag(argv.providers),
    yes: Boolean(argv.yes),
    nonInteractive: getNonInteractiveMode(argv),
    dryRun: Boolean(argv["dry-run"]),
    target: "all",
  });

  console.log(formatSyncSummary(summary, paths.agentsRoot));
}
