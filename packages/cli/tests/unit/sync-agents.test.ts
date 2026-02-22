import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { buildScopePaths } from "../../src/core/scope.js";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";
import { syncFromCanonical } from "../../src/sync/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDirs() {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentloom-workspace-"),
  );
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
  tempDirs.push(workspaceRoot, homeDir);
  return { workspaceRoot, homeDir };
}

describe("cursor agent sync", () => {
  it("writes cursor agents to .cursor/agents/ not .cursor/rules/", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();

    const agentsDir = path.join(workspaceRoot, ".agents", "agents");
    ensureDir(agentsDir);
    writeTextAtomic(
      path.join(agentsDir, "reviewer.md"),
      `---\nname: reviewer\ndescription: Reviews code changes\n---\n\nReview the active diff carefully.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
    });

    // Must write to .cursor/agents/, not .cursor/rules/
    expect(
      fs.existsSync(path.join(workspaceRoot, ".cursor", "agents", "reviewer.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".cursor", "rules", "reviewer.mdc")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".cursor", "rules", "reviewer.md")),
    ).toBe(false);
  });

  it("writes cursor agents with .md extension not .mdc", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();

    const agentsDir = path.join(workspaceRoot, ".agents", "agents");
    ensureDir(agentsDir);
    writeTextAtomic(
      path.join(agentsDir, "my-agent.md"),
      `---\nname: my-agent\ndescription: A test agent\n---\n\nDo the thing.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
    });

    const agentPath = path.join(
      workspaceRoot,
      ".cursor",
      "agents",
      "my-agent.md",
    );
    expect(fs.existsSync(agentPath)).toBe(true);

    // .mdc must not exist anywhere
    const mdcPath = path.join(
      workspaceRoot,
      ".cursor",
      "agents",
      "my-agent.mdc",
    );
    expect(fs.existsSync(mdcPath)).toBe(false);
  });

  it("uses name+description frontmatter, not alwaysApply", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();

    const agentsDir = path.join(workspaceRoot, ".agents", "agents");
    ensureDir(agentsDir);
    writeTextAtomic(
      path.join(agentsDir, "planner.md"),
      `---\nname: planner\ndescription: Plans tasks step by step\n---\n\nBreak down the work into clear steps.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
    });

    const agentPath = path.join(
      workspaceRoot,
      ".cursor",
      "agents",
      "planner.md",
    );
    const content = fs.readFileSync(agentPath, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();

    const fm = YAML.parse(fmMatch![1]) as Record<string, unknown>;

    expect(fm.name).toBe("planner");
    expect(fm.description).toBe("Plans tasks step by step");
    // Must NOT use rules-style frontmatter fields
    expect(fm.alwaysApply).toBeUndefined();
    expect(fm.globs).toBeUndefined();
  });

  it("preserves body content in cursor agent files", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();

    const agentsDir = path.join(workspaceRoot, ".agents", "agents");
    ensureDir(agentsDir);
    writeTextAtomic(
      path.join(agentsDir, "writer.md"),
      `---\nname: writer\ndescription: Writes docs\n---\n\nYou are a technical writer. Be concise.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
    });

    const content = fs.readFileSync(
      path.join(workspaceRoot, ".cursor", "agents", "writer.md"),
      "utf8",
    );
    expect(content).toContain("You are a technical writer. Be concise.");
  });

  it("syncs cursor agents to global scope under ~/.cursor/agents/", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();

    const agentsDir = path.join(homeDir, ".agents", "agents");
    ensureDir(agentsDir);
    writeTextAtomic(
      path.join(agentsDir, "global-agent.md"),
      `---\nname: global-agent\ndescription: A global agent\n---\n\nHelp everywhere.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "global", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
    });

    expect(
      fs.existsSync(
        path.join(homeDir, ".cursor", "agents", "global-agent.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(homeDir, ".cursor", "rules", "global-agent.mdc"),
      ),
    ).toBe(false);
  });

  it("respects cursor-specific provider config in frontmatter", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();

    const agentsDir = path.join(workspaceRoot, ".agents", "agents");
    ensureDir(agentsDir);
    writeTextAtomic(
      path.join(agentsDir, "fast-agent.md"),
      `---\nname: fast-agent\ndescription: Uses fast model\ncursor:\n  model: fast\n---\n\nAnswer quickly.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
    });

    const content = fs.readFileSync(
      path.join(workspaceRoot, ".cursor", "agents", "fast-agent.md"),
      "utf8",
    );
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();

    const fm = YAML.parse(fmMatch![1]) as Record<string, unknown>;
    expect(fm.model).toBe("fast");
  });

  it("stale cursor agents in .cursor/rules/ are cleaned up after migration", async () => {
    const { workspaceRoot, homeDir } = makeTempDirs();

    // Simulate a legacy .cursor/rules/ file written by the old sync behaviour
    const legacyRulesDir = path.join(workspaceRoot, ".cursor", "rules");
    ensureDir(legacyRulesDir);
    const legacyFile = path.join(legacyRulesDir, "old-agent.mdc");
    writeTextAtomic(
      legacyFile,
      `---\ndescription: Old agent\nalwaysApply: false\n---\n\nOld body.\n`,
    );

    // Set up a legacy manifest (no generatedByEntity) that tracks the old file
    const manifestPath = path.join(
      workspaceRoot,
      ".agents",
      ".sync-manifest.json",
    );
    ensureDir(path.dirname(manifestPath));
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        { version: 1, generatedFiles: [legacyFile] },
        null,
        2,
      ) + "\n",
    );

    // Now sync with an agent in the canonical directory
    const agentsDir = path.join(workspaceRoot, ".agents", "agents");
    ensureDir(agentsDir);
    writeTextAtomic(
      path.join(agentsDir, "old-agent.md"),
      `---\nname: old-agent\ndescription: Old agent\n---\n\nNew body.\n`,
    );

    const paths = buildScopePaths(workspaceRoot, "local", homeDir);
    await syncFromCanonical({
      paths,
      providers: ["cursor"],
      yes: true,
      nonInteractive: true,
    });

    // New file must exist in .cursor/agents/
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".cursor", "agents", "old-agent.md"),
      ),
    ).toBe(true);
    // Legacy .mdc in .cursor/rules/ must be removed
    expect(fs.existsSync(legacyFile)).toBe(false);
  });
});
