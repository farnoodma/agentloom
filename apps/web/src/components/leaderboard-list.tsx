"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CatalogEntityType, type LeaderboardPeriod } from "@/lib/catalog";
import {
  DEFAULT_LEADERBOARD_PAGE_SIZE,
  type LeaderboardListResponse,
  type LeaderboardListRow,
} from "@/lib/leaderboard";
import { formatHumanDate } from "@/lib/time";

interface LeaderboardListProps {
  period: LeaderboardPeriod;
  entity: CatalogEntityType | "all";
  q: string;
  periodLabel: string;
  initialRows: LeaderboardListRow[];
  initialNextCursor: string | null;
}

function formatInstallCount(value: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

function buildLeaderboardApiUrl(input: {
  period: LeaderboardPeriod;
  entity: CatalogEntityType | "all";
  q: string;
  cursor: string;
}): string {
  const query = new URLSearchParams();
  query.set("limit", String(DEFAULT_LEADERBOARD_PAGE_SIZE));

  if (input.period !== "all") {
    query.set("period", input.period);
  }

  if (input.entity !== "all") {
    query.set("entity", input.entity);
  }

  if (input.q.trim() !== "") {
    query.set("q", input.q.trim());
  }

  query.set("cursor", input.cursor);
  return `/api/v1/leaderboard?${query.toString()}`;
}

export function LeaderboardList({
  period,
  entity,
  q,
  periodLabel,
  initialRows,
  initialNextCursor,
}: LeaderboardListProps) {
  const [rows, setRows] = useState<LeaderboardListRow[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    setRows(initialRows);
    setNextCursor(initialNextCursor);
    setLoading(false);
    setErrorMessage(null);
    loadingRef.current = false;
  }, [initialRows, initialNextCursor]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor;
    if (!cursor || loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        buildLeaderboardApiUrl({
          period,
          entity,
          q,
          cursor,
        }),
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }

      const payload = (await response.json()) as LeaderboardListResponse;
      setRows((previousRows) => {
        if (payload.rows.length === 0) {
          return previousRows;
        }

        const seenIds = new Set(previousRows.map((row) => row.id));
        const appendedRows = payload.rows.filter((row) => !seenIds.has(row.id));
        return [...previousRows, ...appendedRows];
      });
      setNextCursor(payload.nextCursor ?? null);
    } catch {
      setErrorMessage("Could not load more rows. Scroll to retry.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [entity, nextCursor, period, q]);

  useEffect(() => {
    if (!nextCursor) {
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      {
        rootMargin: "500px 0px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  const footerLabel = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }

    if (loading) {
      return "Loading more...";
    }

    if (nextCursor) {
      return "Scroll to load more";
    }

    return "End of results";
  }, [loading, nextCursor, rows.length]);

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 dark:border-white/10">
      <div className="grid grid-cols-[70px_1fr_120px] bg-chalk px-4 py-2 text-xs uppercase tracking-wide text-ink/60 dark:bg-white/10 dark:text-white/70">
        <span>Rank</span>
        <span>Item</span>
        <span className="text-right">{periodLabel}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-ink/70 dark:text-white/70">
          No records yet. Run agentloom add on GitHub sources to populate the
          directory.
        </p>
      ) : (
        <>
          <ul>
            {rows.map((row, index) => (
              <li key={row.id}>
                <Link
                  href={`/${row.owner}/${row.repo}/${row.entityType}/${row.itemSlug}`}
                  className="grid grid-cols-[70px_1fr_120px] items-center gap-3 border-t border-ink/10 px-4 py-3 transition hover:bg-chalk/60 dark:border-white/10 dark:hover:bg-white/5"
                >
                  <span className="font-mono text-sm text-ink/60 dark:text-white/60">
                    {index + 1}
                  </span>
                  <span>
                    <span className="inline-flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {row.displayName}
                      </span>
                      <span className="rounded-full border border-ink/15 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink/60 dark:border-white/15 dark:bg-white/10 dark:text-white/70">
                        {row.entityType}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-ink/60 dark:text-white/60">
                      {row.owner}/{row.repo} • First seen{" "}
                      {formatHumanDate(row.firstSeenAt)}
                    </span>
                  </span>
                  <span className="text-right font-mono text-sm text-ink dark:text-white">
                    {formatInstallCount(row.installs)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div
            ref={sentinelRef}
            className="border-t border-ink/10 px-4 py-3 text-center text-xs text-ink/60 dark:border-white/10 dark:text-white/60"
          >
            {footerLabel}
          </div>
          {errorMessage ? (
            <p className="px-4 pb-4 text-center text-xs text-ember">
              {errorMessage}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
