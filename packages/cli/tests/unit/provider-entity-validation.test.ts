import { describe, expect, it } from "vitest";
import { isProviderEntityFileName } from "../../src/core/provider-entity-validation.js";

describe("provider entity file validation", () => {
  it("requires copilot agent files to use .agent.md", () => {
    expect(
      isProviderEntityFileName({
        provider: "copilot",
        entity: "agent",
        fileName: "reviewer.agent.md",
      }),
    ).toBe(true);
    expect(
      isProviderEntityFileName({
        provider: "copilot",
        entity: "agent",
        fileName: "README.md",
      }),
    ).toBe(false);
  });

  it("requires copilot command files to use .prompt.md", () => {
    expect(
      isProviderEntityFileName({
        provider: "copilot",
        entity: "command",
        fileName: "review.prompt.md",
      }),
    ).toBe(true);
    expect(
      isProviderEntityFileName({
        provider: "copilot",
        entity: "command",
        fileName: "review.md",
      }),
    ).toBe(false);
  });

  it("accepts generic provider command and agent markdown files", () => {
    expect(
      isProviderEntityFileName({
        provider: "cursor",
        entity: "agent",
        fileName: "reviewer.md",
      }),
    ).toBe(true);
    expect(
      isProviderEntityFileName({
        provider: "cursor",
        entity: "command",
        fileName: "review.mdc",
      }),
    ).toBe(true);
    expect(
      isProviderEntityFileName({
        provider: "cursor",
        entity: "command",
        fileName: "README.md",
      }),
    ).toBe(false);
  });
});
