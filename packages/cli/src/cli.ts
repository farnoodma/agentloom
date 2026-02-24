import type { ParsedArgs } from "minimist";
import { parseArgs } from "./core/argv.js";
import { parseProvidersFlag } from "./core/argv.js";
import { runAgentCommand } from "./commands/agent.js";
import { runAddCommand } from "./commands/add.js";
import { runCommandCommand } from "./commands/command.js";
import { runDeleteCommand } from "./commands/delete.js";
import { runFindCommand } from "./commands/find.js";
import { runInitCommand } from "./commands/init.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runSkillCommand } from "./commands/skills.js";
import { runSyncCommand } from "./commands/sync.js";
import { runUpgradeCommand } from "./commands/upgrade.js";
import { runUpdateCommand } from "./commands/update.js";
import { formatUnknownCommandError, getRootHelpText } from "./core/copy.js";
import { maybePromptManageAgentsBootstrap } from "./core/manage-agents-bootstrap.js";
import { parseCommandRoute } from "./core/router.js";
import { buildScopePaths } from "./core/scope.js";
import { getGlobalSettingsPath, readSettings } from "./core/settings.js";
import { maybeNotifyVersionUpdate } from "./core/version-notifier.js";
import { getCliVersion } from "./core/version.js";
import type { Provider, Scope } from "./types.js";
import { ALL_PROVIDERS } from "./types.js";

const MANAGE_AGENTS_SOURCE = "farnoodma/agentloom";
const MANAGE_AGENTS_SELECTOR = "manage-agents";

export async function runCli(argv: string[]): Promise<void> {
  const command = argv[0] ?? "";
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
  const route = parseCommandRoute(argv);

  if (!parsed.help) {
    await maybeNotifyVersionUpdate({
      command,
      argv,
      currentVersion: version,
    });
  }

  if (!route) {
    throw new Error(formatUnknownCommandError(command));
  }

  const shouldBootstrapManageAgents = await maybePromptManageAgentsBootstrap({
    command,
    help: Boolean(parsed.help),
    yes: Boolean(parsed.yes),
    cwd,
  });

  await runRoutedCommand(route, parsed, cwd, command, version);

  if (shouldBootstrapManageAgents) {
    const bootstrapArgs = buildManageAgentsBootstrapArgs(parsed, cwd);
    await runSkillCommand(parseArgs(bootstrapArgs), cwd);
  }
}

function printHelp(): void {
  console.log(getRootHelpText());
}

async function runRoutedCommand(
  route: ReturnType<typeof parseCommandRoute>,
  parsed: ParsedArgs,
  cwd: string,
  command: string,
  version: string,
): Promise<void> {
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
      case "upgrade":
        await runUpgradeCommand(parsed, version);
        return;
      case "sync":
        await runSyncCommand(parsed, cwd);
        return;
      case "delete":
        await runDeleteCommand(parsed, cwd);
        return;
      case "init":
        await runInitCommand(parsed, cwd);
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

function buildManageAgentsBootstrapArgs(
  parsed: ParsedArgs,
  cwd: string,
): string[] {
  const scope = resolveBootstrapScope(parsed);
  const providers = resolveBootstrapProviders(parsed, cwd, scope);

  const args: string[] = [
    "skill",
    "add",
    MANAGE_AGENTS_SOURCE,
    "--skills",
    MANAGE_AGENTS_SELECTOR,
  ];

  if (scope === "local") args.push("--local");
  if (scope === "global") args.push("--global");

  if (
    typeof parsed["selection-mode"] === "string" &&
    parsed["selection-mode"].trim().length > 0
  ) {
    args.push("--selection-mode", parsed["selection-mode"].trim());
  }

  if (parsed["no-sync"]) args.push("--no-sync");
  if (parsed["dry-run"]) args.push("--dry-run");

  if (providers && providers.length > 0) {
    args.push("--providers", providers.join(","));
  }

  return args;
}

function resolveBootstrapScope(parsed: ParsedArgs): Scope | undefined {
  if (parsed.local) return "local";
  if (parsed.global) return "global";

  const globalSettings = readSettings(getGlobalSettingsPath());
  if (
    globalSettings.lastScope === "local" ||
    globalSettings.lastScope === "global"
  ) {
    return globalSettings.lastScope;
  }

  return undefined;
}

function resolveBootstrapProviders(
  parsed: ParsedArgs,
  cwd: string,
  scope: Scope | undefined,
): Provider[] | undefined {
  const explicitProviders = parseProvidersFlag(parsed.providers);
  if (explicitProviders && explicitProviders.length > 0) {
    return explicitProviders;
  }

  if (!scope) return undefined;
  const settingsPath = buildScopePaths(cwd, scope).settingsPath;
  const scopeSettings = readSettings(settingsPath);
  return normalizeProviders(scopeSettings.defaultProviders);
}

function normalizeProviders(
  providers: readonly string[] | undefined,
): Provider[] {
  const selected = new Set<Provider>();

  for (const provider of providers ?? []) {
    const normalized = provider.trim().toLowerCase() as Provider;
    if (ALL_PROVIDERS.includes(normalized)) {
      selected.add(normalized);
    }
  }

  return [...selected];
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
