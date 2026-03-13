import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeRuleSelector,
  parseRuleMarkdown,
  parseRulesDir,
  renderManagedRuleBlock,
  renderRuleForCursor,
  resolveRuleSelections,
  upsertManagedRuleBlocks,
} from "../../src/core/rules.js";
import { ensureDir, writeTextAtomic } from "../../src/core/fs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("rule parsing", () => {
  it("requires frontmatter.name", () => {
    expect(() =>
      parseRuleMarkdown(`---\ndescription: missing name\n---\n\nBody\n`),
    ).toThrow(/missing required frontmatter\.name/i);
  });

  it("parses canonical rules and keeps id from filename stem", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-rules-"));
    tempDirs.push(root);

    const rulesDir = path.join(root, ".agents", "rules");
    ensureDir(rulesDir);
    writeTextAtomic(
      path.join(rulesDir, "always-test.md"),
      `---
name: Always Test
description: Run tests
alwaysApply: true
---

Run tests before merge.
`,
    );

    const rules = parseRulesDir(rulesDir);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe("always-test");
    expect(rules[0]?.name).toBe("Always Test");
    expect(rules[0]?.frontmatter.alwaysApply).toBe(true);
  });
});

describe("rule selectors", () => {
  it("normalizes slash/extension/case variants", () => {
    expect(normalizeRuleSelector("/Always-Test.md")).toBe("always-test");
  });

  it("resolves by id, filename, and name slug with unmatched reporting", () => {
    const rules = [
      {
        id: "always-test",
        name: "Always Test",
        fileName: "always-test.md",
        sourcePath: "/tmp/always-test.md",
        content: "",
        body: "Run tests.",
        frontmatter: { name: "Always Test" },
      },
      {
        id: "keep-small",
        name: "Keep It Small",
        fileName: "keep-small.md",
        sourcePath: "/tmp/keep-small.md",
        content: "",
        body: "Use small PRs.",
        frontmatter: { name: "Keep It Small" },
      },
    ];

    const result = resolveRuleSelections(rules, [
      "Always Test",
      "keep-small.md",
      "missing",
    ]);

    expect(result.selected.map((rule) => rule.id)).toEqual([
      "always-test",
      "keep-small",
    ]);
    expect(result.unmatched).toEqual(["missing"]);
  });
});

describe("rule rendering", () => {
  it("renders cursor output with frontmatter passthrough", () => {
    const rule = {
      id: "always-test",
      name: "Always Test",
      fileName: "always-test.md",
      sourcePath: "/tmp/always-test.md",
      content: "",
      body: "Run tests before merge.\n",
      frontmatter: {
        name: "Always Test",
        description: "Run tests",
        alwaysApply: true,
      },
    };

    const rendered = renderRuleForCursor(rule);
    expect(rendered).toContain("name: Always Test");
    expect(rendered).toContain("alwaysApply: true");
    expect(rendered).toContain("Run tests before merge.");
  });

  it("upserts managed blocks while preserving unmanaged content", () => {
    const existing = `# Team Notes

Intro paragraph.

<!-- agentloom:always-test:start -->
## Always Test

OLD
<!-- agentloom:always-test:end -->

<!-- agentloom:orphan:start -->
## Orphan

Should be removed.
<!-- agentloom:orphan:end -->

Keep this footer.
`;

    const rules = [
      {
        id: "always-test",
        name: "Always Test",
        fileName: "always-test.md",
        sourcePath: "/tmp/always-test.md",
        content: "",
        body: "Run tests before merge.",
        frontmatter: { name: "Always Test" },
      },
      {
        id: "small-prs",
        name: "Small PRs",
        fileName: "small-prs.md",
        sourcePath: "/tmp/small-prs.md",
        content: "",
        body: "Prefer focused changes.",
        frontmatter: { name: "Small PRs" },
      },
    ];

    const next = upsertManagedRuleBlocks(existing, rules);

    expect(next).toContain(renderManagedRuleBlock(rules[0]!));
    expect(next).toContain(renderManagedRuleBlock(rules[1]!));
    expect(next).not.toContain("agentloom:orphan:start");
    expect(next).toContain("Keep this footer.");
  });
});
