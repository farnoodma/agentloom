import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildScopePaths } from "../../src/core/scope.js";
import {
  MigrationConflictError,
  initializeCanonicalLayout,
  migrateProviderStateToCanonical,
} from "../../src/core/migration.js";
import { parseAgentsDir } from "../../src/core/agents.js";
import { parseCommandContent } from "../../src/core/commands.js";
import {
  ensureDir,
  writeJsonAtomic,
  writeTextAtomic,
} from "../../src/core/fs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createPaths() {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentloom-workspace-"),
  );
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
  tempDirs.push(workspaceRoot, homeDir);
  return buildScopePaths(workspaceRoot, "local", homeDir);
}

function createGlobalPaths() {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentloom-workspace-"),
  );
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
  tempDirs.push(workspaceRoot, homeDir);
  return buildScopePaths(workspaceRoot, "global", homeDir);
}

describe("canonical layout initialization", () => {
  it("creates canonical directories and baseline files", () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor", "codex"]);

    expect(fs.existsSync(paths.agentsDir)).toBe(true);
    expect(fs.existsSync(paths.commandsDir)).toBe(true);
    expect(fs.existsSync(paths.skillsDir)).toBe(true);
    expect(fs.existsSync(paths.mcpPath)).toBe(true);
    expect(fs.existsSync(paths.lockPath)).toBe(true);
    expect(fs.existsSync(paths.settingsPath)).toBe(true);
    expect(fs.existsSync(paths.manifestPath)).toBe(true);

    const settings = JSON.parse(
      fs.readFileSync(paths.settingsPath, "utf8"),
    ) as { lastScope?: string; defaultProviders?: string[] };
    expect(settings.lastScope).toBe("local");
    expect(settings.defaultProviders).toEqual(["cursor", "codex"]);
  });
});

