type UsageErrorInput = {
  issue: string;
  usage: string;
  example?: string;
};

const PROVIDERS_CSV = "cursor,claude,codex,opencode,gemini,copilot";

export function getRootHelpText(): string {
  return `dotagents - unified agent and MCP sync CLI

Usage:
  dotagents <command> [options]

Commands:
  skills ...                 Pass through to "npx skills ..."
  add <source>               Import agents and MCP from a repo source
  update                     Refresh lockfile-managed imports
  sync                       Generate provider-specific outputs
  mcp <add|list|delete>      Manage canonical MCP servers
  help                       Show this help text

Common options:
  --local                    Use .agents from current workspace
  --global                   Use ~/.agents
  --yes                      Skip interactive confirmations
  --no-sync                  Skip post-change sync (mutating commands)
  --providers <csv>          Limit sync providers (${PROVIDERS_CSV})
  --dry-run                  Print planned sync changes without writing files

Examples:
  dotagents add vercel-labs/skills
  dotagents add /repo --subdir packages/agents
  dotagents update --local
  dotagents sync --providers codex,claude,cursor
  dotagents mcp add browser-tools --command npx --arg browser-tools-mcp
  dotagents skills add vercel-labs/agent-skills
`;
}

export function getAddHelpText(): string {
  return `Import canonical agents and MCP from a source repository.

Usage:
  dotagents add <source> [options]

Options:
  --ref <ref>                Git ref (branch/tag/commit) for remote sources
  --subdir <path>            Subdirectory inside source repo
  --rename <name>            Rename imported agent (single-agent import only)
  --local | --global         Choose destination scope
  --yes                      Skip conflict prompts (overwrite/merge defaults)
  --no-sync                  Do not run sync after import
  --providers <csv>          Providers for post-import sync (${PROVIDERS_CSV})
  --dry-run                  Show sync plan without writing provider files

Example:
  dotagents add vercel-labs/skills --subdir skills --providers codex,claude
`;
}

export function getUpdateHelpText(): string {
  return `Refresh lockfile-managed sources and re-import updated revisions.

Usage:
  dotagents update [options]

Options:
  --local | --global         Choose lockfile scope
  --yes                      Skip conflict prompts during re-import
  --no-sync                  Do not run sync after updates
  --providers <csv>          Providers for post-update sync (${PROVIDERS_CSV})
  --dry-run                  Show sync plan without writing provider files

Example:
  dotagents update --local --providers codex,cursor
`;
}

export function getSyncHelpText(): string {
  return `Generate provider-specific agent and MCP files from canonical .agents data.

Usage:
  dotagents sync [options]

Options:
  --local | --global         Choose canonical scope
  --providers <csv>          Limit providers (${PROVIDERS_CSV})
  --yes                      Auto-delete stale generated files
  --dry-run                  Show file changes without writing

Example:
  dotagents sync --local --providers codex,claude,cursor --dry-run
`;
}

export function getMcpHelpText(): string {
  return `Manage canonical MCP servers in .agents/mcp.json.

Usage:
  dotagents mcp <command> [options]

Commands:
  add <name>                 Add or update an MCP server
  list                       List configured MCP servers
  delete <name>              Remove an MCP server

Shared options:
  --local | --global         Choose canonical scope
  --no-sync                  Skip post-change sync (add/delete only)
  --providers <csv>          Providers for post-change sync (${PROVIDERS_CSV})

Examples:
  dotagents mcp add browser --command npx --arg browser-tools-mcp
  dotagents mcp list --json
  dotagents mcp delete browser
`;
}

export function getMcpAddHelpText(): string {
  return `Add or update an MCP server in canonical .agents/mcp.json.

Usage:
  dotagents mcp add <name> (--url <url> | --command <cmd>) [options]

Options:
  --arg <value>              Repeatable command argument
  --env KEY=VALUE            Repeatable environment variable
  --providers <csv>          Provider-specific server assignment (${PROVIDERS_CSV})
  --local | --global         Choose canonical scope
  --no-sync                  Skip post-change sync

Examples:
  dotagents mcp add browser --command npx --arg browser-tools-mcp
  dotagents mcp add docs --url https://example.com/mcp --providers codex,claude
`;
}

export function getMcpListHelpText(): string {
  return `List canonical MCP servers.

Usage:
  dotagents mcp list [options]

Options:
  --json                     Print raw JSON
  --local | --global         Choose canonical scope

Example:
  dotagents mcp list --json
`;
}

export function getMcpDeleteHelpText(): string {
  return `Delete an MCP server from canonical .agents/mcp.json.

Usage:
  dotagents mcp delete <name> [options]

Options:
  --local | --global         Choose canonical scope
  --no-sync                  Skip post-change sync

Example:
  dotagents mcp delete browser
`;
}

export function formatUsageError(input: UsageErrorInput): string {
  const lines = [`Issue: ${input.issue}`, `Usage: ${input.usage}`];

  if (input.example) {
    lines.push(`Example: ${input.example}`);
  }

  return lines.join("\n");
}

export function formatUnknownCommandError(command: string): string {
  return formatUsageError({
    issue: `Unknown command "${command}".`,
    usage: "dotagents --help",
    example: "dotagents sync --local",
  });
}
