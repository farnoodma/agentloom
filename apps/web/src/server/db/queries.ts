import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getUtcDayStart, getUtcMonthStart, getUtcWeekStart } from "@/lib/time";
import { type CatalogEntityType, type LeaderboardPeriod } from "@/lib/catalog";
import { clampLeaderboardPageSize } from "@/lib/leaderboard";
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

export interface LeaderboardCursor {
  entitySort: number;
  installs: number;
  totalInstalls: number;
  firstSeenAt: string;
  id: string;
}

export interface LeaderboardPage {
  rows: LeaderboardRow[];
  nextCursor: string | null;
}

interface CursorPayload {
  e?: number;
  i: number;
  t: number;
  f: string;
  id: string;
}

const ENTITY_SORT_ORDER = sql<number>`CASE
  WHEN ${catalogItems.entityType} = 'agent' THEN 4
  WHEN ${catalogItems.entityType} = 'skill' THEN 3
  WHEN ${catalogItems.entityType} = 'command' THEN 2
  WHEN ${catalogItems.entityType} = 'mcp' THEN 1
  ELSE 0
END`;

function buildFilter(entity: CatalogEntityType | "all", q?: string): SQL<unknown> | undefined {
  const filters: SQL<unknown>[] = [];

  if (entity !== "all") {
    filters.push(eq(catalogItems.entityType, entity));
  }

  if (q && q.trim() !== "") {
    const term = `%${q.trim()}%`;
    const searchFilter = or(
      ilike(catalogItems.displayName, term),
      ilike(catalogItems.itemSlug, term),
      ilike(catalogItems.owner, term),
      ilike(catalogItems.repo, term),
    );
    if (searchFilter) {
      filters.push(searchFilter);
    }
  }

  if (filters.length === 0) {
    return undefined;
  }

  return and(...filters);
}

function combineFilters(filters: Array<SQL<unknown> | undefined>): SQL<unknown> | undefined {
  const activeFilters = filters.filter((filter): filter is SQL<unknown> => filter !== undefined);

  if (activeFilters.length === 0) {
    return undefined;
  }

  if (activeFilters.length === 1) {
    return activeFilters[0];
  }

  return and(...activeFilters);
}

function isValidCursorPayload(value: unknown): value is CursorPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<CursorPayload>;

  return (
    (payload.e === undefined || Number.isInteger(payload.e)) &&
    Number.isInteger(payload.i) &&
    Number.isInteger(payload.t) &&
    typeof payload.f === "string" &&
    payload.f.trim() !== "" &&
    typeof payload.id === "string" &&
    payload.id.trim() !== ""
  );
}

function normalizeCursorDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function toCursor(row: LeaderboardRow): LeaderboardCursor {
  return {
    entitySort: getEntitySortValue(row.entityType),
    installs: row.installs,
    totalInstalls: row.totalInstalls,
    firstSeenAt: row.firstSeenAt.toISOString(),
    id: row.id,
  };
}

