import type { ParsedArgs } from "minimist";
import { ALL_PROVIDERS } from "../types.js";
import type { Provider } from "../types.js";
import { getStringArrayFlag, parseProvidersFlag } from "../core/argv.js";
import {
  formatUsageError,
  getMcpAddHelpText,
  getMcpDeleteHelpText,
  getMcpHelpText,
  getMcpListHelpText,
  getMcpServerHelpText,
} from "../core/copy.js";
import { readCanonicalMcp, writeCanonicalMcp } from "../core/mcp.js";
import { runScopedAddCommand } from "./add.js";
import { runScopedDeleteCommand } from "./delete.js";
import { resolvePathsForCommand } from "./entity-utils.js";
import { runScopedFindCommand } from "./find.js";
import { runScopedSyncCommand } from "./sync.js";
import { runScopedUpdateCommand } from "./update.js";

export async function runMcpCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  const action = argv._[1];

  if (argv.help) {
    if (action === "add") {
      console.log(getMcpAddHelpText());
      return;
    }
    if (action === "list") {
      console.log(getMcpListHelpText());
      return;
    }
    if (action === "delete") {
      console.log(getMcpDeleteHelpText());
      return;
    }
    if (action === "server") {
      console.log(getMcpServerHelpText());
      return;
    }

    console.log(getMcpHelpText());
    return;
  }

  if (!action) {
    console.log(getMcpHelpText());
    return;
  }

  if (action === "server") {
    await runMcpServerCommand(argv, cwd);
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
        issue: "Invalid mcp command.",
        usage: "agentloom mcp <add|list|delete|find|update|sync> [options]",
        example: "agentloom mcp add farnoodma/agents --mcps browser",
      }),
    );
  }

  if (action === "list") {
    const paths = await resolvePathsForCommand(argv, cwd);
    runMcpList(paths, Boolean(argv.json));
    return;
  }

  if (action === "add") {
    await runScopedAddCommand({
      argv,
      cwd,
      entity: "mcp",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "delete") {
    await runScopedDeleteCommand({
      argv,
      cwd,
      entity: "mcp",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "find") {
    await runScopedFindCommand(argv, "mcp");
    return;
  }

  if (action === "update") {
    await runScopedUpdateCommand({
      argv,
      cwd,
      entity: "mcp",
      sourceIndex: 2,
    });
    return;
  }

  await runScopedSyncCommand({
    argv,
    cwd,
    target: "mcp",
  });
}

async function runMcpServerCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  const action = argv._[2];

  if (argv.help || !action) {
    console.log(getMcpServerHelpText());
    return;
  }

  if (action !== "add" && action !== "list" && action !== "delete") {
    throw new Error(
      formatUsageError({
        issue: "Invalid mcp server command.",
        usage: "agentloom mcp server <add|list|delete> [options]",
        example:
          "agentloom mcp server add browser --command npx --arg browser-tools-mcp",
      }),
    );
  }

  const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);
  const paths = await resolvePathsForCommand(argv, cwd);

  if (action === "list") {
    if (argv.help) {
      console.log(getMcpListHelpText());
      return;
    }
    runMcpList(paths, Boolean(argv.json));
    return;
  }

  if (action === "add") {
    if (argv.help) {
      console.log(getMcpAddHelpText());
      return;
    }

    const name = argv._[3];
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(
        formatUsageError({
          issue: "Missing required MCP server name.",
          usage:
            "agentloom mcp server add <name> (--url <url> | --command <cmd>) [options]",
          example:
            "agentloom mcp server add browser --command npx --arg browser-tools-mcp",
        }),
      );
    }

    runMcpAdd(paths, argv, name.trim());
    if (!argv["no-sync"]) {
      await runScopedSyncCommand({
        argv,
        cwd,
        target: "mcp",
      });
    }
    return;
  }

  if (argv.help) {
    console.log(getMcpDeleteHelpText());
    return;
  }

  const name = argv._[3];
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(
      formatUsageError({
        issue: "Missing required MCP server name.",
        usage: "agentloom mcp server delete <name> [options]",
        example: "agentloom mcp server delete browser",
      }),
    );
  }

  const mcp = readCanonicalMcp(paths);
  if (!(name in mcp.mcpServers)) {
    throw new Error(
      formatUsageError({
        issue: `MCP server "${name}" was not found in canonical config.`,
        usage: "agentloom mcp server list [--json] [--local|--global]",
        example: "agentloom mcp server list --json",
      }),
    );
  }

  delete mcp.mcpServers[name];
  writeCanonicalMcp(paths, mcp);
  console.log(`Deleted MCP server: ${name}`);

  if (!argv["no-sync"]) {
    await runScopedSyncCommand({
      argv,
      cwd,
      target: "mcp",
    });
  }

  if (!nonInteractive) {
    return;
  }
}

