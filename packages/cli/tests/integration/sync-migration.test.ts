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
  vi.restoreAllMocks();
});

describe("sync canonical output flow", () => {
  it("rejects settings-only global preference state", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeRoot);
    vi.spyOn(os, "homedir").mockReturnValue(homeRoot);

    writeTextAtomic(
      path.join(homeRoot, ".agents", "settings.local.json"),
      JSON.stringify({ version: 1, lastScope: "global" }, null, 2),
    );

    await expect(
      runSyncCommand(
        parseArgs(["sync", "--global", "--providers", "cursor", "--yes"]),
        workspaceRoot,
      ),
    ).rejects.toThrow(
      `No initialized canonical .agents state found at ${path.join(homeRoot, ".agents")}.`,
    );

    expect(fs.existsSync(path.join(homeRoot, ".agents", "mcp.json"))).toBe(
      false,
    );
  });

  it("requires canonical .agents before syncing", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    ensureDir(path.join(workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(workspaceRoot, ".cursor", "commands", "review.prompt.md"),
      "# /review\n\nReview this pull request.\n",
    );

    await expect(
      runSyncCommand(
        parseArgs(["sync", "--local", "--providers", "cursor", "--yes"]),
        workspaceRoot,
      ),
    ).rejects.toThrow(
      `No initialized canonical .agents state found at ${path.join(workspaceRoot, ".agents")}.`,
    );
    await expect(
      runSyncCommand(
        parseArgs(["sync", "--local", "--providers", "cursor", "--yes"]),
        workspaceRoot,
      ),
    ).rejects.toThrow("agentloom init --local");

    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(false);
  });

  it("rejects empty placeholder .agents directories", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    ensureDir(path.join(workspaceRoot, ".agents"));
    ensureDir(path.join(workspaceRoot, ".cursor"));
    writeTextAtomic(
      path.join(workspaceRoot, ".cursor", "mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            browser: {
              command: "npx",
              args: ["browser-tools-mcp"],
            },
          },
        },
        null,
        2,
      ),
    );

    await expect(
      runSyncCommand(
        parseArgs(["sync", "--local", "--providers", "cursor", "--yes"]),
        workspaceRoot,
      ),
    ).rejects.toThrow(
      `No initialized canonical .agents state found at ${path.join(workspaceRoot, ".agents")}.`,
    );

    const cursorMcp = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, ".cursor", "mcp.json"), "utf8"),
    );
    expect(cursorMcp.mcpServers).toEqual({
      browser: {
        command: "npx",
        args: ["browser-tools-mcp"],
      },
    });
  });

  it("does not fall back to global sync when the repo already has .agents", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-home-"));
    tempDirs.push(workspaceRoot, homeRoot);
    vi.spyOn(os, "homedir").mockReturnValue(homeRoot);

    ensureDir(path.join(workspaceRoot, ".agents"));

    writeTextAtomic(
      path.join(homeRoot, ".agents", "mcp.json"),
      JSON.stringify({ version: 1, mcpServers: {} }, null, 2),
    );
    writeTextAtomic(
      path.join(homeRoot, ".agents", "commands", "write.md"),
      "# /write\n\nWrite the change.\n",
    );

    await expect(
      runSyncCommand(
        parseArgs(["sync", "--providers", "cursor", "--yes"]),
        workspaceRoot,
      ),
    ).rejects.toThrow(
      `No initialized canonical .agents state found at ${path.join(workspaceRoot, ".agents")}.`,
    );

    expect(
      fs.existsSync(path.join(homeRoot, ".cursor", "commands", "write.md")),
    ).toBe(false);
  });

  it("syncs from canonical state without importing provider-only files", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    ensureDir(path.join(workspaceRoot, ".agents", "commands"));
    writeTextAtomic(
      path.join(workspaceRoot, ".agents", "commands", "write.md"),
      "# /write\n\nWrite the change.\n",
    );

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
        path.join(workspaceRoot, ".cursor", "commands", "write.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(false);
  });

  it("keeps dry-run previews one-way from canonical state", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    ensureDir(path.join(workspaceRoot, ".agents", "commands"));
    writeTextAtomic(
      path.join(workspaceRoot, ".agents", "commands", "write.md"),
      "# /write\n\nWrite the change.\n",
    );

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

    expect(output).toContain("Generated/updated files: 2");
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".cursor", "commands", "write.md"),
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot, ".cursor", "mcp.json"))).toBe(
      false,
    );
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(false);
  });
});
