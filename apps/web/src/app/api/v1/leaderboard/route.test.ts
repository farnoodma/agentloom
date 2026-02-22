import { beforeEach, describe, expect, it, vi } from "vitest";

const decodeLeaderboardCursorMock = vi.fn();
const getLeaderboardPageMock = vi.fn();

vi.mock("@/server/db/queries", () => ({
  decodeLeaderboardCursor: decodeLeaderboardCursorMock,
  getLeaderboardPage: getLeaderboardPageMock,
}));

const { GET } = await import("@/app/api/v1/leaderboard/route");

beforeEach(() => {
  decodeLeaderboardCursorMock.mockReset();
  getLeaderboardPageMock.mockReset();
});

describe("GET /api/v1/leaderboard", () => {
  it("returns paginated leaderboard rows", async () => {
    decodeLeaderboardCursorMock.mockReturnValue({
      installs: 30,
      totalInstalls: 200,
      firstSeenAt: "2026-02-20T00:00:00.000Z",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
    getLeaderboardPageMock.mockResolvedValue({
      rows: [
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          owner: "farnoodma",
          repo: "agents",
          entityType: "agent",
          itemSlug: "reviewer",
          displayName: "Reviewer",
          sourceFilePath: "agents/reviewer.md",
          sourceUrl: "https://github.com/farnoodma/agents/blob/main/agents/reviewer.md",
          firstSeenAt: new Date("2026-02-18T00:00:00.000Z"),
          totalInstalls: 245,
          installs: 42,
        },
      ],
      nextCursor: "next-cursor",
    });

    const response = await GET(
      new Request(
        "http://localhost/api/v1/leaderboard?period=daily&entity=agent&q=%20reviewer%20&cursor=cursor-token&limit=500",
      ),
    );

    expect(response.status).toBe(200);
    expect(decodeLeaderboardCursorMock).toHaveBeenCalledWith("cursor-token");
    expect(getLeaderboardPageMock).toHaveBeenCalledWith({
      period: "daily",
      entity: "agent",
      q: "reviewer",
      cursor: {
        installs: 30,
        totalInstalls: 200,
        firstSeenAt: "2026-02-20T00:00:00.000Z",
        id: "550e8400-e29b-41d4-a716-446655440000",
      },
      limit: 100,
    });

    await expect(response.json()).resolves.toEqual({
      rows: [
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          owner: "farnoodma",
          repo: "agents",
          entityType: "agent",
          itemSlug: "reviewer",
          displayName: "Reviewer",
          sourceFilePath: "agents/reviewer.md",
          sourceUrl: "https://github.com/farnoodma/agents/blob/main/agents/reviewer.md",
          firstSeenAt: "2026-02-18T00:00:00.000Z",
          totalInstalls: 245,
          installs: 42,
        },
      ],
      nextCursor: "next-cursor",
    });
  });

  it("returns 400 when cursor cannot be decoded", async () => {
    decodeLeaderboardCursorMock.mockReturnValue(null);

    const response = await GET(
      new Request("http://localhost/api/v1/leaderboard?cursor=bad-cursor"),
    );

    expect(response.status).toBe(400);
    expect(getLeaderboardPageMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "invalid_cursor",
    });
  });
});
