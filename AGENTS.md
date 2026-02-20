# AGENTS.md

This file provides guidance to AI coding agents working on the `agentloom` CLI codebase.

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
  mcp.json
  agents.lock.json
  settings.local.json
  .sync-manifest.json
```

Global scope uses `~/.agents` with the same canonical files.

## CLI Commands

| Command | Description |
| --- | --- |
| `agentloom skills ...` | Pass-through to `npx skills ...` from `vercel-labs/skills` |
| `agentloom add <source>` | Import canonical agents/MCP from local path, GitHub slug, or git URL |
| `agentloom update` | Refresh lockfile-managed sources and re-import changed revisions |
| `agentloom sync` | Generate provider-native agent and MCP outputs |
| `agentloom mcp add|list|delete` | Manage canonical MCP servers in `.agents/mcp.json` |

Common options across mutating commands:

- `--local` / `--global`
- `--yes`
- `--no-sync`
- `--providers <csv>`
- `--dry-run` (where supported)

## Architecture

```text
src/
  cli.ts                   # Command routing + version/update notifier trigger
  commands/
    add.ts                 # add command flow
    update.ts              # update command flow using lockfile entries
    sync.ts                # sync command flow
    mcp.ts                 # mcp add/list/delete command flow
    skills.ts              # npx skills passthrough
  core/
    argv.ts                # flag parsing helpers
    copy.ts                # help/usage strings
    scope.ts               # local/global scope resolution
    sources.ts             # source detection + clone/local prep
    importer.ts            # import + conflict handling + lockfile update
    agents.ts              # markdown/frontmatter parsing + provider config extraction
    mcp.ts                 # canonical MCP read/write + provider resolution
    lockfile.ts            # agents.lock.json read/write
    manifest.ts            # .sync-manifest.json read/write
    settings.ts            # settings.local.json + global settings
    version.ts             # CLI version lookup
    version-notifier.ts    # npm update hint cache + lookup
    fs.ts                  # filesystem utilities
  sync/
    index.ts               # provider file generation + stale cleanup
  types.ts                 # shared types and provider list

tests/
  integration/import-local.test.ts
  unit/agents.test.ts
  unit/cli-help.test.ts
  unit/copy.test.ts
  unit/mcp.test.ts
  unit/sync-codex.test.ts
  unit/version-notifier.test.ts
```

## Core Behaviors To Preserve

### Source import expectations (`add` / `update`)

1. Source parsing supports local paths, GitHub slugs, and git URLs.
2. Source discovery expects `agents/` or `.agents/agents/`.
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

# Build CLI
pnpm build

# Run CLI from source
pnpm dev -- --help
pnpm dev -- add vercel-labs/skills --subdir skills
```

CI uses Node 22 and `pnpm@10.17.1`.

## Validation Guidance

Run focused tests for the area you changed, then run `pnpm check` before finishing.

- Help/copy updates: `tests/unit/copy.test.ts`, `tests/unit/cli-help.test.ts`
- Import/source/scope updates: `tests/integration/import-local.test.ts`
- MCP resolution updates: `tests/unit/mcp.test.ts`
- Codex sync updates: `tests/unit/sync-codex.test.ts`
- Version notification updates: `tests/unit/version-notifier.test.ts`

## Code Style

- TypeScript + ESM modules.
- Use Prettier formatting.
- Run `pnpm format` (or at minimum `pnpm format:check`) before finalizing changes.
- Do not hand-edit `dist/`; regenerate via `pnpm build` when distribution output is needed.

## Release

The release workflow publishes to npm via `pnpm publish --access public --no-git-checks`.

Before release:

1. Ensure `pnpm check` passes.
2. Ensure `pnpm build` passes.
3. Confirm `package.json` version is correct.
