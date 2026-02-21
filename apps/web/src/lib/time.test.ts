import { describe, expect, it } from "vitest";
import { getUtcDayStart, getUtcMonthStart, getUtcWeekStart } from "@/lib/time";

describe("time utilities", () => {
  it("computes monday week start in utc", () => {
    expect(getUtcWeekStart(new Date("2026-02-21T10:00:00Z"))).toBe("2026-02-16");
    expect(getUtcWeekStart(new Date("2026-02-23T00:00:00Z"))).toBe("2026-02-23");
  });

  it("computes month start in utc", () => {
    expect(getUtcMonthStart(new Date("2026-02-21T10:00:00Z"))).toBe("2026-02-01");
  });

  it("computes day start in utc", () => {
    expect(getUtcDayStart(new Date("2026-02-21T23:59:59Z"))).toBe("2026-02-21");
  });
});
