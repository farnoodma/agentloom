# agentloom

**Write your agents once. Use them everywhere.**

If you're juggling Cursor, Claude, Copilot, Codex, Gemini, and OpenCode — you know the pain. Each tool has its own config format, its own folder structure, its own way of defining agents, commands, and MCP servers. You end up copy-pasting prompts, maintaining six versions of the same agent, and losing track of what's where.

Agentloom fixes that. You define your agents, commands, skills, and MCP servers once in a single `.agents/` directory, and agentloom syncs them to every tool you use.

```bash
npx agentloom init
```

That's it. Agentloom detects your existing provider configs, migrates them into a unified canonical format, and syncs everything back out. Your agents now work across all your tools.

## What you get

- **One source of truth** — a `.agents/` directory with your agents, commands, skills, and MCP configs in plain markdown and JSON. Version-controlled, diffable, reviewable.
- **Instant sync** — run `agentloom sync` and your definitions flow to Cursor, Claude, Copilot, Codex, OpenCode, and Gemini in their native formats.
- **Import from anywhere** — `agentloom add user/repo` pulls agents and skills from GitHub repos. Share your best setups with your team or the community.
- **No lock-in** — switch tools tomorrow and your agents come with you.

## Quick start

```bash
# initialize and sync to your tools
npx agentloom init

# import agents from a GitHub repo (syncs automatically)
npx agentloom add farnoodma/agents

# re-sync after manual edits to .agents/
npx agentloom sync
```

## Documentation

For full CLI usage, commands, schemas, and configuration details, see the [CLI documentation](packages/cli/README.md).

## Supported providers

| Provider | Agents | Commands | Skills | MCP |
|----------|--------|----------|--------|-----|
| Cursor   |   +    |    +     |   +    |  +  |
| Claude   |   +    |    +     |   +    |  +  |
| Copilot  |   +    |    +     |   +    |  +  |
| Codex    |   +    |    +     |   +    |  +  |
| OpenCode |   +    |    +     |   +    |  +  |
| Gemini   |   +    |    +     |   +    |  +  |

## Directory

Browse and discover community agents, skills, and MCP configs at [agentloom.sh](https://agentloom.sh).

## Monorepo layout

```text
packages/
  cli/      # npm package: agentloom
apps/
  web/      # Next.js directory + telemetry ingest API
```

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
