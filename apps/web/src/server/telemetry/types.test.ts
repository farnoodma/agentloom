import { describe, expect, it } from "vitest";
import { installEventSchema } from "@/server/telemetry/types";

describe("installEventSchema", () => {
  it("accepts valid payload", () => {
    const parsed = installEventSchema.safeParse({
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      occurredAt: "2026-02-21T14:00:00.000Z",
      cliVersion: "0.1.0",
      source: { owner: "farnoodma", repo: "agents" },
      items: [{ entityType: "agent", name: "reviewer", filePath: "agents/reviewer.md" }],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects missing items", () => {
    const parsed = installEventSchema.safeParse({
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      occurredAt: "2026-02-21T14:00:00.000Z",
      cliVersion: "0.1.0",
      source: { owner: "farnoodma", repo: "agents" },
      items: [],
    });

    expect(parsed.success).toBe(false);
  });
});
