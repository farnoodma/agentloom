# agentloom

`agentloom` is a unified CLI for managing agent definitions and MCP configuration across multiple AI coding tools.

It uses `.agents` as the canonical source of truth and syncs provider-native files for:

- Cursor
- Claude
- Codex
- OpenCode
- Gemini
- Copilot

## Install

```bash
npm i -g agentloom
# or
npx agentloom --help
```

## Canonical layout

Project scope:

```text
.agents/
  agents/
    reviewer.md
    debugger.md
  commands/
    review.md
    ship.md
  skills/
    reviewing/
      SKILL.md
      references/
      assets/
    debugging/
      SKILL.md
      references/
      assets/
  mcp.json
  agents.lock.json
  settings.local.json
```

Global scope uses `~/.agents` with the same file layout.

## Commands

### Aggregate verbs

- `agentloom add <source>`
- `agentloom find <query>`
- `agentloom update [source]`
- `agentloom sync`
- `agentloom delete <source|name>`

Aggregate `add` imports discoverable entities from a source (agents, commands, MCP servers, skills). In interactive sessions, each entity supports two tracking modes:

- `Sync everything from source` (default): updates include newly added source items.
- `Use custom selection`: updates stay pinned to the selected items, even if all current items were selected.

Source path resolution is additive and priority-ordered:

- Agents: `.agents/agents` -> `agents`
- Commands: `.agents/commands` -> `commands` -> `prompts`
- Skills: `.agents/skills` -> `skills` -> root `SKILL.md` fallback
- MCP: `.agents/mcp.json` -> `mcp.json`

Aggregate `agentloom add <source>` can import command/skill/MCP-only repositories even when no `agents/` directory exists.

### Entity verbs

- `agentloom agent <add|list|delete|find|update|sync>`
- `agentloom command <add|list|delete|find|update|sync>`
- `agentloom mcp <add|list|delete|find|update|sync>`
- `agentloom skill <add|list|delete|find|update|sync>`

### Selector flags

- `--agents <csv>`
- `--commands <csv>`
- `--mcps <csv>`
- `--skills <csv>`
- `--selection-mode <all|sync-all|custom>`
- `--source <value>`
- `--name <value>`
- `--entity <agent|command|mcp|skill>`

### MCP manual server mode

Source-based MCP import lives under `agentloom mcp add ...`.
Manual server management is under:

- `agentloom mcp server add <name> (--url <url> | --command <cmd>)`
- `agentloom mcp server list`
- `agentloom mcp server delete <name>`

Examples:

```bash
agentloom add farnoodma/agents
agentloom agent add farnoodma/agents --agents issue-creator
agentloom command add farnoodma/agents --commands review
agentloom mcp add farnoodma/agents --mcps browser
agentloom skill add farnoodma/agents --skills pr-review
agentloom delete farnoodma/agents
agentloom mcp server add browser-tools --command npx --arg browser-tools-mcp
```

### Top-level help

```bash
agentloom --help
agentloom find --help
agentloom add --help
agentloom update --help
agentloom sync --help
agentloom delete --help
agentloom agent --help
agentloom skill --help
agentloom command --help
agentloom command add --help
agentloom mcp --help
agentloom mcp add --help
agentloom mcp server --help
```

### Version update notice

`agentloom` now performs a best-effort npm version check and shows an update hint when a newer release is available.

- check is cached (`~/.agents/.agentloom-version-cache.json`)
- check runs at most once every 12 hours
- check is skipped in non-interactive sessions
- disable via:

```bash
AGENTLOOM_DISABLE_UPDATE_NOTIFIER=1
```

### Telemetry

Successful GitHub-based `agentloom add` imports can send anonymous telemetry
to the Agentloom directory API.

- disable telemetry via `AGENTLOOM_DISABLE_TELEMETRY=1`
- override endpoint via `AGENTLOOM_TELEMETRY_ENDPOINT`

### Scope resolution

If neither `--local` nor `--global` is provided:

- if `.agents/` exists in current directory, `agentloom` prompts for scope in interactive terminals
- in non-interactive mode, local scope is selected when `.agents/` exists
- otherwise global scope (`~/.agents`) is used

## Agent schema

Canonical agents are markdown files with YAML frontmatter.

```md
---
name: code-reviewer
description: Review changes and report issues.
claude:
  model: sonnet
codex:
  model: gpt-5.3-codex
  reasoningEffort: low
  webSearch: true
---

You are a strict reviewer...
```

## MCP schema

Canonical MCP file format:

```json
{
  "version": 1,
  "mcpServers": {
    "browser": {
      "base": {
        "command": "npx",
        "args": ["browser-tools-mcp"]
      },
      "providers": {
        "codex": {
          "args": ["browser-tools-mcp", "--codex"]
        },
        "gemini": false
      }
    }
  }
}
```

## Codex multi-agent output

For Codex, `agentloom sync` writes role-based multi-agent config:

- `.codex/config.toml` (`[features].multi_agent = true`, `[agents.<role>]`)
- `.codex/agents/<role>.toml`
- `.codex/agents/<role>.instructions.md`

This follows official Codex multi-agent guidance.

For canonical commands (`.agents/commands`), Codex output is always written to
global prompts under `~/.codex/prompts` (Codex prompts are global-only), even
when syncing local scope.

## Development

```bash
pnpm install
pnpm check
pnpm build
```

## Release and publish

The GitHub Actions publish workflow is defined in `.github/workflows/release.yml`.

- Publish runs only when a GitHub Release is published (`release.published` event).
- Release tags must use stable semver (`vX.Y.Z`).
- The release tag version must match `packages/cli/package.json`.
- The workflow publishes only the CLI package to npm with provenance.

Required GitHub configuration:

- npm Trusted Publisher configured for this repo/workflow (`farnoodma/agentloom`, workflow file `release.yml`).

## License

MIT
