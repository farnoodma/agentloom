CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "catalog_items_leaderboard_rank"
  ON "catalog_items" ("total_installs", "first_seen_at");

CREATE INDEX IF NOT EXISTS "catalog_items_entity_leaderboard_rank"
  ON "catalog_items" ("entity_type", "total_installs", "first_seen_at");

CREATE INDEX IF NOT EXISTS "catalog_items_display_name_trgm"
  ON "catalog_items" USING gin ("display_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "catalog_items_item_slug_trgm"
  ON "catalog_items" USING gin ("item_slug" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "catalog_items_owner_trgm"
  ON "catalog_items" USING gin ("owner" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "catalog_items_repo_trgm"
  ON "catalog_items" USING gin ("repo" gin_trgm_ops);
