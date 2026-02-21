import { describe, expect, it } from "vitest";
import { hashActor, minuteBucket } from "@/server/telemetry/hash";

describe("telemetry hash", () => {
  it("hashes actor deterministically", () => {
    const first = hashActor({ ip: "1.2.3.4", userAgent: "ua", salt: "salt" });
    const second = hashActor({ ip: "1.2.3.4", userAgent: "ua", salt: "salt" });
    expect(first).toBe(second);
  });

  it("normalizes minute bucket", () => {
    const value = minuteBucket(new Date("2026-02-21T14:54:32.123Z"));
    expect(value.toISOString()).toBe("2026-02-21T14:54:00.000Z");
  });
});
