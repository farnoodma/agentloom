import { describe, expect, it } from "vitest";
import { parseArgs, parseSelectionModeFlag } from "../../src/core/argv.js";

describe("parseArgs", () => {
  it("normalizes --no-sync to no-sync=true", () => {
    const parsed = parseArgs(["add", "source", "--no-sync"]);
    expect(parsed["no-sync"]).toBe(true);
  });

  it("normalizes --sync=false to no-sync=true", () => {
    const parsed = parseArgs(["add", "source", "--sync=false"]);
    expect(parsed["no-sync"]).toBe(true);
  });

  it("keeps no-sync false when not provided", () => {
    const parsed = parseArgs(["add", "source"]);
    expect(parsed["no-sync"]).toBe(false);
  });

  it("parses selection mode aliases", () => {
    expect(parseSelectionModeFlag("all")).toBe("all");
    expect(parseSelectionModeFlag("sync-all")).toBe("all");
    expect(parseSelectionModeFlag("custom")).toBe("custom");
  });

  it("rejects invalid selection mode values", () => {
    expect(() => parseSelectionModeFlag("pinned")).toThrow(
      "Unknown selection mode",
    );
  });
});
