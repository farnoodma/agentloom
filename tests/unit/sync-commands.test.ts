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
});
