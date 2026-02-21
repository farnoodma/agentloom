CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "catalog_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type" text NOT NULL,
  "owner" text NOT NULL,
  "repo" text NOT NULL,
  "item_slug" text NOT NULL,
  "display_name" text NOT NULL,
  "source_file_path" text NOT NULL,
  "source_url" text NOT NULL,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "total_installs" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "catalog_items_item_key"
  ON "catalog_items" ("entity_type", "owner", "repo", "item_slug");

CREATE TABLE IF NOT EXISTS "install_counts_weekly" (
  "item_id" uuid NOT NULL REFERENCES "catalog_items"("id") ON DELETE CASCADE,
  "week_start" date NOT NULL,
  "installs" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "install_counts_weekly_pk" PRIMARY KEY ("item_id", "week_start")
);

CREATE TABLE IF NOT EXISTS "install_counts_monthly" (
  "item_id" uuid NOT NULL REFERENCES "catalog_items"("id") ON DELETE CASCADE,
  "month_start" date NOT NULL,
  "installs" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "install_counts_monthly_pk" PRIMARY KEY ("item_id", "month_start")
);

CREATE TABLE IF NOT EXISTS "ingest_events" (
  "event_id" text PRIMARY KEY,
  "source_owner" text NOT NULL,
  "source_repo" text NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "telemetry_rate_limits" (
  "actor_hash" text NOT NULL,
  "bucket_start" timestamptz NOT NULL,
  "event_count" integer NOT NULL DEFAULT 0,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "telemetry_rate_limits_pk" PRIMARY KEY ("actor_hash", "bucket_start")
);
