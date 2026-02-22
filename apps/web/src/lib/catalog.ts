export const ENTITY_TYPES = ["agent", "skill", "command", "mcp"] as const;
export type CatalogEntityType = (typeof ENTITY_TYPES)[number];

export const PERIODS = ["all", "daily", "monthly", "weekly"] as const;
export type LeaderboardPeriod = (typeof PERIODS)[number];

export function isCatalogEntityType(value: string): value is CatalogEntityType {
  return ENTITY_TYPES.includes(value as CatalogEntityType);
}

export function isLeaderboardPeriod(value: string): value is LeaderboardPeriod {
  return PERIODS.includes(value as LeaderboardPeriod);
}
