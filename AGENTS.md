# AGENTS.md

This file provides guidance to AI coding agents working on the `agentloom` monorepo.

## Project Overview

`agentloom` manages canonical agent and MCP config in `.agents/` and generates provider-native outputs for:

- Cursor
- Claude
- Codex
- OpenCode
- Gemini
- Copilot

Canonical layout (local scope):

```text
.agents/
  agents/
    *.md
  commands/
    *.md
  skills/
    <skill>/
      SKILL.md
      references/
      assets/
  mcp.json
  agents.lock.json
  settings.local.json
  .sync-manifest.json
```

Global scope uses `~/.agents` with the same canonical files.

## CLI Commands

| Command | Description |
| --- | --- |
| `agentloom add|find|update|sync|delete` | Aggregate operations across agents/commands/mcp/skills |
| `agentloom agent <add|list|delete|find|update|sync>` | Entity-scoped agent operations |
| `agentloom command <add|list|delete|find|update|sync>` | Entity-scoped command operations |
| `agentloom mcp <add|list|delete|find|update|sync>` | Entity-scoped MCP import/update/search/sync |
| `agentloom mcp server <add|list|delete>` | Manual MCP server editing in canonical `mcp.json` |
| `agentloom skill <add|list|delete|find|update|sync>` | Entity-scoped skill operations |

Common options across mutating commands:

- `--local` / `--global`
- `--yes`
- `--no-sync`
- `--providers <csv>`
- `--dry-run` (where supported)

## Architecture

```text
packages/cli/
  src/
    cli.ts                 # Command routing + version/update notifier trigger
    commands/
    core/
    sync/
    types.ts
  tests/
    integration/
    unit/

apps/web/
  src/app/                 # Next.js App Router pages + API routes
  src/server/db/           # Drizzle schema, ingestion, and leaderboard queries
  src/server/github/       # GitHub source content fetchers
  drizzle/                 # SQL migrations
```

## Core Behaviors To Preserve

### Source import expectations (`add` / `update`)

1. Source parsing supports local paths, GitHub slugs, and git URLs.
2. Source discovery supports entity directories: `agents/`, `commands/`, `skills/` (and `.agents/*` equivalents).
3. MCP discovery checks `.agents/mcp.json` first, then `mcp.json`.
4. Imports update `.agents/agents.lock.json` with resolved commit and imported items.
5. In non-interactive mode, unresolved conflicts must fail with actionable guidance unless `--yes` is set.

### Scope resolution expectations

- `--local` and `--global` are mutually exclusive.
- If neither is set and no local `.agents/` exists, default to global scope.
- If local `.agents/` exists and TTY is interactive, prompt for scope.
- If local `.agents/` exists and non-interactive, default to local scope.

### Sync expectations

- Sync always starts from canonical `.agents` inputs.
- Provider-specific files are generated and tracked in `.agents/.sync-manifest.json`.
- Entity-targeted syncs must preserve untouched entity outputs via manifest merge.
- Stale generated files are removed based on manifest diff (with prompt unless `--yes` or non-interactive).
- Codex sync is special: it updates `.codex/config.toml`, enables `features.multi_agent = true`, and writes role TOML + instruction files under `.codex/agents/`.

## Development

```bash
# Install deps
pnpm install

# Run full local gate
pnpm check

# Run tests only
pnpm test

# Build all workspaces
pnpm build

# Run CLI from source
pnpm --filter agentloom dev -- --help
pnpm --filter agentloom dev -- add farnoodma/agents

# Run web app
pnpm --filter @agentloom/web dev
```

CI uses Node 22 and `pnpm@10.17.1`.

## Validation Guidance

Run focused tests for the area you changed, then run `pnpm check` before finishing.

- CLI help/copy updates: `packages/cli/tests/unit/copy.test.ts`, `packages/cli/tests/unit/cli-help.test.ts`
- CLI import/source/scope updates: `packages/cli/tests/integration/import-local.test.ts`
- CLI MCP resolution updates: `packages/cli/tests/unit/mcp.test.ts`
- CLI Codex sync updates: `packages/cli/tests/unit/sync-codex.test.ts`
- CLI version notifier updates: `packages/cli/tests/unit/version-notifier.test.ts`
- Web ingest/query updates: `apps/web/src/app/api/v1/installs/route.test.ts`, `apps/web/src/lib/time.test.ts`

## Code Style

- TypeScript + ESM modules.
- Use Prettier formatting.
- Run `pnpm format` (or at minimum `pnpm format:check`) before finalizing changes.
- Do not hand-edit `packages/cli/dist/`; regenerate via `pnpm --filter agentloom build` when distribution output is needed.

## Release

CLI publish automation triggers on GitHub `release.published` events.
Web deploys are managed by Vercel Git integration.

Before release:

1. Ensure `pnpm check` passes.
2. Ensure `pnpm build` passes.
3. Confirm `packages/cli/package.json` version matches the release tag (`vX.Y.Z`).
