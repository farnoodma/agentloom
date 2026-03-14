import { describe, expect, it } from "vitest";
import { parseMarkdownSource } from "./frontmatter";

describe("parseMarkdownSource", () => {
  it("returns original body when markdown has no frontmatter", () => {
    const content = "# Hello\n\nworld";
    const parsed = parseMarkdownSource(content);

    expect(parsed.frontmatter).toEqual([]);
    expect(parsed.body).toBe(content);
  });

  it("extracts top-level frontmatter keys and strips the frontmatter block", () => {
    const content = `---
name: code-reviewer
description: Reviews pull requests.
cursor:
  model: gpt-5
  tools:
    - bash
---
# Reviewer

Body`;

    const parsed = parseMarkdownSource(content);

    expect(parsed.frontmatter).toEqual([
      { key: "name", value: "code-reviewer" },
      { key: "description", value: "Reviews pull requests." },
      { key: "cursor", value: "model: gpt-5\ntools:\n  - bash" },
    ]);
    expect(parsed.body).toBe("# Reviewer\n\nBody");
  });

  it("keeps empty metadata values", () => {
    const content = `---
title:
---
Body`;

    const parsed = parseMarkdownSource(content);

    expect(parsed.frontmatter).toEqual([{ key: "title", value: "" }]);
    expect(parsed.body).toBe("Body");
  });

  it("does not include YAML block-scalar indicators as metadata values", () => {
    const content = `---
description: |
  First line.
  Second line.
model: inherit
---
Body`;

    const parsed = parseMarkdownSource(content);

    expect(parsed.frontmatter).toEqual([
      { key: "description", value: "First line.\nSecond line." },
      { key: "model", value: "inherit" },
    ]);
    expect(parsed.body).toBe("Body");
  });

  it("trims leading/trailing whitespace from multiline metadata values", () => {
    const content = `---
description: |
  
    First line.
    Second line.
  
---
Body`;

    const parsed = parseMarkdownSource(content);

    expect(parsed.frontmatter).toEqual([
      { key: "description", value: "First line.\nSecond line." },
    ]);
  });

  it("removes wrapping quotes from single-line metadata values", () => {
    const content = `---
description: "Deprecated - use the superpowers:writing-plans skill instead"
model: 'inherit'
---
Body`;

    const parsed = parseMarkdownSource(content);

    expect(parsed.frontmatter).toEqual([
      {
        key: "description",
        value: "Deprecated - use the superpowers:writing-plans skill instead",
      },
      { key: "model", value: "inherit" },
    ]);
  });
});
