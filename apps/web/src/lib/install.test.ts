import { describe, expect, it } from "vitest";
import { buildInstallCommand } from "@/lib/install";

describe("buildInstallCommand", () => {
  it("builds skill install commands", () => {
    expect(
      buildInstallCommand({
        entityType: "skill",
        owner: "farnoodma",
        repo: "agents",
        displayName: "release-check",
      }),
    ).toBe(
      "npx agentloom skill add https://github.com/farnoodma/agents --skills release-check",
    );
  });

  it("builds rule install commands", () => {
    expect(
      buildInstallCommand({
        entityType: "rule",
        owner: "farnoodma",
        repo: "agents",
        displayName: "always-test",
      }),
    ).toBe(
      "npx agentloom rule add https://github.com/farnoodma/agents --rules always-test",
    );
  });

  it("quotes selectors with spaces for copied install commands", () => {
    expect(
      buildInstallCommand({
        entityType: "rule",
        owner: "farnoodma",
        repo: "agents",
        displayName: "Always Test",
      }),
    ).toBe(
      "npx agentloom rule add https://github.com/farnoodma/agents --rules 'Always Test'",
    );
  });
});
