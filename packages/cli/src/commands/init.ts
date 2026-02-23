import type { ParsedArgs } from "minimist";
import { getInitHelpText } from "../core/copy.js";
import { runScopedSyncCommand } from "./sync.js";

export async function runInitCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getInitHelpText());
    return;
  }

  await runScopedSyncCommand({
    argv,
    cwd,
    target: "all",
    skipSync: Boolean(argv["no-sync"]),
  });
}
