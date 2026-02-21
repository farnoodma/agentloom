import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getUtcDayStart, getUtcMonthStart, getUtcWeekStart } from "@/lib/time";
import { type CatalogEntityType, type LeaderboardPeriod } from "@/lib/catalog";
import { getDb } from "@/server/db/client";
import {
  catalogItems,
  installCountsDaily,
  installCountsMonthly,
  installCountsWeekly,
} from "@/server/db/schema";

export interface LeaderboardRow {
  id: string;
  owner: string;
  repo: string;
  entityType: CatalogEntityType;
  itemSlug: string;
  displayName: string;
  sourceFilePath: string;
  sourceUrl: string;
  firstSeenAt: Date;
  totalInstalls: number;
  installs: number;
}

export interface ItemDetail extends LeaderboardRow {
  dailyInstalls: number;
  monthlyInstalls: number;
  weeklyInstalls: number;
  lastSeenAt: Date;
}

function buildFilter(entity: CatalogEntityType | "all", q?: string) {
  const filters = [];

  if (entity !== "all") {
    filters.push(eq(catalogItems.entityType, entity));
  }

  if (q && q.trim() !== "") {
    const term = `%${q.trim()}%`;
    filters.push(
      or(
        ilike(catalogItems.displayName, term),
        ilike(catalogItems.itemSlug, term),
        ilike(catalogItems.owner, term),
        ilike(catalogItems.repo, term),
      ),
    );
  }

  if (filters.length === 0) {
    return undefined;
  }

  return and(...filters);
}

export async function getLeaderboard(input: {
  period: LeaderboardPeriod;
  entity: CatalogEntityType | "all";
  q?: string;
  limit?: number;
}): Promise<LeaderboardRow[]> {
  const db = getDb();
  if (!db) {
    return [];
  }

  const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
  const where = buildFilter(input.entity, input.q);

  if (input.period === "all") {
    const rows = await db
      .select({
        id: catalogItems.id,
        owner: catalogItems.owner,
        repo: catalogItems.repo,
        entityType: catalogItems.entityType,
        itemSlug: catalogItems.itemSlug,
        displayName: catalogItems.displayName,
        sourceFilePath: catalogItems.sourceFilePath,
        sourceUrl: catalogItems.sourceUrl,
        firstSeenAt: catalogItems.firstSeenAt,
        totalInstalls: catalogItems.totalInstalls,
        installs: catalogItems.totalInstalls,
      })
      .from(catalogItems)
      .where(where)
      .orderBy(desc(catalogItems.totalInstalls), desc(catalogItems.firstSeenAt))
      .limit(limit);

    return rows as LeaderboardRow[];
  }

  const periodTable =
    input.period === "daily"
      ? installCountsDaily
      : input.period === "monthly"
        ? installCountsMonthly
        : installCountsWeekly;
  const periodStart =
    input.period === "daily"
      ? getUtcDayStart()
      : input.period === "monthly"
        ? getUtcMonthStart()
        : getUtcWeekStart();
  const periodColumn =
    input.period === "daily"
      ? installCountsDaily.dayStart
      : input.period === "monthly"
        ? installCountsMonthly.monthStart
        : installCountsWeekly.weekStart;

  const rows = await db
    .select({
      id: catalogItems.id,
      owner: catalogItems.owner,
      repo: catalogItems.repo,
      entityType: catalogItems.entityType,
      itemSlug: catalogItems.itemSlug,
      displayName: catalogItems.displayName,
      sourceFilePath: catalogItems.sourceFilePath,
      sourceUrl: catalogItems.sourceUrl,
      firstSeenAt: catalogItems.firstSeenAt,
      totalInstalls: catalogItems.totalInstalls,
      installs: sql<number>`COALESCE(${periodTable.installs}, 0)`,
    })
    .from(catalogItems)
    .leftJoin(
      periodTable,
      and(eq(periodTable.itemId, catalogItems.id), eq(periodColumn, periodStart)),
    )
    .where(where)
    .orderBy(desc(sql`COALESCE(${periodTable.installs}, 0)`), desc(catalogItems.totalInstalls))
    .limit(limit);

  return rows as LeaderboardRow[];
}

export async function getItemDetail(input: {
  owner: string;
  repo: string;
  entity: CatalogEntityType;
  slug: string;
}): Promise<ItemDetail | null> {
  const db = getDb();
  if (!db) {
    return null;
  }

  const monthStart = getUtcMonthStart();
  const dayStart = getUtcDayStart();
  const weekStart = getUtcWeekStart();

  const rows = await db
    .select({
      id: catalogItems.id,
      owner: catalogItems.owner,
      repo: catalogItems.repo,
      entityType: catalogItems.entityType,
      itemSlug: catalogItems.itemSlug,
      displayName: catalogItems.displayName,
      sourceFilePath: catalogItems.sourceFilePath,
      sourceUrl: catalogItems.sourceUrl,
      firstSeenAt: catalogItems.firstSeenAt,
      lastSeenAt: catalogItems.lastSeenAt,
      totalInstalls: catalogItems.totalInstalls,
      installs: catalogItems.totalInstalls,
      dailyInstalls: sql<number>`COALESCE(${installCountsDaily.installs}, 0)`,
      monthlyInstalls: sql<number>`COALESCE(${installCountsMonthly.installs}, 0)`,
      weeklyInstalls: sql<number>`COALESCE(${installCountsWeekly.installs}, 0)`,
    })
    .from(catalogItems)
    .leftJoin(
      installCountsDaily,
      and(eq(installCountsDaily.itemId, catalogItems.id), eq(installCountsDaily.dayStart, dayStart)),
    )
    .leftJoin(
      installCountsMonthly,
      and(
        eq(installCountsMonthly.itemId, catalogItems.id),
        eq(installCountsMonthly.monthStart, monthStart),
      ),
    )
    .leftJoin(
      installCountsWeekly,
      and(eq(installCountsWeekly.itemId, catalogItems.id), eq(installCountsWeekly.weekStart, weekStart)),
    )
    .where(
      and(
        eq(catalogItems.owner, input.owner),
        eq(catalogItems.repo, input.repo),
        eq(catalogItems.entityType, input.entity),
        eq(catalogItems.itemSlug, input.slug),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  return rows[0] as ItemDetail;
}
