import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSyncCommand } from "../../src/commands/sync.js";
import { parseArgs } from "../../src/core/argv.js";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("sync migration pre-step", () => {
  it("migrates provider commands into canonical before sync generation", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    ensureDir(path.join(workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(workspaceRoot, ".cursor", "commands", "review.prompt.md"),
      "# /review\n\nReview this pull request.\n",
    );

    await runSyncCommand(
      parseArgs(["sync", "--local", "--providers", "cursor", "--yes"]),
      workspaceRoot,
    );

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".cursor", "commands", "review.md"),
      ),
    ).toBe(true);
  });

  it("includes migrated commands in dry-run sync preview", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    ensureDir(path.join(workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(workspaceRoot, ".cursor", "commands", "review.prompt.md"),
      "# /review\n\nReview this pull request.\n",
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runSyncCommand(
      parseArgs([
        "sync",
        "--local",
        "--providers",
        "cursor",
        "--yes",
        "--dry-run",
      ]),
      workspaceRoot,
    );

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("Generated/updated files: 2");
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".cursor", "commands", "review.md"),
      ),
    ).toBe(false);
  });
});
