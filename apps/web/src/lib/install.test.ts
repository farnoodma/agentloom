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
});
