# agentloom

`agentloom` is a unified CLI for managing agent definitions and MCP configuration across multiple AI coding tools — Cursor, Claude, Copilot, Codex, OpenCode, Gemini, and Pi.

For monorepo-level documentation and architecture context, see the [root README](../../README.md).

## Getting started

```bash
npx agentloom init
```

That's all you need. Agentloom picks up your existing provider configs, migrates them into a unified `.agents/` directory, and syncs everything back out to all your tools. From here on, manage your agents, commands, rules, skills, and MCP servers in one place and run `agentloom sync` whenever you make changes.

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
  rules/
    always-test.md
    enforce-logs.md
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
- `agentloom upgrade`
- `agentloom sync`
- `agentloom delete <source|name...>`

Aggregate `add` imports discoverable entities from a source (agents, commands, rules, MCP servers, skills). In interactive sessions, each entity supports two tracking modes:

- `Sync everything from source` (default): updates include newly added source items.
- `Use custom selection`: updates stay pinned to the selected items, even if all current items were selected.

Source path resolution is additive and priority-ordered:

- Agents: `.agents/agents` -> `agents`
- Commands: `.agents/commands` -> `commands` -> `prompts` -> provider fallbacks `.github/prompts` + `.gemini/commands`
- Rules: `.agents/rules` -> `rules`
- Skills: `.agents/skills` -> `skills` -> root `SKILL.md` -> root `<name>/SKILL.md` fallback
- MCP: `.agents/mcp.json` -> `mcp.json`

Aggregate `agentloom add <source>` can import command/skill/MCP-only repositories even when no `agents/` directory exists.

### Entity verbs

- `agentloom agent <add|list|delete|find|update|sync>`
- `agentloom command <add|list|delete|find|update|sync>`
- `agentloom mcp <add|list|delete|find|update|sync>`
- `agentloom rule <add|list|delete|find|update|sync>`
- `agentloom skill <add|list|delete|find|update|sync>`

### Selector flags

- `--agents <csv>`
- `--commands <csv>`
- `--mcps <csv>`
- `--rule <csv>` (alias)
- `--rules <csv>`
- `--skills <csv>`
- `--selection-mode <all|sync-all|custom>`
- `--source <value>`
- `--name <value>`
- `--entity <agent|command|mcp|rule|skill>`

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
agentloom rule add farnoodma/agents --rules always-test
agentloom skill add farnoodma/agents --skills pr-review
agentloom delete farnoodma/agents
agentloom command delete review audit
agentloom mcp server add browser-tools --command npx --arg browser-tools-mcp
```

### Top-level help

```bash
agentloom --help
agentloom find --help
agentloom add --help
agentloom update --help
agentloom upgrade --help
agentloom sync --help
agentloom delete --help
agentloom agent --help
agentloom skill --help
agentloom command --help
agentloom command add --help
agentloom mcp --help
agentloom mcp add --help
agentloom rule --help
agentloom mcp server --help
```

### Version update notice

`agentloom` performs best-effort npm version checks and upgrades when a newer release is available.

- checks are cached (`~/.agents/.agentloom-version-cache.json`)
- check/upgrade attempts run at most once every 2 hours per detected version
- in interactive TTY sessions, agentloom asks before upgrading
- in non-interactive sessions, upgrades run without prompts
- after an approved upgrade, the original command is re-run automatically
- if running from `npx`, auto-upgrade re-runs with `npx agentloom@<latest>`
- manual upgrade command: `agentloom upgrade`
- disable auto checks via:

```bash
AGENTLOOM_DISABLE_UPDATE_NOTIFIER=1
```

### Manage-agents bootstrap prompt

In interactive sessions, `agentloom` checks for:

- `~/.agents/skills/manage-agents/SKILL.md`
- `.agents/skills/manage-agents/SKILL.md` (in the current workspace)

If missing in both locations, it offers to bootstrap `manage-agents` because that skill helps agents reliably manage Agentloom resources (find/create/import/update/sync/delete).

The install runs after the requested command completes so scope/provider selections from that command can be reused.

- disable this prompt via `AGENTLOOM_DISABLE_MANAGE_AGENTS_PROMPT=1`

### Telemetry

Successful GitHub-based `agentloom add` imports can send anonymous telemetry
to the Agentloom directory API.

- tracked entities: agents, commands, rules, skills, MCP servers
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
  model: gpt-5-codex
  reasoningEffort: medium
  webSearch: true
---

You are a strict reviewer...
```

## Command schema

Canonical commands are markdown files. Frontmatter is optional. When present,
provider-specific command config can be nested per provider:

```md
---
copilot:
  description: Review current changes
  agent: agent
  tools:
    - codebase
  model: gpt-5
  argument-hint: "<scope>"
---

# /review

Review active changes with scope $ARGUMENTS.
```

Notes:

- Provider configs follow the same pattern as agents:
  - omit provider key for default behavior
  - `provider: { ... }` to add provider-specific overrides
  - `provider: false` to disable output for that provider
- Provider-specific frontmatter keys are passed through as-is to that provider output.
- Canonical command bodies can use `$ARGUMENTS`; provider-specific placeholder translation is applied during sync (for example Copilot receives `${input:args}` and Gemini receives `{{args}}`).

## Rule schema

Canonical rules are markdown files under `.agents/rules/*.md`.
Rules require `frontmatter.name`. Additional frontmatter keys are preserved.

```md
---
name: Always run tests
description: Require tests before merge
globs:
  - "**/*.ts"
alwaysApply: true
---

Before finishing any change, run the project checks and include the result.
```

Notes:

- Rule ID is the canonical filename stem (for example `.agents/rules/always-test.md` -> `always-test`).
- Managed instruction-block rendering uses only `frontmatter.name` + body.
- Extra frontmatter keys are used only for Cursor `.cursor/rules/*.mdc` rendering.

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

## Rule sync behavior

Rule sync is additive on top of agent/command/MCP/skill sync:

- Local scope always updates managed rule blocks in `AGENTS.md`.
- Local + Cursor writes `.cursor/rules/<rule-id>.mdc`.
- Local + Claude writes managed blocks to `CLAUDE.md`.
- Local + Gemini writes managed blocks to `GEMINI.md`.
- Local + Copilot writes managed blocks to `.github/copilot-instructions.md`.
- Local + OpenCode/Codex/Pi use the same managed `AGENTS.md` baseline blocks.
- Global + Claude writes `~/.claude/CLAUDE.md`.
- Global + Gemini writes `~/.gemini/GEMINI.md`.
- Global + Copilot writes `~/.copilot/copilot-instructions.md` and adds that location to VS Code `chat.instructionsFilesLocations`.
- Global + OpenCode writes `~/.config/opencode/AGENTS.md`.
- Global Cursor/Codex/Pi rule settings are no-op unless a stable provider settings key exists.

## Provider contract notes

- Cursor provider output uses Cursor subagents (`.cursor/agents/*.md`).
- Gemini command sync writes TOML files (`.gemini/commands/*.toml`).
- Copilot global output uses `~/.copilot/{agents,prompts,skills}` and `~/.copilot/copilot-instructions.md` (workspace output remains `.github/*`).
- Claude global user-scope MCP is not file-synced by Agentloom. Project MCP remains synced via `.mcp.json`.

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