describe("provider migration", () => {
  it("migrates cursor provider data into canonical files", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Reviews changes\nmodel: fast\n---\n\nReview all changed files.\n`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "review.prompt.md"),
      "# /review\n\nCheck the current diff.\n",
    );

    writeJsonAtomic(path.join(paths.workspaceRoot, ".cursor", "mcp.json"), {
      mcpServers: {
        browser: {
          command: "npx",
          args: ["browser-tools-mcp"],
        },
      },
    });

    ensureDir(
      path.join(paths.workspaceRoot, ".cursor", "skills", "release-check"),
    );
    writeTextAtomic(
      path.join(
        paths.workspaceRoot,
        ".cursor",
        "skills",
        "release-check",
        "SKILL.md",
      ),
      "# Release Check\n",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "all",
      nonInteractive: true,
    });

    expect(summary.entities.agent.imported).toBeGreaterThanOrEqual(1);
    expect(summary.entities.command.imported).toBeGreaterThanOrEqual(1);
    expect(summary.entities.mcp.imported).toBeGreaterThanOrEqual(1);
    expect(summary.entities.skill.imported).toBeGreaterThanOrEqual(1);

    const canonicalAgent = fs.readFileSync(
      path.join(paths.agentsDir, "reviewer.md"),
      "utf8",
    );
    expect(canonicalAgent).toContain("name: reviewer");
    expect(canonicalAgent).toContain("cursor:");
    expect(canonicalAgent).toContain("model: fast");

    expect(fs.existsSync(path.join(paths.commandsDir, "review.md"))).toBe(true);

    const canonicalMcp = JSON.parse(fs.readFileSync(paths.mcpPath, "utf8")) as {
      mcpServers?: Record<string, { base?: Record<string, unknown> }>;
    };
    expect(canonicalMcp.mcpServers?.browser?.base?.command).toBe("npx");

    expect(
      fs.existsSync(path.join(paths.skillsDir, "release-check", "SKILL.md")),
    ).toBe(true);
  });

  it("fails fast for canonical-vs-provider conflicts in non-interactive mode", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    writeTextAtomic(
      path.join(paths.commandsDir, "review.md"),
      "# /review\n\nCanonical content.\n",
    );

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "review.md"),
      "# /review\n\nProvider content.\n",
    );

    await expect(
      migrateProviderStateToCanonical({
        paths,
        providers: ["cursor"],
        target: "command",
        nonInteractive: true,
      }),
    ).rejects.toBeInstanceOf(MigrationConflictError);
  });

  it("ignores non-agent markdown files in provider agent directories", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
      `---
name: reviewer
description: Reviews changes
---

Review changed files and summarize findings.
`,
    );
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "README.md"),
      "Agent docs",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.detected).toBe(1);
    expect(summary.entities.agent.imported).toBe(1);
    expect(fs.readdirSync(paths.agentsDir)).toEqual(["reviewer.md"]);
  });

  it("migrates provider agents without explicit metadata using filename fallbacks", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
      "Review changed files and summarize findings.\n",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.detected).toBe(1);
    expect(summary.entities.agent.imported).toBe(1);

    const canonicalAgent = parseAgentsDir(paths.agentsDir)[0]!;
    expect(canonicalAgent.name).toBe("reviewer");
    expect(canonicalAgent.description).toBe("Migrated from cursor");
    expect(canonicalAgent.body).toContain(
      "Review changed files and summarize findings.",
    );
  });

  it("ignores non-prompt markdown files in copilot prompt directories", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["copilot"]);

    ensureDir(path.join(paths.workspaceRoot, ".github", "prompts"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".github", "prompts", "review.prompt.md"),
      "# /review\n\nReview active changes.\n",
    );
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".github", "prompts", "README.md"),
      "Prompt docs",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["copilot"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.detected).toBe(1);
    expect(summary.entities.command.imported).toBe(1);
    expect(fs.readdirSync(paths.commandsDir)).toEqual(["review.md"]);
  });

  it("ignores non-command markdown files in generic provider command directories", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "review.md"),
      "# /review\n\nReview active changes.\n",
    );
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "README.md"),
      "Command docs",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.detected).toBe(1);
    expect(summary.entities.command.imported).toBe(1);
    expect(fs.readdirSync(paths.commandsDir)).toEqual(["review.md"]);
  });

  it("does not conflict when canonical command metadata maps to provider-specific outputs", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor", "copilot"]);

    writeTextAtomic(
      path.join(paths.commandsDir, "review.md"),
      `---
copilot:
  description: Review command
  mode: ask
  tools:
    - codebase
---

# /review

Review active changes.
`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "review.md"),
      "# /review\n\nReview active changes.\n",
    );

    ensureDir(path.join(paths.workspaceRoot, ".github", "prompts"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".github", "prompts", "review.prompt.md"),
      `---
description: Review command
mode: ask
tools:
  - codebase
---

# /review

Review active changes.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor", "copilot"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.conflicts).toBe(0);
    expect(summary.entities.command.imported).toBe(0);
  });

  it("merges provider command configs into provider frontmatter", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor", "copilot"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "review.md"),
      `---
description: Cursor review command
mode: edit
tools:
  - changes
---

# /review

Review active changes.
`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".github", "prompts"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".github", "prompts", "review.prompt.md"),
      `---
description: Copilot review command
mode: ask
---

# /review

Review active changes.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor", "copilot"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.conflicts).toBe(0);
    expect(summary.entities.command.imported).toBe(1);

    const canonical = parseCommandContent(
      fs.readFileSync(path.join(paths.commandsDir, "review.md"), "utf8"),
    );
    expect(canonical.frontmatter?.description).toBe("Copilot review command");
    expect(canonical.frontmatter?.copilot).toEqual({
      mode: "ask",
    });
    expect(canonical.frontmatter?.cursor).toEqual({
      mode: "edit",
      tools: ["changes"],
      description: "Cursor review command",
    });
  });

  it("updates canonical command when metadata drifts but body matches", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor", "copilot"]);

    writeTextAtomic(
      path.join(paths.commandsDir, "review.md"),
      `---
description: Review command
copilot:
  mode: ask
---

# /review

Review active changes.
`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "commands", "review.md"),
      `---
description: Review command
mode: edit
---

# /review

Review active changes.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.conflicts).toBe(0);
    expect(summary.entities.command.imported).toBe(1);

    const canonical = parseCommandContent(
      fs.readFileSync(path.join(paths.commandsDir, "review.md"), "utf8"),
    );
    expect(canonical.frontmatter?.description).toBe("Review command");
    expect(canonical.frontmatter?.copilot).toEqual({
      mode: "ask",
    });
    expect(canonical.frontmatter?.cursor).toEqual({
      mode: "edit",
    });
  });

  it("preserves explicit provider disable for canonical command metadata", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["copilot"]);

    writeTextAtomic(
      path.join(paths.commandsDir, "review.md"),
      `---
copilot: false
---

# /review

Review active changes.
`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".github", "prompts"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".github", "prompts", "review.prompt.md"),
      "# /review\n\nReview active changes.\n",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["copilot"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.conflicts).toBe(0);
    expect(summary.entities.command.imported).toBe(0);

    const canonical = parseCommandContent(
      fs.readFileSync(path.join(paths.commandsDir, "review.md"), "utf8"),
    );
    expect(canonical.frontmatter?.copilot).toBe(false);
  });

  it("matches renamed canonical agent files by frontmatter name", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    writeTextAtomic(
      path.join(paths.agentsDir, "renamed-file.md"),
      `---
name: reviewer
description: Reviews changes
cursor: {}
---

Review changed files and summarize findings.
`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
      `---
name: reviewer
description: Reviews changes
---

Review changed files and summarize findings.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.conflicts).toBe(0);
    expect(summary.entities.agent.imported).toBe(0);
    expect(fs.readdirSync(paths.agentsDir).sort()).toEqual(["renamed-file.md"]);
  });

  it("prefers canonical name matching over filename-key collisions", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["copilot"]);

    const plannerPath = path.join(paths.agentsDir, "planner.md");
    const reviewerPath = path.join(paths.agentsDir, "reviewer.md");

    writeTextAtomic(
      plannerPath,
      `---
name: reviewer
description: Reviewer canonical
copilot: {}
---

Shared body.
`,
    );
    writeTextAtomic(
      reviewerPath,
      `---
name: writer
description: Writer canonical
copilot: {}
---

Shared body.
`,
    );

    const plannerBefore = fs.readFileSync(plannerPath, "utf8");

    ensureDir(path.join(paths.workspaceRoot, ".github", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".github", "agents", "reviewer.agent.md"),
      `---
name: writer
description: Writer provider description
tools:
  - changes
---

Shared body.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["copilot"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.conflicts).toBe(0);
    expect(summary.entities.agent.imported).toBe(1);

    const agentsByFile = new Map(
      parseAgentsDir(paths.agentsDir).map((agent) => [agent.fileName, agent]),
    );
    expect(fs.readFileSync(plannerPath, "utf8")).toBe(plannerBefore);
    expect(agentsByFile.get("reviewer.md")?.frontmatter.copilot).toEqual({
      tools: ["changes"],
      description: "Writer provider description",
    });
  });

  it("merges same logical agent across provider filename differences", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor", "copilot"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
      `---
name: reviewer
description: Cursor reviewer description
model: fast
---

Review changed files and summarize findings.
`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".github", "agents"));
    writeTextAtomic(
      path.join(
        paths.workspaceRoot,
        ".github",
        "agents",
        "code-review.agent.md",
      ),
      `---
name: reviewer
description: Copilot reviewer description
tools:
  - changes
---

Review changed files and summarize findings.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor", "copilot"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.detected).toBe(2);
    expect(summary.entities.agent.conflicts).toBe(0);
    expect(summary.entities.agent.imported).toBe(1);
    expect(fs.readdirSync(paths.agentsDir).sort()).toEqual(["reviewer.md"]);

    const canonicalAgent = parseAgentsDir(paths.agentsDir)[0]!;
    expect(canonicalAgent.name).toBe("reviewer");
    expect(canonicalAgent.description).toBe("Copilot reviewer description");
    expect(canonicalAgent.frontmatter.cursor).toEqual({
      model: "fast",
      description: "Cursor reviewer description",
    });
    expect(canonicalAgent.frontmatter.copilot).toEqual({
      tools: ["changes"],
    });
  });

  it("uses stable canonical filenames for merged agents across provider order", async () => {
    const runOrder = async (
      providers: ["cursor", "copilot"] | ["copilot", "cursor"],
    ) => {
      const paths = createPaths();
      initializeCanonicalLayout(paths, ["cursor", "copilot"]);

      ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
      writeTextAtomic(
        path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
        `---
name: reviewer
description: Cursor reviewer description
---

Review changed files and summarize findings.
`,
      );

      ensureDir(path.join(paths.workspaceRoot, ".github", "agents"));
      writeTextAtomic(
        path.join(
          paths.workspaceRoot,
          ".github",
          "agents",
          "code-review.agent.md",
        ),
        `---
name: reviewer
description: Copilot reviewer description
---

Review changed files and summarize findings.
`,
      );

      await migrateProviderStateToCanonical({
        paths,
        providers,
        target: "agent",
        nonInteractive: true,
      });

      return fs.readdirSync(paths.agentsDir).sort();
    };

    expect(await runOrder(["cursor", "copilot"])).toEqual(["reviewer.md"]);
    expect(await runOrder(["copilot", "cursor"])).toEqual(["reviewer.md"]);
  });

  it("captures provider-specific agent name and description overrides", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor", "copilot"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
      `---
name: Cursor Reviewer
description: Cursor reviewer description
model: fast
---

Review changed files and summarize findings.
`,
    );

    ensureDir(path.join(paths.workspaceRoot, ".github", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".github", "agents", "reviewer.agent.md"),
      `---
name: Copilot Reviewer
description: Copilot reviewer description
tools:
  - changes
---

Review changed files and summarize findings.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor", "copilot"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.conflicts).toBe(0);
    expect(summary.entities.agent.imported).toBe(1);

    const canonicalAgent = parseAgentsDir(paths.agentsDir)[0]!;
    expect(canonicalAgent.name).toBe("Copilot Reviewer");
    expect(canonicalAgent.description).toBe("Copilot reviewer description");
    expect(canonicalAgent.frontmatter.cursor).toEqual({
      model: "fast",
      name: "Cursor Reviewer",
      description: "Cursor reviewer description",
    });
    expect(canonicalAgent.frontmatter.copilot).toEqual({
      tools: ["changes"],
    });
  });

  it("prefers global .github copilot agents over legacy chatmodes duplicates", async () => {
    const paths = createGlobalPaths();
    initializeCanonicalLayout(paths, ["copilot"]);

    ensureDir(path.join(paths.homeDir, ".github", "agents"));
    writeTextAtomic(
      path.join(paths.homeDir, ".github", "agents", "reviewer.agent.md"),
      `---
name: reviewer
description: New global description
tools:
  - changes
---

Review changed files and summarize findings.
`,
    );

    ensureDir(path.join(paths.homeDir, ".vscode", "chatmodes"));
    writeTextAtomic(
      path.join(paths.homeDir, ".vscode", "chatmodes", "reviewer.agent.md"),
      `---
name: reviewer
description: Legacy description
model: legacy
---

Review changed files and summarize findings.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["copilot"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.conflicts).toBe(0);
    expect(summary.entities.agent.imported).toBe(1);

    const canonicalAgent = parseAgentsDir(paths.agentsDir)[0]!;
    expect(canonicalAgent.description).toBe("New global description");
    expect(canonicalAgent.frontmatter.copilot).toEqual({
      tools: ["changes"],
    });
  });

  it("uses legacy global copilot agents when .github agents are absent", async () => {
    const paths = createGlobalPaths();
    initializeCanonicalLayout(paths, ["copilot"]);

    ensureDir(path.join(paths.homeDir, ".vscode", "chatmodes"));
    writeTextAtomic(
      path.join(paths.homeDir, ".vscode", "chatmodes", "reviewer.agent.md"),
      `---
name: reviewer
description: Legacy description
model: legacy
---

Review changed files and summarize findings.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["copilot"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.detected).toBe(1);
    expect(summary.entities.agent.imported).toBe(1);

    const canonicalAgent = parseAgentsDir(paths.agentsDir)[0]!;
    expect(canonicalAgent.description).toBe("Legacy description");
    expect(canonicalAgent.frontmatter.copilot).toEqual({
      model: "legacy",
    });
  });

  it("ignores legacy global copilot agents when .github has importable agents", async () => {
    const paths = createGlobalPaths();
    initializeCanonicalLayout(paths, ["copilot"]);

    ensureDir(path.join(paths.homeDir, ".github", "agents"));
    writeTextAtomic(
      path.join(paths.homeDir, ".github", "agents", "reviewer.agent.md"),
      `---
name: reviewer
description: New global description
tools:
  - changes
---

Review changed files and summarize findings.
`,
    );

    ensureDir(path.join(paths.homeDir, ".vscode", "chatmodes"));
    writeTextAtomic(
      path.join(paths.homeDir, ".vscode", "chatmodes", "planner.agent.md"),
      `---
name: planner
description: Legacy planner description
model: legacy
---

Plan work.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["copilot"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.detected).toBe(1);
    expect(summary.entities.agent.imported).toBe(1);
    expect(fs.readdirSync(paths.agentsDir).sort()).toEqual(["reviewer.md"]);
  });

  it("deduplicates same-provider agent name collisions deterministically", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "alpha.md"),
      `---
name: reviewer
description: Colliding description
model: slow
---

Review changed files and summarize findings.
`,
    );
    writeTextAtomic(
      path.join(paths.workspaceRoot, ".cursor", "agents", "reviewer.md"),
      `---
name: reviewer
description: Preferred description
model: fast
---

Review changed files and summarize findings.
`,
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "agent",
      nonInteractive: true,
    });

    expect(summary.entities.agent.detected).toBe(1);
    expect(summary.entities.agent.imported).toBe(1);
    expect(fs.readdirSync(paths.agentsDir).sort()).toEqual(["reviewer.md"]);

    const canonicalAgent = parseAgentsDir(paths.agentsDir)[0]!;
    expect(canonicalAgent.description).toBe("Preferred description");
    expect(canonicalAgent.frontmatter.cursor).toEqual({
      model: "fast",
    });
  });

  it("keeps long agent descriptions on one line when migrating providers", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["cursor"]);

    const description =
      "Starts the application, performs auto-login, and reports back the ports and current URL. Use before testing changes in the browser. See application-debugging skill for browser tool guidance.";

    ensureDir(path.join(paths.workspaceRoot, ".cursor", "agents"));
    writeTextAtomic(
      path.join(
        paths.workspaceRoot,
        ".cursor",
        "agents",
        "application-runner.md",
      ),
      `---\nname: application-runner\ndescription: ${description}\nmodel: gpt-5.3-codex\n---\n\nStart services and report readiness.\n`,
    );

    await migrateProviderStateToCanonical({
      paths,
      providers: ["cursor"],
      target: "agent",
      nonInteractive: true,
    });

    const canonical = fs.readFileSync(
      path.join(paths.agentsDir, "application-runner.md"),
      "utf8",
    );
    expect(canonical).toContain(`description: ${description}`);
    expect(canonical).not.toContain(
      "description: Starts the application, performs auto-login, and reports back the\n",
    );
  });

  it("does not import global codex prompts into local canonical commands", async () => {
    const paths = createPaths();
    initializeCanonicalLayout(paths, ["codex"]);

    ensureDir(path.join(paths.homeDir, ".codex", "prompts"));
    writeTextAtomic(
      path.join(paths.homeDir, ".codex", "prompts", "execute-issue.md"),
      "# /execute-issue\n\nGlobal prompt content.\n",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["codex"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.detected).toBe(0);
    expect(summary.entities.command.imported).toBe(0);
    expect(
      fs.existsSync(path.join(paths.commandsDir, "execute-issue.md")),
    ).toBe(false);
  });

  it("imports codex prompts into canonical commands for global scope", async () => {
    const paths = createGlobalPaths();
    initializeCanonicalLayout(paths, ["codex"]);

    ensureDir(path.join(paths.homeDir, ".codex", "prompts"));
    writeTextAtomic(
      path.join(paths.homeDir, ".codex", "prompts", "review.md"),
      "# /review\n\nGlobal codex prompt.\n",
    );

    const summary = await migrateProviderStateToCanonical({
      paths,
      providers: ["codex"],
      target: "command",
      nonInteractive: true,
    });

    expect(summary.entities.command.detected).toBe(1);
    expect(summary.entities.command.imported).toBe(1);
    expect(fs.existsSync(path.join(paths.commandsDir, "review.md"))).toBe(true);
  });
});
