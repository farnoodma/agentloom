import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";
import { buildScopePaths } from "../../src/core/scope.js";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	isCancel: vi.fn(() => false),
	select: vi.fn(),
	text: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
	isCancel: promptMocks.isCancel,
	select: promptMocks.select,
	text: promptMocks.text,
}));

import { importSource } from "../../src/core/importer.js";

const tempDirs: string[] = [];

beforeEach(() => {
	promptMocks.cancel.mockReset();
	promptMocks.isCancel.mockReset();
	promptMocks.isCancel.mockReturnValue(false);
	promptMocks.select.mockReset();
	promptMocks.text.mockReset();
});

afterEach(() => {
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("import source conflict handling", () => {
	it("re-checks renamed filename and does not overwrite existing files silently", async () => {
		const sourceRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "agentloom-source-"),
		);
		const workspaceRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "agentloom-workspace-"),
		);
		tempDirs.push(sourceRoot, workspaceRoot);

		ensureDir(path.join(sourceRoot, "agents"));
		writeTextAtomic(
			path.join(sourceRoot, "agents", "reviewer.md"),
			`---\nname: reviewer\ndescription: Review specialist\n---\n\nNew reviewer instructions.\n`,
		);

		const paths = buildScopePaths(workspaceRoot, "local");
		ensureDir(paths.agentsDir);

		writeTextAtomic(
			path.join(paths.agentsDir, "reviewer.md"),
			`---\nname: reviewer\ndescription: Review specialist\n---\n\nExisting reviewer instructions.\n`,
		);
		writeTextAtomic(
			path.join(paths.agentsDir, "existing-name.md"),
			`---\nname: existing-name\ndescription: Existing agent\n---\n\nKeep this content.\n`,
		);

		promptMocks.select
			.mockResolvedValueOnce("rename")
			.mockResolvedValueOnce("skip");
		promptMocks.text.mockResolvedValueOnce("existing-name");

		const summary = await importSource({
			source: sourceRoot,
			paths,
			yes: false,
			nonInteractive: false,
		});

		expect(promptMocks.select).toHaveBeenCalledTimes(2);
		expect(promptMocks.text).toHaveBeenCalledTimes(1);
		expect(summary.importedAgents).toHaveLength(0);
		expect(
			fs.readFileSync(path.join(paths.agentsDir, "existing-name.md"), "utf8"),
		).toContain("Keep this content.");
	});
});
