DROP INDEX IF EXISTS "catalog_items_leaderboard_rank";
DROP INDEX IF EXISTS "catalog_items_entity_leaderboard_rank";

CREATE INDEX IF NOT EXISTS "catalog_items_leaderboard_rank"
  ON "catalog_items" ("total_installs", "first_seen_at", "id");

CREATE INDEX IF NOT EXISTS "catalog_items_entity_leaderboard_rank"
  ON "catalog_items" ("entity_type", "total_installs", "first_seen_at", "id");
