import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "getting-started", label: "Getting Started" },
  { id: "canonical-layout", label: "Canonical Layout" },
  { id: "commands", label: "Commands" },
  { id: "agent-schema", label: "Agent Schema" },
  { id: "command-schema", label: "Command Schema" },
  { id: "mcp-schema", label: "MCP Schema" },
  { id: "providers", label: "Providers" },
  { id: "telemetry", label: "Telemetry" },
  { id: "directory", label: "Directory" },
  { id: "scope-resolution", label: "Scope Resolution" },
  { id: "env-vars", label: "Environment Variables" },
] as const;

function CodeBlock({ children, command }: { children: string; command?: boolean }) {
  return (
    <div className="relative rounded-xl border border-ink/10 bg-chalk/80 p-4 card-grid dark:border-white/10 dark:bg-white/5">
      <div className="flex items-start justify-between gap-3">
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed text-ink md:text-sm dark:text-white">
          <code>{children}</code>
        </pre>
        {command && <CopyCommand command={children.replace(/^\$ /, "")} />}
      </div>
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-xl font-semibold md:text-2xl">
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-semibold">{children}</h3>;
}

function Prose({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink/80 md:text-base dark:text-white/80">{children}</p>;
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[0.85em] dark:bg-white/10">{children}</code>
  );
}

export default function DocsPage() {
  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="rounded-2xl border border-ink/10 bg-white/75 p-6 shadow-card backdrop-blur md:p-10 dark:border-white/10 dark:bg-black/35">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60 dark:text-white/60">
          Documentation
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
          Write your agents once.<br />Use them everywhere.
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-ink/70 md:text-base dark:text-white/70">
          Agentloom is a CLI that unifies agent, skill, command, and MCP server
          definitions across Cursor, Claude, Copilot, Codex, OpenCode, Gemini, and Pi.
          No more copy-pasting prompts between seven different config formats.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="text-sm text-ink/60 underline underline-offset-4 transition hover:text-ink dark:text-white/60 dark:hover:text-white"
          >
            ← Back to directory
          </Link>
        </div>
      </header>

      {/* Main content area with sidebar */}
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Sidebar nav */}
        <nav className="hidden lg:block">
          <div className="sticky top-20 space-y-1 rounded-2xl border border-ink/10 bg-white p-4 shadow-card dark:border-white/10 dark:bg-black/30">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 dark:text-white/50">
              On this page
            </p>
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="block rounded-lg px-3 py-1.5 text-sm text-ink/70 transition hover:bg-ink/5 hover:text-ink dark:text-white/70 dark:hover:bg-white/5 dark:hover:text-white"
              >
                {section.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Content */}
        <div className="min-w-0 space-y-8">
          {/* Overview */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="overview">Overview</SectionHeading>
            <Prose>
              If you use more than one AI coding tool, you know the friction.
              Cursor wants <InlineCode>.cursor/rules</InlineCode>, Claude wants <InlineCode>.claude/</InlineCode>,
              Copilot wants <InlineCode>.github/copilot-instructions.md</InlineCode> — and none of them
              talk to each other. You end up maintaining six copies of the same agent prompt.
            </Prose>
            <Prose>
              Agentloom gives you a single <InlineCode>.agents/</InlineCode> directory where you define
              everything once in plain markdown and JSON. Run <InlineCode>agentloom sync</InlineCode> and
              your definitions are written to every tool in its native format. Switch tools,
              share agents with your team, import from GitHub — all without lock-in.
            </Prose>
          </section>

          {/* Getting Started */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="getting-started">Getting Started</SectionHeading>
            <Prose>
              One command to initialize. Agentloom detects your existing provider configs,
              migrates them into the canonical format, and syncs everything back out.
            </Prose>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink/60 dark:text-white/60">
                Initialize your project
              </p>
              <CodeBlock command>$ npx agentloom init</CodeBlock>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink/60 dark:text-white/60">
                Import agents from GitHub
              </p>
              <CodeBlock command>$ npx agentloom add farnoodma/agents</CodeBlock>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink/60 dark:text-white/60">
                Re-sync after manual edits
              </p>
              <CodeBlock command>$ npx agentloom sync</CodeBlock>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink/60 dark:text-white/60">
                Install globally (optional)
              </p>
              <CodeBlock command>$ npm i -g agentloom</CodeBlock>
            </div>
          </section>

          {/* Canonical Layout */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="canonical-layout">Canonical Layout</SectionHeading>
            <Prose>
              All definitions live in a <InlineCode>.agents/</InlineCode> directory.
              Version-controlled, diffable, reviewable. Global scope uses <InlineCode>~/.agents</InlineCode> with
              the same structure.
            </Prose>

            <CodeBlock>{`.agents/
  agents/
    reviewer.md           # Agent definitions (markdown + YAML frontmatter)
    debugger.md
  commands/
    review.md             # Command prompts
    ship.md
  skills/
    reviewing/
      SKILL.md            # Skill entry point
      references/         # Supporting files
      assets/
    debugging/
      SKILL.md
  mcp.json                # MCP server configurations
  agents.lock.json        # Lock file for synced sources
  settings.local.json     # Local overrides (gitignored)`}</CodeBlock>

            <Prose>
              Source path resolution is additive and priority-ordered, so
              Agentloom can import repositories that use different directory conventions:
              for agents it checks <InlineCode>.agents/agents</InlineCode> then <InlineCode>agents/</InlineCode>,
              for commands <InlineCode>.agents/commands</InlineCode> then <InlineCode>commands/</InlineCode> then <InlineCode>prompts/</InlineCode>,
              for skills <InlineCode>.agents/skills</InlineCode> then <InlineCode>skills/</InlineCode> then a
              root <InlineCode>SKILL.md</InlineCode> fallback.
            </Prose>
          </section>

          {/* Commands */}
          <section className="space-y-5 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="commands">Commands</SectionHeading>

            <div className="space-y-3">
              <SubHeading>Aggregate verbs</SubHeading>
              <Prose>
                These operate across all entity types at once.
              </Prose>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-left dark:border-white/10">
                      <th className="py-2 pr-4 font-medium text-ink/70 dark:text-white/70">Command</th>
                      <th className="py-2 font-medium text-ink/70 dark:text-white/70">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink/80 dark:text-white/80">
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>agentloom add &lt;source&gt;</InlineCode></td>
                      <td className="py-2">Import agents, commands, skills, and MCP servers from a source</td>
                    </tr>
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>agentloom find &lt;query&gt;</InlineCode></td>
                      <td className="py-2">Search for entities across the ecosystem</td>
                    </tr>
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>agentloom update [source]</InlineCode></td>
                      <td className="py-2">Update previously imported sources</td>
                    </tr>
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>agentloom upgrade</InlineCode></td>
                      <td className="py-2">Check and install the latest CLI release</td>
                    </tr>
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>agentloom sync</InlineCode></td>
                      <td className="py-2">Sync canonical definitions to all provider configs</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4"><InlineCode>agentloom delete &lt;source|name&gt;</InlineCode></td>
                      <td className="py-2">Remove imported entities</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3">
              <SubHeading>Entity verbs</SubHeading>
              <Prose>
                Fine-grained control over specific entity types.
              </Prose>
              <CodeBlock>{`agentloom agent <add|list|delete|find|update|sync>
agentloom command <add|list|delete|find|update|sync>
agentloom mcp <add|list|delete|find|update|sync>
agentloom skill <add|list|delete|find|update|sync>`}</CodeBlock>
            </div>

            <div className="space-y-3">
              <SubHeading>Selector flags</SubHeading>
              <Prose>
                Filter which entities a command operates on.
              </Prose>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-left dark:border-white/10">
                      <th className="py-2 pr-4 font-medium text-ink/70 dark:text-white/70">Flag</th>
                      <th className="py-2 font-medium text-ink/70 dark:text-white/70">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink/80 dark:text-white/80">
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>--agents &lt;csv&gt;</InlineCode></td>
                      <td className="py-2">Select specific agents by name</td>
                    </tr>
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>--commands &lt;csv&gt;</InlineCode></td>
                      <td className="py-2">Select specific commands</td>
                    </tr>
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>--mcps &lt;csv&gt;</InlineCode></td>
                      <td className="py-2">Select specific MCP servers</td>
                    </tr>
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>--skills &lt;csv&gt;</InlineCode></td>
                      <td className="py-2">Select specific skills</td>
                    </tr>
                    <tr className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4"><InlineCode>--selection-mode</InlineCode></td>
                      <td className="py-2"><InlineCode>all</InlineCode>, <InlineCode>sync-all</InlineCode>, or <InlineCode>custom</InlineCode></td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4"><InlineCode>--source &lt;value&gt;</InlineCode></td>
                      <td className="py-2">Filter by source origin</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3">
              <SubHeading>MCP manual server management</SubHeading>
              <Prose>
                Manage MCP servers directly without importing from a source.
              </Prose>
              <CodeBlock>{`# Add a server by command
$ agentloom mcp server add browser-tools --command npx --arg browser-tools-mcp

# Add a server by URL
$ agentloom mcp server add my-server --url https://example.com/mcp

# List configured servers
$ agentloom mcp server list

# Remove a server
$ agentloom mcp server delete browser-tools`}</CodeBlock>
            </div>

            <div className="space-y-3">
              <SubHeading>Examples</SubHeading>
              <CodeBlock>{`# Import everything from a repo
$ agentloom add farnoodma/agents

# Import only a specific agent
$ agentloom agent add farnoodma/agents --agents issue-creator

# Import a specific command
$ agentloom command add farnoodma/agents --commands review

# Import a specific MCP server
$ agentloom mcp add farnoodma/agents --mcps browser

# Import a specific skill
$ agentloom skill add farnoodma/agents --skills pr-review

# Remove everything from a source
$ agentloom delete farnoodma/agents`}</CodeBlock>
            </div>
          </section>

          {/* Agent Schema */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="agent-schema">Agent Schema</SectionHeading>
            <Prose>
              Agents are markdown files with YAML frontmatter.
              Use the frontmatter for metadata and provider-specific overrides.
              The body is your agent&apos;s system prompt.
            </Prose>

            <CodeBlock>{`---
name: code-reviewer
description: Review changes and report issues.
claude:
  model: sonnet
codex:
  model: gpt-5.3-codex
  reasoningEffort: low
  webSearch: true
---

You are a strict code reviewer. Check for:
- Security vulnerabilities
- Performance issues
- Naming conventions
- Missing error handling`}</CodeBlock>

            <Prose>
              Provider-specific blocks (<InlineCode>claude:</InlineCode>, <InlineCode>codex:</InlineCode>, etc.)
              let you tune model, reasoning effort, and other settings per tool without duplicating the prompt.
            </Prose>
          </section>

          {/* Command Schema */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="command-schema">Command Schema</SectionHeading>
            <Prose>
              Canonical commands are markdown files. Frontmatter is optional. When present,
              provider-specific command config can be nested per provider.
            </Prose>

            <CodeBlock>{`---
copilot:
  description: Review current changes
  agent: agent
  tools:
    - codebase
  model: gpt-5
  argument-hint: "<scope>"
---

# /review

Review active changes with scope \${input:args}.`}</CodeBlock>

            <ul className="space-y-2 pl-5 text-sm text-ink/80 dark:text-white/80">
              <li className="list-disc">
                Provider configs follow the same pattern as agents.
              </li>
              <li className="list-disc">
                Omit a provider key for default behavior, add <InlineCode>provider: {"{ ... }"}</InlineCode> for
                provider-specific overrides, or set <InlineCode>provider: false</InlineCode> to disable output for a provider.
              </li>
              <li className="list-disc">
                Provider-specific frontmatter keys are passed through as-is to provider outputs.
              </li>
              <li className="list-disc">
                Canonical command bodies can use <InlineCode>$ARGUMENTS</InlineCode>; provider-specific placeholder
                translation is applied during sync (for example, Copilot receives <InlineCode>${"${input:args}"}</InlineCode>).
              </li>
            </ul>
          </section>

          {/* MCP Schema */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="mcp-schema">MCP Schema</SectionHeading>
            <Prose>
              MCP servers are defined in <InlineCode>mcp.json</InlineCode>.
              Each server has a <InlineCode>base</InlineCode> configuration and optional
              per-provider overrides. Set a provider to <InlineCode>false</InlineCode> to
              exclude a server from that tool.
            </Prose>

            <CodeBlock>{`{
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
}`}</CodeBlock>
          </section>

          {/* Providers */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="providers">Supported Providers</SectionHeading>
            <Prose>
              Agentloom syncs your definitions to every major AI coding tool.
              Full support across all entity types.
            </Prose>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left dark:border-white/10">
                    <th className="py-2 pr-4 font-medium text-ink/70 dark:text-white/70">Provider</th>
                    <th className="py-2 pr-4 text-center font-medium text-ink/70 dark:text-white/70">Agents</th>
                    <th className="py-2 pr-4 text-center font-medium text-ink/70 dark:text-white/70">Commands</th>
                    <th className="py-2 pr-4 text-center font-medium text-ink/70 dark:text-white/70">Skills</th>
                    <th className="py-2 text-center font-medium text-ink/70 dark:text-white/70">MCP</th>
                  </tr>
                </thead>
                <tbody className="text-ink/80 dark:text-white/80">
                  {["Cursor", "Claude", "Copilot", "Codex", "OpenCode", "Gemini", "Pi"].map((provider) => (
                    <tr key={provider} className="border-b border-ink/5 dark:border-white/5">
                      <td className="py-2 pr-4 font-medium">{provider}</td>
                      <td className="py-2 pr-4 text-center text-ocean">✓</td>
                      <td className="py-2 pr-4 text-center text-ocean">✓</td>
                      <td className="py-2 pr-4 text-center text-ocean">✓</td>
                      <td className="py-2 text-center text-ocean">✓</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Prose>
              For Codex, <InlineCode>agentloom sync</InlineCode> writes role-based multi-agent config
              following official Codex multi-agent guidance. Codex commands are always written to
              global prompts under <InlineCode>~/.codex/prompts</InlineCode>.
            </Prose>
          </section>

          {/* Telemetry */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="telemetry">Telemetry</SectionHeading>
            <Prose>
              Successful GitHub-based imports send anonymous telemetry to power the
              public directory and leaderboard. No personal data is collected.
            </Prose>

            <ul className="space-y-2 pl-5 text-sm text-ink/80 dark:text-white/80">
              <li className="list-disc">Only GitHub sources are tracked — local path imports are never sent.</li>
              <li className="list-disc">Tracked entities: agents, skills, commands, and MCP servers.</li>
              <li className="list-disc">
                Opt out: <InlineCode>AGENTLOOM_DISABLE_TELEMETRY=1</InlineCode>
              </li>
              <li className="list-disc">
                Override endpoint: <InlineCode>AGENTLOOM_TELEMETRY_ENDPOINT=https://...</InlineCode>
              </li>
            </ul>
          </section>

          {/* Directory */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="directory">Directory</SectionHeading>
            <Prose>
              The{" "}
              <Link href="/" className="text-ocean underline underline-offset-4 hover:text-ocean/80">
                Agentloom Directory
              </Link>{" "}
              surfaces the most popular agents, skills, commands, and MCP servers the community
              is importing. Browse trending setups, discover what other teams are using,
              and add anything to your project in one command.
            </Prose>
          </section>

          {/* Scope & Config */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="scope-resolution">Scope Resolution</SectionHeading>
            <Prose>
              Agentloom supports both local (project) and global (user) scopes.
            </Prose>
            <ul className="space-y-2 pl-5 text-sm text-ink/80 dark:text-white/80">
              <li className="list-disc">
                If <InlineCode>.agents/</InlineCode> exists in the current directory, you&apos;ll be prompted to choose scope.
              </li>
              <li className="list-disc">
                In non-interactive mode, local scope is selected when <InlineCode>.agents/</InlineCode> exists.
              </li>
              <li className="list-disc">
                Otherwise global scope (<InlineCode>~/.agents</InlineCode>) is used.
              </li>
              <li className="list-disc">
                Force scope with <InlineCode>--local</InlineCode> or <InlineCode>--global</InlineCode>.
              </li>
            </ul>
          </section>

          {/* Environment Variables */}
          <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
            <SectionHeading id="env-vars">Environment Variables</SectionHeading>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left dark:border-white/10">
                    <th className="py-2 pr-4 font-medium text-ink/70 dark:text-white/70">Variable</th>
                    <th className="py-2 font-medium text-ink/70 dark:text-white/70">Effect</th>
                  </tr>
                </thead>
                <tbody className="text-ink/80 dark:text-white/80">
                  <tr className="border-b border-ink/5 dark:border-white/5">
                    <td className="py-2 pr-4"><InlineCode>AGENTLOOM_DISABLE_TELEMETRY=1</InlineCode></td>
                    <td className="py-2">Disable anonymous telemetry</td>
                  </tr>
                  <tr className="border-b border-ink/5 dark:border-white/5">
                    <td className="py-2 pr-4"><InlineCode>AGENTLOOM_TELEMETRY_ENDPOINT</InlineCode></td>
                    <td className="py-2">Override the telemetry endpoint URL</td>
                  </tr>
                  <tr className="border-b border-ink/5 dark:border-white/5">
                    <td className="py-2 pr-4"><InlineCode>AGENTLOOM_DISABLE_UPDATE_NOTIFIER=1</InlineCode></td>
                    <td className="py-2">Disable auto-upgrade checks</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4"><InlineCode>AGENTLOOM_DISABLE_MANAGE_AGENTS_PROMPT=1</InlineCode></td>
                    <td className="py-2">Disable the manage-agents skill bootstrap prompt</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Back link */}
          <div className="pb-4 text-sm text-ink/60 dark:text-white/60">
            <Link href="/" className="underline underline-offset-4 transition hover:text-ink dark:hover:text-white">
              ← Back to directory
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
