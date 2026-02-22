---
name: manage-agents
description: Use Agentloom to find, create, import, update, sync, and delete agents, commands, skills, and MCP servers.
---

# Manage Agentloom Resources

Use this skill for end-to-end Agentloom management across agents, commands, skills, and MCP servers.

## When to Use

Use this when the user asks to:

- find an existing agent/command/skill/MCP server
- import resources from a source repo
- create new local resources from scratch
- update tracked imports
- sync resources to provider outputs
- delete imported sources or entities
- add/remove manual MCP server entries

## Canonical Layout

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
```

## Core Commands

- Aggregate: `agentloom add|find|update|sync|delete`
- Entity scoped: `agentloom agent|command|skill|mcp <add|list|delete|find|update|sync>`
- Manual MCP server mode: `agentloom mcp server add|list|delete`

Common selectors/flags:

- `--agents`, `--commands`, `--skills`, `--mcps`
- `--selection-mode <all|sync-all|custom>`
- `--subdir <path>`
- `--local` / `--global`
- `--yes`

## Workflow

### 1) Capture intent

Extract:

1. target entity type(s): `agent`, `command`, `skill`, `mcp`
2. task/domain keywords
3. source preference (GitHub slug, git URL, local path)
4. scope preference (local/global)
5. whether install should stay pinned (`custom`) or follow upstream (`all`)

### 2) Discover candidates

Run either aggregate or entity-specific find:

```bash
agentloom find <query>
agentloom agent find <query>
agentloom command find <query>
agentloom skill find <query>
agentloom mcp find <query>
```

### 3) Import the chosen resources

Use aggregate add for mixed imports:

```bash
agentloom add <source>
```

Use entity-scoped add when the user wants explicit selection:

```bash
agentloom agent add <source> --agents <csv>
agentloom command add <source> --commands <csv>
agentloom skill add <source> --skills <csv>
agentloom mcp add <source> --mcps <csv>
```

### 4) Create from scratch when needed

Create canonical files directly:

- Agent: `.agents/agents/<name>.md`
- Command: `.agents/commands/<name>.md`
- Skill: `.agents/skills/<skill-name>/SKILL.md`
- MCP: `.agents/mcp.json`

Agent template:

```md
---
name: pr-reviewer
description: Reviews pull request diffs and reports concrete issues.
claude:
  model: sonnet
codex:
  model: gpt-5.3-codex
  reasoningEffort: low
  webSearch: true
---

You are a strict PR reviewer.
Focus on correctness, regressions, and missing tests.
Return findings with file references and concrete fixes.
```

Minimal command template:

```md
Review the current branch diff and report bugs, regressions, and missing tests.
```

Minimal skill template:

```md
---
name: release-check
description: Validate release readiness before publishing.
---

# Release Check

Run focused validation and report blockers with exact fix commands.
```

Minimal MCP template:

```json
{
  "version": 1,
  "mcpServers": {
    "browser": {
      "base": {
        "command": "npx",
        "args": ["browser-tools-mcp"]
      }
    }
  }
}
```

### 5) Sync provider outputs

After create/import/update/delete, sync generated provider files:

```bash
agentloom sync
```

Optional provider targeting:

```bash
agentloom sync --providers cursor,claude,codex,opencode,gemini,copilot
```

### 6) Update and cleanup

Refresh tracked imports:

```bash
agentloom update [source]
agentloom agent update [source]
agentloom command update [source]
agentloom skill update [source]
agentloom mcp update [source]
```

Remove stale entries:

```bash
agentloom delete <source|name>
agentloom agent delete <source|name>
agentloom command delete <source|name>
agentloom skill delete <source|name>
agentloom mcp delete <source|name>
agentloom mcp server delete <name>
```

## Response Contract

When using this skill, always provide:

1. exact commands to run
2. exact file path(s) to create/edit when authoring from scratch
3. sync command required after changes
4. concrete next step (find, import, create, update, sync, or delete)