export function encodeLeaderboardCursor(cursor: LeaderboardCursor): string {
  const payload: CursorPayload = {
    e: cursor.entitySort,
    i: cursor.installs,
    t: cursor.totalInstalls,
    f: cursor.firstSeenAt,
    id: cursor.id,
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeLeaderboardCursor(encoded: string): LeaderboardCursor | null {
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const payload = JSON.parse(decoded);

    if (!isValidCursorPayload(payload)) {
      return null;
    }

    const firstSeenAt = normalizeCursorDate(payload.f);
    if (!firstSeenAt) {
      return null;
    }

    return {
      entitySort:
        typeof payload.e === "number" && Number.isInteger(payload.e)
          ? payload.e
          : getEntitySortValue("agent"),
      installs: payload.i,
      totalInstalls: payload.t,
      firstSeenAt,
      id: payload.id,
    };
  } catch {
    return null;
  }
}

export async function getLeaderboardPage(input: {
  period: LeaderboardPeriod;
  entity: CatalogEntityType | "all";
  q?: string;
  limit?: number;
  cursor?: LeaderboardCursor;
}): Promise<LeaderboardPage> {
  const db = getDb();
  if (!db) {
    return { rows: [], nextCursor: null };
  }

  const limit = clampLeaderboardPageSize(input.limit);
  const rowLimit = limit + 1;
  const baseWhere = buildFilter(input.entity, input.q);
  const useEntityGrouping = input.entity === "all";

  if (input.period === "all") {
    const cursorFilter = input.cursor
      ? useEntityGrouping
        ? sql`(${ENTITY_SORT_ORDER}, ${catalogItems.totalInstalls}, ${catalogItems.firstSeenAt}, ${catalogItems.id}) < (${input.cursor.entitySort}, ${input.cursor.totalInstalls}, ${input.cursor.firstSeenAt}, ${input.cursor.id}::uuid)`
        : sql`(${catalogItems.totalInstalls}, ${catalogItems.firstSeenAt}, ${catalogItems.id}) < (${input.cursor.totalInstalls}, ${input.cursor.firstSeenAt}, ${input.cursor.id}::uuid)`
      : undefined;

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
      .where(combineFilters([baseWhere, cursorFilter]))
      .orderBy(
        ...(useEntityGrouping
          ? [desc(ENTITY_SORT_ORDER), desc(catalogItems.totalInstalls)]
          : [desc(catalogItems.totalInstalls)]),
        desc(catalogItems.firstSeenAt),
        desc(catalogItems.id),
      )
      .limit(rowLimit);

    const pageRows = rows.slice(0, limit) as LeaderboardRow[];
    const nextCursor =
      rows.length > limit
        ? encodeLeaderboardCursor(toCursor(pageRows[pageRows.length - 1] as LeaderboardRow))
        : null;

    return {
      rows: pageRows,
      nextCursor,
    };
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
  const periodInstalls = sql<number>`COALESCE(${periodTable.installs}, 0)`;
  const cursorFilter = input.cursor
    ? useEntityGrouping
      ? sql`(${ENTITY_SORT_ORDER}, ${periodInstalls}, ${catalogItems.totalInstalls}, ${catalogItems.firstSeenAt}, ${catalogItems.id}) < (${input.cursor.entitySort}, ${input.cursor.installs}, ${input.cursor.totalInstalls}, ${input.cursor.firstSeenAt}, ${input.cursor.id}::uuid)`
      : sql`(${periodInstalls}, ${catalogItems.totalInstalls}, ${catalogItems.firstSeenAt}, ${catalogItems.id}) < (${input.cursor.installs}, ${input.cursor.totalInstalls}, ${input.cursor.firstSeenAt}, ${input.cursor.id}::uuid)`
    : undefined;

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
      installs: periodInstalls,
    })
    .from(catalogItems)
    .leftJoin(
      periodTable,
      and(eq(periodTable.itemId, catalogItems.id), eq(periodColumn, periodStart)),
    )
    .where(combineFilters([baseWhere, cursorFilter]))
    .orderBy(
      ...(useEntityGrouping ? [desc(ENTITY_SORT_ORDER)] : []),
      desc(periodInstalls),
      desc(catalogItems.totalInstalls),
      desc(catalogItems.firstSeenAt),
      desc(catalogItems.id),
    )
    .limit(rowLimit);

  const pageRows = rows.slice(0, limit) as LeaderboardRow[];
  const nextCursor =
    rows.length > limit
      ? encodeLeaderboardCursor(toCursor(pageRows[pageRows.length - 1] as LeaderboardRow))
      : null;

  return {
    rows: pageRows,
    nextCursor,
  };
}

export async function getLeaderboard(input: {
  period: LeaderboardPeriod;
  entity: CatalogEntityType | "all";
  q?: string;
  limit?: number;
}): Promise<LeaderboardRow[]> {
  const page = await getLeaderboardPage(input);
  return page.rows;
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

function getEntitySortValue(entityType: CatalogEntityType): number {
  if (entityType === "agent") return 4;
  if (entityType === "skill") return 3;
  if (entityType === "command") return 2;
  if (entityType === "mcp") return 1;
  return 0;
}
