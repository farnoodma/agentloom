import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";
import { buildScopePaths } from "../../src/core/scope.js";
import { syncFromCanonical } from "../../src/sync/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("command sync", () => {
  it("syncs canonical commands to all providers", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const commandsDir = path.join(workspaceRoot, ".agents", "commands");
    ensureDir(commandsDir);
    writeTextAtomic(
      path.join(commandsDir, "review.md"),
      `# /review\n\nReview active changes.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);

    await syncFromCanonical({
      paths,
      providers: ["cursor", "claude", "codex", "opencode", "gemini", "copilot"],
      yes: true,
      nonInteractive: true,
    });

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".cursor", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".claude", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(homeDir, ".codex", "prompts", "review.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".opencode", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".gemini", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".github", "prompts", "review.prompt.md"),
      ),
    ).toBe(true);
  });

  it("removes stale command outputs when legacy manifest lacks generatedByEntity", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const commandsDir = path.join(workspaceRoot, ".agents", "commands");
    ensureDir(commandsDir);
    writeTextAtomic(
      path.join(commandsDir, "review.md"),
      `# /review\n\nReview active changes.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);

    await syncFromCanonical({
      paths,
      providers: ["cursor", "claude", "codex", "opencode", "gemini", "copilot"],
      yes: true,
      nonInteractive: true,
    });

    const manifestPath = path.join(
      workspaceRoot,
      ".agents",
      ".sync-manifest.json",
    );
    const legacyManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as {
      generatedByEntity?: unknown;
      [key: string]: unknown;
    };
    delete legacyManifest.generatedByEntity;
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(legacyManifest, null, 2)}\n`,
    );

    fs.unlinkSync(path.join(commandsDir, "review.md"));

    await syncFromCanonical({
      paths,
      providers: ["cursor", "claude", "codex", "opencode", "gemini", "copilot"],
      yes: true,
      nonInteractive: true,
      target: "command",
    });

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".cursor", "commands", "review.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".claude", "commands", "review.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(homeDir, ".codex", "prompts", "review.md")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".opencode", "commands", "review.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".gemini", "commands", "review.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".github", "prompts", "review.prompt.md"),
      ),
    ).toBe(false);

    const migratedManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as {
      generatedByEntity?: {
        agent?: string[];
        command?: string[];
        mcp?: string[];
      };
    };
    const commandEntries = migratedManifest.generatedByEntity?.command ?? [];
    const agentEntries = migratedManifest.generatedByEntity?.agent ?? [];
    const mcpEntries = migratedManifest.generatedByEntity?.mcp ?? [];

    expect(commandEntries).toEqual([]);
    expect(
      agentEntries.some((filePath) => filePath.endsWith("/review.md")),
    ).toBe(false);
    expect(mcpEntries.some((filePath) => filePath.endsWith("/review.md"))).toBe(
      false,
    );
  });

  it("applies copilot prompt frontmatter from provider-specific command config", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const commandsDir = path.join(workspaceRoot, ".agents", "commands");
    ensureDir(commandsDir);
    writeTextAtomic(
      path.join(commandsDir, "review.md"),
      `---
description: Default description
mode: ask
copilot:
  mode: edit
  tools:
    - changes
    - codebase
  model: gpt-5
  argument-hint: "<scope>"
  custom-setting: keep
---

# /review

Review active changes with scope \${input:args}.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["copilot", "cursor"],
      yes: true,
      nonInteractive: true,
      target: "command",
    });

    const copilotPrompt = fs.readFileSync(
      path.join(workspaceRoot, ".github", "prompts", "review.prompt.md"),
      "utf8",
    );
    expect(copilotPrompt).toContain("mode: edit");
    expect(copilotPrompt).toContain("model: gpt-5");
    expect(copilotPrompt).toContain("argument-hint: <scope>");
    expect(copilotPrompt).toContain("custom-setting: keep");
    expect(copilotPrompt).toContain("- changes");
    expect(copilotPrompt).toContain(
      "Review active changes with scope ${input:args}.",
    );

    const cursorPrompt = fs.readFileSync(
      path.join(workspaceRoot, ".cursor", "commands", "review.md"),
      "utf8",
    );
    expect(cursorPrompt.startsWith("---")).toBe(true);
    expect(cursorPrompt).toContain("description: Default description");
    expect(cursorPrompt).toContain("mode: ask");
    expect(cursorPrompt).not.toContain("copilot:");
    expect(cursorPrompt).not.toContain("model: gpt-5");
    expect(cursorPrompt).not.toContain("custom-setting: keep");
    expect(cursorPrompt).toContain(
      "Review active changes with scope ${input:args}.",
    );
  });

  it("skips provider outputs when command frontmatter disables that provider", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const commandsDir = path.join(workspaceRoot, ".agents", "commands");
    ensureDir(commandsDir);
    writeTextAtomic(
      path.join(commandsDir, "review.md"),
      `---
copilot: false
---

# /review

Review active changes.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["copilot", "cursor"],
      yes: true,
      nonInteractive: true,
      target: "command",
    });

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".github", "prompts", "review.prompt.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".cursor", "commands", "review.md"),
      ),
    ).toBe(true);
  });

  it("normalizes legacy copilot command argument placeholders", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    const commandsDir = path.join(workspaceRoot, ".agents", "commands");
    ensureDir(commandsDir);
    writeTextAtomic(
      path.join(commandsDir, "review.md"),
      `# /review

Review active changes with scope $ARGUMENTS.
`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["copilot"],
      yes: true,
      nonInteractive: true,
      target: "command",
    });

    const copilotPrompt = fs.readFileSync(
      path.join(workspaceRoot, ".github", "prompts", "review.prompt.md"),
      "utf8",
    );
    expect(copilotPrompt).toContain("${input:args}");
    expect(copilotPrompt).not.toContain("$ARGUMENTS");
  });
});
