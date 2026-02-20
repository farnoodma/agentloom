import type { ParsedArgs } from "minimist";
import { parseProvidersFlag } from "../core/argv.js";
import { getSyncHelpText } from "../core/copy.js";
import { resolveScope } from "../core/scope.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";

export async function runSyncCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getSyncHelpText());
    return;
  }

  const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);

  const paths = await resolveScope({
    cwd,
    global: Boolean(argv.global),
    local: Boolean(argv.local),
    interactive: !nonInteractive,
  });

  const summary = await syncFromCanonical({
    paths,
    providers: parseProvidersFlag(argv.providers),
    yes: Boolean(argv.yes),
    nonInteractive,
    dryRun: Boolean(argv["dry-run"]),
  });

  console.log(formatSyncSummary(summary, paths.agentsRoot));
}
