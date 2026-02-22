import { parseArgs } from "./core/argv.js";
import { runAgentCommand } from "./commands/agent.js";
import { runAddCommand } from "./commands/add.js";
import { runCommandCommand } from "./commands/command.js";
import { runDeleteCommand } from "./commands/delete.js";
import { runFindCommand } from "./commands/find.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runSkillCommand } from "./commands/skills.js";
import { runSyncCommand } from "./commands/sync.js";
import { runUpdateCommand } from "./commands/update.js";
import { formatUnknownCommandError, getRootHelpText } from "./core/copy.js";
import { maybePromptManageAgentsBootstrap } from "./core/manage-agents-bootstrap.js";
import { parseCommandRoute } from "./core/router.js";
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

  const parsed = parseArgs(argv);
  const cwd = process.cwd();

  const shouldBootstrapManageAgents = await maybePromptManageAgentsBootstrap({
    command,
    help: Boolean(parsed.help),
    yes: Boolean(parsed.yes),
    cwd,
  });
  if (shouldBootstrapManageAgents) {
    await runAddCommand(parseArgs(["add", "farnoodma/agentloom"]), cwd);
  }

  const route = parseCommandRoute(argv);

  if (!parsed.help) {
    await maybeNotifyVersionUpdate({
      command,
      currentVersion: version,
    });
  }

  if (!route) {
    throw new Error(formatUnknownCommandError(command));
  }

  if (route.mode === "aggregate") {
    switch (route.verb) {
      case "add":
        await runAddCommand(parsed, cwd);
        return;
      case "find":
        await runFindCommand(parsed);
        return;
      case "update":
        await runUpdateCommand(parsed, cwd);
        return;
      case "sync":
        await runSyncCommand(parsed, cwd);
        return;
      case "delete":
        await runDeleteCommand(parsed, cwd);
        return;
      default:
        throw new Error(formatUnknownCommandError(command));
    }
  }

  if (route.mode === "mcp-server") {
    await runMcpCommand(parsed, cwd);
    return;
  }

  switch (route.entity) {
    case "agent":
      await runAgentCommand(parsed, cwd);
      return;
    case "command":
      await runCommandCommand(parsed, cwd);
      return;
    case "mcp":
      await runMcpCommand(parsed, cwd);
      return;
    case "skill":
      await runSkillCommand(parsed, cwd);
      return;
    default:
      throw new Error(formatUnknownCommandError(command));
  }
}

function printHelp(): void {
  console.log(getRootHelpText());
}

function colorRed(text: string): string {
  return process.stderr.isTTY ? `\u001b[31m${text}\u001b[0m` : text;
}

export function formatCliErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return `\n${colorRed("✖")} Error`;
  }

  const lines = trimmed.split("\n");
  const firstLine = lines.shift();
  if (!firstLine) {
    return `\n${colorRed("✖")} Error`;
  }

  const formatted = `${colorRed("✖")} ${firstLine}`;
  return lines.length > 0
    ? `\n${formatted}\n${lines.join("\n")}`
    : `\n${formatted}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(formatCliErrorMessage(message));
    process.exit(1);
  });
}
