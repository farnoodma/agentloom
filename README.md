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
  mcp.json
  agents.lock.json
  settings.local.json
```

Global scope uses `~/.agents` with the same file layout.

## Commands

### `agentloom skills ...`
Pass-through wrapper to `npx skills ...` from
[`vercel-labs/skills`](https://github.com/vercel-labs/skills).

### `agentloom add <source>`
Import canonical agents/MCP from:

- local repo path
- GitHub slug (`owner/repo`)
- generic git URL

Options:

- `--ref <ref>`: git ref (branch/tag/commit) for remote sources
- `--subdir <path>`: subdirectory inside source repo
- `--agent <name>`: import only selected agents (repeatable or comma-separated)
- `--rename <name>`: rename imported agent when importing a single agent
- `--local | --global`: choose destination scope
- `--yes`: skip interactive conflict prompts
- `--no-sync`: skip post-import sync
- `--providers <csv>`: limit post-import sync providers
- `--dry-run`: show sync changes without writing provider files

Example:

```bash
agentloom add farnoodma/agents
agentloom add farnoodma/agents --agent issue-creator
```

Interactive mode (TTY) prompts with a selectable agent list when `--agent` is not provided.

### `agentloom update`
Refresh lockfile sources (`agents.lock.json`) and re-import changed revisions.

Options:

- `--local | --global`: choose lockfile scope
- `--yes`: skip conflict prompts during re-import
- `--no-sync`: skip post-update sync
- `--providers <csv>`: limit post-update sync providers
- `--dry-run`: show sync changes without writing provider files

### `agentloom sync`
Generate provider-specific outputs from canonical `.agents` data.

Options:

- `--local | --global`: choose canonical scope
- `--providers <csv>`: limit sync providers
- `--yes`: auto-delete stale generated files
- `--dry-run`: show planned changes without writing files

Example:

```bash
agentloom sync --providers codex,claude,cursor
```

### `agentloom mcp add|list|delete`
Manage canonical MCP servers in `.agents/mcp.json`.

`mcp add` options:

- `--url <url>` or `--command <cmd>`: required transport config
- `--arg <value>`: repeatable command arg
- `--env KEY=VALUE`: repeatable environment variable
- `--providers <csv>`: provider-specific assignment
- `--local | --global`: choose canonical scope
- `--no-sync`: skip post-change sync

`mcp list` options:

- `--json`: print raw canonical JSON
- `--local | --global`: choose canonical scope

`mcp delete` options:

- `--local | --global`: choose canonical scope
- `--no-sync`: skip post-change sync

Examples:

```bash
agentloom mcp add browser-tools --command npx --arg browser-tools-mcp
agentloom mcp list
agentloom mcp delete browser-tools
```

### Top-level help

```bash
agentloom --help
agentloom add --help
agentloom update --help
agentloom sync --help
agentloom mcp --help
agentloom mcp add --help
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

## Development

```bash
pnpm install
pnpm check
pnpm build
```

## Release and publish

The GitHub Actions publish workflow is defined in `.github/workflows/release.yml`.

- Push to `main` with `[patch]` or `[minor]` in commit subjects to trigger an automated npm release.
- Run the workflow manually (`workflow_dispatch`) and choose `patch` or `minor` to force a release.
- Push a `v*` tag (for example `v0.2.0`) to publish an already-versioned commit without bumping.
- Automated bump releases create a `vX.Y.Z` commit/tag via `npm version`, push both to GitHub, then publish to npm with provenance.

Required GitHub configuration:

- npm Trusted Publisher configured for this repo/workflow (`farnoodma/agentloom`, workflow file `release.yml`).
- Repository setting: `Actions -> General -> Workflow permissions -> Read and write permissions` (required so CI can push version commits/tags).

## License

MIT
