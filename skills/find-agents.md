---
name: find-agents
description: Helps users discover shared agents from external repositories and import them with agentloom.
---

# Find Agents

Use this skill when a user asks for an existing agent they can install from a shared repository.

## When to Use

Use this when the user:

- asks "is there an agent for X?"
- wants reusable agents instead of writing one from scratch
- asks to discover community/shared agents

## Commands

- `agentloom find <query>` searches shared repositories for matching agents
- `agentloom add <owner/repo> [--subdir <path>]` imports agents from that repository

## Workflow

### 1) Capture the intent

Extract:

1. domain (frontend, testing, CI/CD, security, docs)
2. task (reviewing PRs, writing tests, deployment, refactors)
3. query keywords

### 2) Search for agents

Run:

```bash
agentloom find <query>
```

Examples:

- `agentloom find reviewer`
- `agentloom find react performance`
- `agentloom find ci deploy`

### 3) Recommend best matches

For each recommended match, provide:

1. repo + agent name
2. short rationale
3. concrete import command

Example:

```text
I found one that matches your request:
acme/frontend-agents@react-reviewer

Install:
agentloom add acme/frontend-agents --subdir agents
```

### 4) Import on request

Import the selected repository:

```bash
agentloom add <owner/repo> [--subdir <path>] -y
```

Use `-y` when the user wants non-interactive conflict handling.

## If No Match

If no useful result is found:

1. state that no shared agent matched the query
2. offer to implement the task directly
3. optionally suggest creating a new local agent in `.agents/agents/`
