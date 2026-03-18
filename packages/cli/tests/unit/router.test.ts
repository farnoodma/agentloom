import { describe, expect, it } from "vitest";
import { parseCommandRoute } from "../../src/core/router.js";

describe("parseCommandRoute", () => {
  it("maps aggregate remove to delete", () => {
    expect(parseCommandRoute(["remove", "farnoodma/agents"])).toEqual({
      mode: "aggregate",
      verb: "delete",
    });
  });

  it("maps entity remove to delete", () => {
    expect(parseCommandRoute(["skill", "remove", "audit"])).toEqual({
      mode: "entity",
      entity: "skill",
      verb: "delete",
    });
  });

  it("maps mcp server remove to delete", () => {
    expect(parseCommandRoute(["mcp", "server", "remove", "browser"])).toEqual({
      mode: "mcp-server",
      verb: "delete",
    });
  });
});
