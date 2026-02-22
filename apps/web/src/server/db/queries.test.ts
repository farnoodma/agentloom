import { describe, expect, it } from "vitest";
import {
  decodeLeaderboardCursor,
  encodeLeaderboardCursor,
} from "@/server/db/queries";

describe("leaderboard cursor encoding", () => {
  it("round-trips a leaderboard cursor", () => {
    const encoded = encodeLeaderboardCursor({
      entitySort: 4,
      installs: 42,
      totalInstalls: 900,
      firstSeenAt: "2026-02-18T00:00:00.000Z",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(decodeLeaderboardCursor(encoded)).toEqual({
      entitySort: 4,
      installs: 42,
      totalInstalls: 900,
      firstSeenAt: "2026-02-18T00:00:00.000Z",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("rejects malformed cursor values", () => {
    expect(decodeLeaderboardCursor("not-base64")).toBeNull();
    expect(
      decodeLeaderboardCursor(
        Buffer.from(
          JSON.stringify({
            i: 12,
            t: 18,
            f: "not-a-date",
            id: "550e8400-e29b-41d4-a716-446655440000",
          }),
          "utf8",
        ).toString("base64url"),
      ),
    ).toBeNull();
  });

  it("defaults missing legacy entity sort to the highest bucket", () => {
    const encodedLegacyCursor = Buffer.from(
      JSON.stringify({
        i: 12,
        t: 18,
        f: "2026-02-18T00:00:00.000Z",
        id: "550e8400-e29b-41d4-a716-446655440000",
      }),
      "utf8",
    ).toString("base64url");

    expect(decodeLeaderboardCursor(encodedLegacyCursor)).toEqual({
      entitySort: 4,
      installs: 12,
      totalInstalls: 18,
      firstSeenAt: "2026-02-18T00:00:00.000Z",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });
});
