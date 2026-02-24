import { describe, expect, it } from "vitest";
import {
  buildAgentMarkdown,
  parseAgentMarkdown,
} from "../../src/core/agents.js";

describe("agent frontmatter parsing", () => {
  it("parses valid markdown with frontmatter", () => {
    const raw = `---\nname: test-agent\ndescription: Test description\ncodex:\n  model: gpt-5.3-codex\n---\n\nYou are a test agent.\n`;

    const parsed = parseAgentMarkdown(raw, "/tmp/test-agent.md");

    expect(parsed.name).toBe("test-agent");
    expect(parsed.description).toBe("Test description");
    expect(parsed.body).toContain("You are a test agent.");
  });

  it("round-trips frontmatter and body", () => {
    const raw = `---\nname: reviewer\ndescription: Reviews PRs\nclaude:\n  model: sonnet\n---\n\nReview the changes carefully.\n`;
    const parsed = parseAgentMarkdown(raw, "/tmp/reviewer.md");
    const serialized = buildAgentMarkdown(parsed.frontmatter, parsed.body);

    expect(serialized).toContain("name: reviewer");
    expect(serialized).toContain("description: Reviews PRs");
    expect(serialized).toContain("Review the changes carefully.");
  });

  it("keeps long descriptions on a single frontmatter line", () => {
    const description =
      "Starts the application, performs auto-login, and reports back the ports and current URL. Use before testing changes in the browser. See application-debugging skill for browser tool guidance.";
    const raw = `---\nname: application-runner\ndescription: ${description}\n---\n\nStart services and report readiness.\n`;
    const parsed = parseAgentMarkdown(raw, "/tmp/application-runner.md");
    const serialized = buildAgentMarkdown(parsed.frontmatter, parsed.body);

    expect(serialized).toContain(`description: ${description}`);
    expect(serialized).not.toContain(
      "description: Starts the application, performs auto-login, and reports back the\n",
    );
  });
});
