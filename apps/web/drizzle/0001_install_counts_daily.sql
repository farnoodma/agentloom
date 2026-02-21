CREATE TABLE IF NOT EXISTS "install_counts_daily" (
  "item_id" uuid NOT NULL REFERENCES "catalog_items"("id") ON DELETE CASCADE,
  "day_start" date NOT NULL,
  "installs" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "install_counts_daily_pk" PRIMARY KEY ("item_id", "day_start")
);
