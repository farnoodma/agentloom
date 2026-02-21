import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getUtcDayStart, getUtcMonthStart, getUtcWeekStart } from "@/lib/time";
import { getDb } from "@/server/db/client";
import {
  catalogItems,
  ingestEvents,
  installCountsDaily,
  installCountsMonthly,
  installCountsWeekly,
  telemetryRateLimits,
} from "@/server/db/schema";
import { hashActor, minuteBucket } from "@/server/telemetry/hash";
import { type InstallEventItem, type InstallEventPayload } from "@/server/telemetry/types";

const MAX_EVENTS_PER_MINUTE = 150;

interface IngestContext {
  ip: string;
  userAgent: string;
}

function normalizeItemSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function buildSourceUrl(owner: string, repo: string, filePath: string): string {
  const normalized = filePath.replace(/^\/+/, "");
  if (!normalized) {
    return `https://github.com/${owner}/${repo}`;
  }
  return `https://github.com/${owner}/${repo}/blob/HEAD/${normalized}`;
}

function dedupeItems(items: InstallEventItem[]): InstallEventItem[] {
  const map = new Map<string, InstallEventItem>();
  for (const item of items) {
    const key = `${item.entityType}::${item.name}::${item.filePath}`;
    map.set(key, item);
  }
  return [...map.values()];
}

async function incrementRateBucket(actorHash: string, now: Date): Promise<number> {
  const db = getDb();
  if (!db) {
    return 0;
  }

  const bucketStart = minuteBucket(now);
  const rows = await db
    .insert(telemetryRateLimits)
    .values({
      actorHash,
      bucketStart,
      eventCount: 1,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [telemetryRateLimits.actorHash, telemetryRateLimits.bucketStart],
      set: {
        eventCount: sql`${telemetryRateLimits.eventCount} + 1`,
        lastSeenAt: now,
      },
    })
    .returning({ eventCount: telemetryRateLimits.eventCount });

  return rows[0]?.eventCount ?? 0;
}

export async function recordInstallEvent(input: {
  payload: InstallEventPayload;
  context: IngestContext;
}): Promise<{ accepted: boolean; ignoredReason?: string; duplicate?: boolean }> {
  const db = getDb();
  if (!db) {
    return { accepted: false, ignoredReason: "database_unavailable" };
  }

  const salt = process.env.TELEMETRY_HASH_SALT?.trim();
  if (!salt) {
    return { accepted: false, ignoredReason: "missing_telemetry_salt" };
  }

  const now = new Date();
  const actorHash = hashActor({
    ip: input.context.ip || "unknown",
    userAgent: input.context.userAgent || "unknown",
    salt,
  });

  const eventCount = await incrementRateBucket(actorHash, now);
  if (eventCount > MAX_EVENTS_PER_MINUTE) {
    return { accepted: false, ignoredReason: "rate_limited" };
  }

  const payload = {
    ...input.payload,
    items: dedupeItems(input.payload.items),
  };

  const dayStart = getUtcDayStart(now);
  const weekStart = getUtcWeekStart(now);
  const monthStart = getUtcMonthStart(now);

  const result = await db.transaction(async (tx) => {
    const insertedEvent = await tx
      .insert(ingestEvents)
      .values({
        eventId: payload.eventId || randomUUID(),
        sourceOwner: payload.source.owner,
        sourceRepo: payload.source.repo,
        payload,
        occurredAt: new Date(payload.occurredAt),
        receivedAt: now,
      })
      .onConflictDoNothing()
      .returning({ eventId: ingestEvents.eventId });

    if (insertedEvent.length === 0) {
      return { duplicate: true };
    }

    for (const item of payload.items) {
      const normalizedPath = item.filePath.replace(/^\/+/, "");
      const itemSlug = normalizeItemSlug(item.name);
      const sourceUrl = buildSourceUrl(payload.source.owner, payload.source.repo, normalizedPath);

      const upserted = await tx
        .insert(catalogItems)
        .values({
          entityType: item.entityType,
          owner: payload.source.owner,
          repo: payload.source.repo,
          itemSlug,
          displayName: item.name,
          sourceFilePath: normalizedPath,
          sourceUrl,
          firstSeenAt: now,
          lastSeenAt: now,
          totalInstalls: 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            catalogItems.entityType,
            catalogItems.owner,
            catalogItems.repo,
            catalogItems.itemSlug,
          ],
          set: {
            displayName: item.name,
            sourceFilePath: normalizedPath,
            sourceUrl,
            lastSeenAt: now,
            totalInstalls: sql`${catalogItems.totalInstalls} + 1`,
            updatedAt: now,
          },
        })
        .returning({ id: catalogItems.id });

      const itemId = upserted[0]?.id;
      if (!itemId) {
        continue;
      }

      await tx
        .insert(installCountsDaily)
        .values({ itemId, dayStart, installs: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: [installCountsDaily.itemId, installCountsDaily.dayStart],
          set: {
            installs: sql`${installCountsDaily.installs} + 1`,
            updatedAt: now,
          },
        });

      await tx
        .insert(installCountsWeekly)
        .values({ itemId, weekStart, installs: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: [installCountsWeekly.itemId, installCountsWeekly.weekStart],
          set: {
            installs: sql`${installCountsWeekly.installs} + 1`,
            updatedAt: now,
          },
        });

      await tx
        .insert(installCountsMonthly)
        .values({ itemId, monthStart, installs: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: [installCountsMonthly.itemId, installCountsMonthly.monthStart],
          set: {
            installs: sql`${installCountsMonthly.installs} + 1`,
            updatedAt: now,
          },
        });
    }

    return { duplicate: false };
  });

  if (result.duplicate) {
    return { accepted: true, duplicate: true };
  }

  return { accepted: true };
}

export async function findCatalogByExactKey(input: {
  owner: string;
  repo: string;
  entityType: InstallEventItem["entityType"];
  itemSlug: string;
}) {
  const db = getDb();
  if (!db) {
    return null;
  }

  const rows = await db
    .select()
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.owner, input.owner),
        eq(catalogItems.repo, input.repo),
        eq(catalogItems.entityType, input.entityType),
        eq(catalogItems.itemSlug, input.itemSlug),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
