import { parseArgs } from "./core/argv.js";
import { runAddCommand } from "./commands/add.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runSkillsPassthrough } from "./commands/skills.js";
import { runSyncCommand } from "./commands/sync.js";
import { runUpdateCommand } from "./commands/update.js";
import { formatUnknownCommandError, getRootHelpText } from "./core/copy.js";
import { maybeNotifyVersionUpdate } from "./core/version-notifier.js";
import { getCliVersion } from "./core/version.js";

export async function runCli(argv: string[]): Promise<void> {
  const command = argv[0];
  const version = getCliVersion();

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(version);
    return;
  }

  if (command === "skills") {
    runSkillsPassthrough(argv.slice(1));
    return;
  }

  const parsed = parseArgs(argv);
  const cwd = process.cwd();

  if (!parsed.help) {
    await maybeNotifyVersionUpdate({
      command,
      currentVersion: version,
    });
  }

  switch (command) {
    case "add":
      await runAddCommand(parsed, cwd);
      return;
    case "update":
      await runUpdateCommand(parsed, cwd);
      return;
    case "sync":
      await runSyncCommand(parsed, cwd);
      return;
    case "mcp":
      await runMcpCommand(parsed, cwd);
      return;
    default:
      throw new Error(formatUnknownCommandError(command));
  }
}

function printHelp(): void {
  console.log(getRootHelpText());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
