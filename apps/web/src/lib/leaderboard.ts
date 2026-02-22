import { type CatalogEntityType, type LeaderboardPeriod } from "@/lib/catalog";

export const DEFAULT_LEADERBOARD_PAGE_SIZE = 50;
export const MAX_LEADERBOARD_PAGE_SIZE = 100;

export interface LeaderboardListRow {
  id: string;
  owner: string;
  repo: string;
  entityType: CatalogEntityType;
  itemSlug: string;
  displayName: string;
  sourceFilePath: string;
  sourceUrl: string;
  firstSeenAt: string;
  totalInstalls: number;
  installs: number;
}

export interface LeaderboardListResponse {
  rows: LeaderboardListRow[];
  nextCursor: string | null;
}

export interface LeaderboardListQuery {
  period: LeaderboardPeriod;
  entity: CatalogEntityType | "all";
  q?: string;
}

interface LeaderboardRowLike {
  id: string;
  owner: string;
  repo: string;
  entityType: CatalogEntityType;
  itemSlug: string;
  displayName: string;
  sourceFilePath: string;
  sourceUrl: string;
  firstSeenAt: Date | string;
  totalInstalls: number;
  installs: number;
}

export function clampLeaderboardPageSize(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_LEADERBOARD_PAGE_SIZE;
  }

  return Math.max(1, Math.min(Math.trunc(value), MAX_LEADERBOARD_PAGE_SIZE));
}

export function serializeLeaderboardRow(row: LeaderboardRowLike): LeaderboardListRow {
  const firstSeenAt =
    typeof row.firstSeenAt === "string" ? new Date(row.firstSeenAt) : row.firstSeenAt;

  return {
    ...row,
    firstSeenAt: firstSeenAt.toISOString(),
  };
}
