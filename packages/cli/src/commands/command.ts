import type { ParsedArgs } from "minimist";
import { parseCommandsDir } from "../core/commands.js";
import {
  formatUsageError,
  getCommandAddHelpText,
  getCommandDeleteHelpText,
  getCommandHelpText,
  getCommandListHelpText,
} from "../core/copy.js";
import { runScopedAddCommand } from "./add.js";
import { runScopedDeleteCommand } from "./delete.js";
import { resolvePathsForCommand } from "./entity-utils.js";
import { runScopedFindCommand } from "./find.js";
import { runScopedSyncCommand } from "./sync.js";
import { runScopedUpdateCommand } from "./update.js";

export async function runCommandCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  const action = argv._[1];

  if (argv.help) {
    if (action === "add") {
      console.log(getCommandAddHelpText());
      return;
    }
    if (action === "list") {
      console.log(getCommandListHelpText());
      return;
    }
    if (action === "delete") {
      console.log(getCommandDeleteHelpText());
      return;
    }

    console.log(getCommandHelpText());
    return;
  }

  if (!action) {
    console.log(getCommandHelpText());
    return;
  }

  if (
    action !== "add" &&
    action !== "list" &&
    action !== "delete" &&
    action !== "find" &&
    action !== "update" &&
    action !== "sync"
  ) {
    throw new Error(
      formatUsageError({
        issue: "Invalid command command.",
        usage: "agentloom command <add|list|delete|find|update|sync> [options]",
        example: "agentloom command add farnoodma/agents",
      }),
    );
  }

  if (action === "list") {
    const paths = await resolvePathsForCommand(argv, cwd);
    const commands = parseCommandsDir(paths.commandsDir);
    if (Boolean(argv.json)) {
      console.log(
        JSON.stringify(
          {
            version: 1,
            commands: commands.map((command) => command.fileName),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (commands.length === 0) {
      console.log("No canonical command files configured.");
      return;
    }

    for (const command of commands) {
      console.log(command.fileName);
    }
    return;
  }

  if (action === "add") {
    await runScopedAddCommand({
      argv,
      cwd,
      entity: "command",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "delete") {
    await runScopedDeleteCommand({
      argv,
      cwd,
      entity: "command",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "find") {
    await runScopedFindCommand(argv, "command");
    return;
  }

  if (action === "update") {
    await runScopedUpdateCommand({
      argv,
      cwd,
      entity: "command",
      sourceIndex: 2,
    });
    return;
  }

  await runScopedSyncCommand({
    argv,
    cwd,
    target: "command",
  });
}
