import {
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    itemSlug: text("item_slug").notNull(),
    displayName: text("display_name").notNull(),
    sourceFilePath: text("source_file_path").notNull(),
    sourceUrl: text("source_url").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    totalInstalls: integer("total_installs").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    itemKey: uniqueIndex("catalog_items_item_key").on(
      table.entityType,
      table.owner,
      table.repo,
      table.itemSlug,
    ),
  }),
);

export const installCountsWeekly = pgTable(
  "install_counts_weekly",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    installs: integer("installs").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.itemId, table.weekStart], name: "install_counts_weekly_pk" }),
  }),
);

export const installCountsDaily = pgTable(
  "install_counts_daily",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    dayStart: date("day_start").notNull(),
    installs: integer("installs").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.itemId, table.dayStart], name: "install_counts_daily_pk" }),
  }),
);

export const installCountsMonthly = pgTable(
  "install_counts_monthly",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    monthStart: date("month_start").notNull(),
    installs: integer("installs").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.itemId, table.monthStart], name: "install_counts_monthly_pk" }),
  }),
);

export const ingestEvents = pgTable("ingest_events", {
  eventId: text("event_id").primaryKey(),
  sourceOwner: text("source_owner").notNull(),
  sourceRepo: text("source_repo").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

export const telemetryRateLimits = pgTable(
  "telemetry_rate_limits",
  {
    actorHash: text("actor_hash").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    eventCount: integer("event_count").default(0).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.actorHash, table.bucketStart], name: "telemetry_rate_limits_pk" }),
  }),
);

export type CatalogItem = typeof catalogItems.$inferSelect;
