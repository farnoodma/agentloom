import { describe, expect, it } from "vitest";
import {
  commandFileMatchesSelector,
  normalizeCommandSelector,
  resolveCommandSelections,
} from "../../src/core/commands.js";

describe("command selector helpers", () => {
  it("matches selectors by bare name and filename", () => {
    expect(commandFileMatchesSelector("review.md", "review")).toBe(true);
    expect(commandFileMatchesSelector("review.md", "review.md")).toBe(true);
  });

  it("normalizes slash-prefixed selectors", () => {
    expect(normalizeCommandSelector("/review")).toBe("review");
  });

  it("resolves multiple selectors and reports unmatched entries", () => {
    const commands = [
      { fileName: "review.md", sourcePath: "", content: "", body: "" },
      { fileName: "ship.md", sourcePath: "", content: "", body: "" },
    ];

    const result = resolveCommandSelections(commands, ["review", "missing"]);
    expect(result.selected.map((item) => item.fileName)).toEqual(["review.md"]);
    expect(result.unmatched).toEqual(["missing"]);
  });
});
