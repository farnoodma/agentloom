import { NextResponse } from "next/server";
import { isCatalogEntityType, isLeaderboardPeriod } from "@/lib/catalog";
import {
  clampLeaderboardPageSize,
  serializeLeaderboardRow,
} from "@/lib/leaderboard";
import {
  decodeLeaderboardCursor,
  getLeaderboardPage,
} from "@/server/db/queries";

export const dynamic = "force-dynamic";

function parseLimit(rawValue: string | null): number {
  if (!rawValue) {
    return clampLeaderboardPageSize();
  }

  const parsed = Number.parseInt(rawValue, 10);
  return clampLeaderboardPageSize(parsed);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const periodParam = url.searchParams.get("period") ?? "all";
  const entityParam = url.searchParams.get("entity") ?? "all";
  const q = (url.searchParams.get("q") ?? "").trim();
  const cursorParam = url.searchParams.get("cursor");

  const period = isLeaderboardPeriod(periodParam) ? periodParam : "all";
  const entity =
    entityParam === "all" || isCatalogEntityType(entityParam)
      ? entityParam
      : "all";
  let cursor: Parameters<typeof getLeaderboardPage>[0]["cursor"] = undefined;

  if (cursorParam) {
    const decodedCursor = decodeLeaderboardCursor(cursorParam);
    if (!decodedCursor) {
      return NextResponse.json(
        {
          error: "invalid_cursor",
        },
        { status: 400 },
      );
    }

    cursor = decodedCursor;
  }

  const page = await getLeaderboardPage({
    period,
    entity,
    q,
    cursor,
    limit: parseLimit(url.searchParams.get("limit")),
  });

  return NextResponse.json({
    rows: page.rows.map(serializeLeaderboardRow),
    nextCursor: page.nextCursor,
  });
}
