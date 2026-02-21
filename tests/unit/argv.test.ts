import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/core/argv.js";

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
});