function runMcpList(paths: { mcpPath: string }, asJson: boolean): void {
  const mcp = readCanonicalMcp(paths);
  const names = Object.keys(mcp.mcpServers).sort();

  if (asJson) {
    console.log(JSON.stringify(mcp, null, 2));
    return;
  }

  if (names.length === 0) {
    console.log("No MCP servers configured.");
    return;
  }

  for (const name of names) {
    const server = mcp.mcpServers[name];
    const transport =
      server.base && typeof server.base === "object"
        ? server.base.url
          ? "http"
          : server.base.command
            ? "stdio"
            : "custom"
        : server.url
          ? "http"
          : server.command
            ? "stdio"
            : "custom";

    console.log(`${name} (${transport})`);
  }
}

function runMcpAdd(
  paths: { mcpPath: string },
  argv: ParsedArgs,
  name: string,
): void {
  const mcp = readCanonicalMcp(paths);
  const baseConfig: Record<string, unknown> = {};

  if (typeof argv.url === "string" && argv.url.trim()) {
    baseConfig.url = argv.url.trim();
  }

  if (typeof argv.command === "string" && argv.command.trim()) {
    baseConfig.command = argv.command.trim();
  }

  if (!baseConfig.url && !baseConfig.command) {
    throw new Error(
      formatUsageError({
        issue: "Missing MCP transport. Use --url or --command.",
        usage:
          "agentloom mcp server add <name> (--url <url> | --command <cmd>) [options]",
        example:
          "agentloom mcp server add browser --command npx --arg browser-tools-mcp",
      }),
    );
  }

  const args = getStringArrayFlag((argv as Record<string, unknown>).arg);
  if (args.length > 0) {
    baseConfig.args = args;
  }

  const envPairs = getStringArrayFlag((argv as Record<string, unknown>).env);
  if (envPairs.length > 0) {
    const env: Record<string, string> = {};
    for (const pair of envPairs) {
      const separator = pair.indexOf("=");
      if (separator <= 0) {
        throw new Error(
          formatUsageError({
            issue: `Invalid --env value "${pair}".`,
            usage:
              "agentloom mcp server add <name> ... --env KEY=VALUE [--env KEY2=VALUE2]",
            example:
              "agentloom mcp server add browser --command npx --env API_KEY=secret",
          }),
        );
      }
      const key = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1);
      env[key] = value;
    }
    baseConfig.env = env;
  }

  const providers = parseProvidersFlag(argv.providers);

  if (!providers || providers.length === 0) {
    mcp.mcpServers[name] = {
      base: baseConfig,
    };
  } else {
    const providerMap: Partial<
      Record<Provider, Record<string, unknown> | false>
    > = {};

    for (const provider of ALL_PROVIDERS) {
      providerMap[provider] = providers.includes(provider)
        ? { ...baseConfig }
        : false;
    }

    mcp.mcpServers[name] = {
      providers: providerMap,
    };
  }

  writeCanonicalMcp(paths, mcp);
  console.log(`Added MCP server: ${name}`);
}
