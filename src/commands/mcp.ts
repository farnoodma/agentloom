import type { ParsedArgs } from "minimist";
import type { Provider } from "../types.js";
import { getStringArrayFlag, parseProvidersFlag } from "../core/argv.js";
import {
  formatUsageError,
  getMcpAddHelpText,
  getMcpDeleteHelpText,
  getMcpHelpText,
  getMcpListHelpText,
} from "../core/copy.js";
import { readCanonicalMcp, writeCanonicalMcp } from "../core/mcp.js";
import { resolveScope } from "../core/scope.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";

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

    console.log(getMcpHelpText());
    return;
  }

  if (action !== "add" && action !== "list" && action !== "delete") {
    throw new Error(
      formatUsageError({
        issue: "Invalid mcp command.",
        usage: "dotagents mcp <add|list|delete> [options]",
        example:
          "dotagents mcp add browser --command npx --arg browser-tools-mcp",
      }),
    );
  }

  const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);
  const paths = await resolveScope({
    cwd,
    global: Boolean(argv.global),
    local: Boolean(argv.local),
    interactive: !nonInteractive,
  });

  if (action === "list") {
    runMcpList(paths, Boolean(argv.json));
    return;
  }

  if (action === "add") {
    const name = argv._[2];
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(
        formatUsageError({
          issue: "Missing required MCP server name.",
          usage:
            "dotagents mcp add <name> (--url <url> | --command <cmd>) [options]",
          example:
            "dotagents mcp add browser --command npx --arg browser-tools-mcp",
        }),
      );
    }
    runMcpAdd(paths, argv, name.trim());

    if (!argv["no-sync"]) {
      const summary = await syncFromCanonical({
        paths,
        providers: parseProvidersFlag(argv.providers),
        yes: Boolean(argv.yes),
        nonInteractive,
      });
      console.log("");
      console.log(formatSyncSummary(summary, paths.agentsRoot));
    }
    return;
  }

  if (action === "delete") {
    const name = argv._[2];
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(
        formatUsageError({
          issue: "Missing required MCP server name.",
          usage: "dotagents mcp delete <name> [options]",
          example: "dotagents mcp delete browser",
        }),
      );
    }

    const mcp = readCanonicalMcp(paths);
    if (!(name in mcp.mcpServers)) {
      throw new Error(
        formatUsageError({
          issue: `MCP server "${name}" was not found in canonical config.`,
          usage: "dotagents mcp list [--json] [--local|--global]",
          example: "dotagents mcp list --json",
        }),
      );
    }

    delete mcp.mcpServers[name];
    writeCanonicalMcp(paths, mcp);
    console.log(`Deleted MCP server: ${name}`);

    if (!argv["no-sync"]) {
      const summary = await syncFromCanonical({
        paths,
        providers: parseProvidersFlag(argv.providers),
        yes: Boolean(argv.yes),
        nonInteractive,
      });
      console.log("");
      console.log(formatSyncSummary(summary, paths.agentsRoot));
    }
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
          "dotagents mcp add <name> (--url <url> | --command <cmd>) [options]",
        example:
          "dotagents mcp add browser --command npx --arg browser-tools-mcp",
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
              "dotagents mcp add <name> ... --env KEY=VALUE [--env KEY2=VALUE2]",
            example:
              "dotagents mcp add browser --command npx --env API_KEY=secret",
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
    const allProviders: Provider[] = [
      "cursor",
      "claude",
      "codex",
      "opencode",
      "gemini",
      "copilot",
    ];

    for (const provider of allProviders) {
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
