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

## Telemetry

Successful GitHub-based `agentloom add` imports can send anonymous install telemetry to the Agentloom directory API.

- tracked: agents, commands, and MCP servers from GitHub sources
- not tracked: local-path adds and skills
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
