type UsageErrorInput = {
  issue: string;
  usage: string;
  example?: string;
};

const PROVIDERS_CSV = "cursor,claude,codex,opencode,gemini,copilot";

export function getRootHelpText(): string {
  return `agentloom - unified canonical agent package manager

Usage:
  agentloom <aggregate-command> [options]
  agentloom <entity> <verb> [options]

Aggregate commands:
  add <source>               Import agents/commands/mcp/skills from a source
  find <query>               Search remote + local entities
  update [source]            Refresh lockfile-managed imports
  sync                       Generate provider-specific outputs
  delete <source|name>       Delete imported entities by source or name

Entity commands:
  agent <add|list|delete|find|update|sync>
  command <add|list|delete|find|update|sync>
  mcp <add|list|delete|find|update|sync>
  skill <add|list|delete|find|update|sync>

MCP manual server commands:
  mcp server <add|list|delete>

Common options:
  --local                    Use .agents from current workspace
  --global                   Use ~/.agents
  --yes                      Skip interactive confirmations
  --no-sync                  Skip post-change sync (mutating commands)
  --providers <csv>          Limit sync providers (${PROVIDERS_CSV})
  --dry-run                  Print planned sync changes without writing files
  --agents <csv>             Agent selectors for add/delete
  --commands <csv>           Command selectors for add/delete
  --mcps <csv>               MCP selectors for add/delete
  --skills <csv>             Skill selectors for add/delete
  --selection-mode <mode>    Add mode: all (default) or custom
  --source <value>           Explicit source filter for update/delete
  --name <value>             Explicit name filter for delete
  --entity <type>            Delete disambiguation for aggregate delete

Examples:
  agentloom add farnoodma/agents
  agentloom agent add farnoodma/agents --agents issue-creator
  agentloom command add farnoodma/agents --commands review
  agentloom mcp add farnoodma/agents --mcps browser
  agentloom skill add farnoodma/agents --skills pr-review
  agentloom update
  agentloom command update farnoodma/agents
  agentloom delete farnoodma/agents
  agentloom mcp server add browser --command npx --arg browser-tools-mcp
`;
}

export function getFindHelpText(): string {
  return `Search remote repositories and local .agents entities.

Usage:
  agentloom find <query>
  agentloom <agent|command|mcp|skill> find <query>

Examples:
  agentloom find reviewer
  agentloom command find release
`;
}

export function getAddHelpText(): string {
  return `Import canonical entities from a source repository.

Source discovery:
  agents: .agents/agents -> agents
  commands: .agents/commands -> commands -> prompts
  skills: .agents/skills -> skills -> root SKILL.md

Usage:
  agentloom add <source> [options]

Options:
  --ref <ref>                Git ref (branch/tag/commit) for remote sources
  --subdir <path>            Subdirectory inside source repo
  --agents <name>            Import selected agents (repeatable/csv)
  --commands <name>          Import selected commands (repeatable/csv)
  --mcps <name>              Import selected MCP servers (repeatable/csv)
  --skills <name>            Import selected skills (repeatable/csv)
  --selection-mode <mode>    all|sync-all (include future items) or custom (pin selection)
  --rename <name>            Rename imported item for single-item add flows
  --local | --global         Choose destination scope (interactive prompts when omitted)
  --yes                      Skip conflict prompts
  --no-sync                  Do not run sync after import
  --providers <csv>          Providers for post-import sync (${PROVIDERS_CSV})
  --dry-run                  Show sync plan without writing provider files

Example:
  agentloom add farnoodma/agents --providers codex,claude
`;
}

export function getUpdateHelpText(): string {
  return `Refresh lockfile-managed sources and re-import updated revisions.

Usage:
  agentloom update [source] [options]
  agentloom <agent|command|mcp|skill> update [source] [options]

Options:
  --source <value>           Explicit source filter
  --local | --global         Choose lockfile scope (interactive prompts when omitted)
  --yes                      Skip conflict prompts during re-import
  --no-sync                  Do not run sync after updates
  --providers <csv>          Providers for post-update sync (${PROVIDERS_CSV})
  --dry-run                  Show sync plan without writing provider files

Example:
  agentloom update farnoodma/agents --providers codex,cursor
`;
}

export function getSyncHelpText(): string {
  return `Generate provider-specific files from canonical .agents data.

Usage:
  agentloom sync [options]
  agentloom <agent|command|mcp|skill> sync [options]

Options:
  --local | --global         Choose canonical scope (interactive prompts when omitted)
  --providers <csv>          Limit providers (${PROVIDERS_CSV})
  --yes                      Auto-delete stale generated files
  --dry-run                  Show file changes without writing
`;
}

export function getCommandHelpText(): string {
  return `Manage canonical command entities.

Usage:
  agentloom command <add|list|delete|find|update|sync> [options]
`;
}

export function getCommandAddHelpText(): string {
  return `Import canonical command files from a source repository.

Usage:
  agentloom command add <source> [options]

Options:
  --commands <name>          Repeatable command selector (name or filename)
  --ref <ref>                Git ref (branch/tag/commit) for remote sources
  --subdir <path>            Subdirectory inside source repo
  --rename <name>            Rename imported command (single-command import only)
`;
}

export function getCommandListHelpText(): string {
  return `List canonical command files.

Usage:
  agentloom command list [--json] [--local|--global]
`;
}

export function getCommandDeleteHelpText(): string {
  return `Delete command imports by source or name.

Usage:
  agentloom command delete <source|name> [options]
`;
}

export function getMcpHelpText(): string {
  return `Manage MCP entities imported from sources.

Usage:
  agentloom mcp <add|list|delete|find|update|sync> [options]
  agentloom mcp server <add|list|delete> [options]
`;
}

export function getMcpServerHelpText(): string {
  return `Manage manual MCP servers in canonical .agents/mcp.json.

Usage:
  agentloom mcp server <add|list|delete> [options]

Examples:
  agentloom mcp server add browser --command npx --arg browser-tools-mcp
  agentloom mcp server list --json
  agentloom mcp server delete browser
`;
}

export function getMcpAddHelpText(): string {
  return `Add or update a manual MCP server in canonical .agents/mcp.json.

Usage:
  agentloom mcp server add <name> (--url <url> | --command <cmd>) [options]

Options:
  --arg <value>              Repeatable command argument
  --env KEY=VALUE            Repeatable environment variable
  --providers <csv>          Provider-specific server assignment (${PROVIDERS_CSV})
`;
}

export function getMcpListHelpText(): string {
  return `List canonical MCP servers.

Usage:
  agentloom mcp server list [--json] [--local|--global]
`;
}

export function getMcpDeleteHelpText(): string {
  return `Delete a manual MCP server from canonical .agents/mcp.json.

Usage:
  agentloom mcp server delete <name> [options]
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
  if (command === "skills") {
    return formatUsageError({
      issue: 'Command "skills" was removed.',
      usage: "agentloom skill <add|list|delete|find|update|sync> [options]",
      example: "agentloom skill find typescript",
    });
  }

  return formatUsageError({
    issue: `Unknown command "${command}".`,
    usage: "agentloom --help",
    example: "agentloom sync --local",
  });
}
