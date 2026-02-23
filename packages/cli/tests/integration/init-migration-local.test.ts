import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInitCommand } from "../../src/commands/init.js";
import { parseArgs } from "../../src/core/argv.js";
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

describe("init migration (local scope)", () => {
  it("bootstraps canonical layout and migrates provider files", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentloom-workspace-"),
    );
    tempDirs.push(workspaceRoot);

    ensureDir(path.join(workspaceRoot, ".cursor", "commands"));
    writeTextAtomic(
      path.join(workspaceRoot, ".cursor", "commands", "review.prompt.md"),
      "# /review\n\nReview this change set.\n",
    );

    writeJsonAtomic(path.join(workspaceRoot, ".cursor", "mcp.json"), {
      mcpServers: {
        browser: {
          command: "npx",
          args: ["browser-tools-mcp"],
        },
      },
    });

    await runInitCommand(
      parseArgs([
        "init",
        "--local",
        "--providers",
        "cursor",
        "--yes",
        "--no-sync",
      ]),
      workspaceRoot,
    );

    expect(fs.existsSync(path.join(workspaceRoot, ".agents", "agents"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(workspaceRoot, ".agents", "commands", "review.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".agents", "mcp.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(workspaceRoot, ".agents", "agents.lock.json")),
    ).toBe(true);

    const lockfile = JSON.parse(
      fs.readFileSync(
        path.join(workspaceRoot, ".agents", "agents.lock.json"),
        "utf8",
      ),
    ) as { entries?: unknown[] };
    expect(lockfile.entries).toEqual([]);
  });
});
