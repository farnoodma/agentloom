# agentloom

`agentloom` is a monorepo with:

- `packages/cli`: the published `agentloom` CLI
- `apps/web`: the Agentloom public directory web app
- website: [agentloom.sh](https://agentloom.sh)

## Install CLI

```bash
npm i -g agentloom
# or
npx agentloom --help
```

## Monorepo layout

```text
packages/
  cli/      # npm package: agentloom
apps/
  web/      # Next.js directory + telemetry ingest API
```

## CLI overview

The CLI manages canonical `.agents` config and syncs provider-native outputs for:

- Cursor
- Claude
- Codex
- OpenCode
- Gemini
- Copilot

Canonical local layout:

```text
.agents/
  agents/
  commands/
  skills/
  mcp.json
  agents.lock.json
  settings.local.json
```

### Key commands

```bash
agentloom init [--local|--global] [--providers <csv>] [--yes] [--no-sync] [--dry-run]
agentloom sync [--local|--global] [--providers <csv>] [--yes] [--dry-run]
agentloom <agent|command|mcp|skill> sync [--local|--global] [--providers <csv>] [--yes] [--dry-run]
```

- `init`: bootstraps canonical `.agents` files, migrates provider state into canonical files, and syncs provider outputs by default.
- `sync`: runs provider-to-canonical migration as a pre-step, then generates provider outputs.
- conflict handling during migration:
  - interactive sessions prompt for conflict resolution.
  - non-interactive sessions (or `--yes`) fail fast with actionable conflict output and exit code `2`.

## Telemetry

Successful GitHub-based `agentloom add` imports can send anonymous install telemetry to the Agentloom directory API.

- tracked: agents, skills, commands, and MCP servers from GitHub sources
- not tracked: local-path adds
- opt out: `AGENTLOOM_DISABLE_TELEMETRY=1`
- override endpoint: `AGENTLOOM_TELEMETRY_ENDPOINT=https://...`

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

Run CLI from source:

```bash
pnpm --filter agentloom dev -- --help
```

Run web app:

```bash
pnpm --filter @agentloom/web dev
```

## Release and deploy

- preview web deploys: on `push` to `main` (`.github/workflows/preview-deploy.yml`)
- production web deploy + npm publish: on GitHub `release.published` (`.github/workflows/release.yml`)
- stable tags only: `vX.Y.Z`
- release tag must match `packages/cli/package.json` version
- Vercel auth in workflows: OIDC (no long-lived `VERCEL_TOKEN` GitHub secret required)

Required Vercel env vars:

- `DATABASE_URL`
- `TELEMETRY_HASH_SALT`

## License

MIT
