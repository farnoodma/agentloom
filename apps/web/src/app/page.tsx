import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import {
  ENTITY_TYPES,
  PERIODS,
  isCatalogEntityType,
  isLeaderboardPeriod,
  type CatalogEntityType,
  type LeaderboardPeriod,
} from "@/lib/catalog";
import { buildInstallCommand } from "@/lib/install";
import { formatHumanDate } from "@/lib/time";
import { getLeaderboard } from "@/server/db/queries";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function getValue(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function withQuery(input: {
  period: LeaderboardPeriod;
  entity: CatalogEntityType | "all";
  q?: string;
}): string {
  const query = new URLSearchParams();
  if (input.period !== "all") {
    query.set("period", input.period);
  }
  if (input.entity !== "all") {
    query.set("entity", input.entity);
  }
  if (input.q && input.q.trim() !== "") {
    query.set("q", input.q.trim());
  }

  const serialized = query.toString();
  return serialized === "" ? "/" : `/?${serialized}`;
}

function formatInstallCount(value: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
  all: "All Time",
  daily: "Trending (24h)",
  monthly: "Monthly",
  weekly: "Weekly",
};

const ENTITY_LABELS: Record<CatalogEntityType | "all", string> = {
  all: "Everything",
  agent: "Agents",
  command: "Commands",
  mcp: "MCP",
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const q = getValue(resolvedSearchParams, "q") ?? "";
  const periodParam = getValue(resolvedSearchParams, "period") ?? "all";
  const entityParam = getValue(resolvedSearchParams, "entity") ?? "all";

  const period: LeaderboardPeriod = isLeaderboardPeriod(periodParam) ? periodParam : "all";
  const entity: CatalogEntityType | "all" =
    entityParam === "all" || isCatalogEntityType(entityParam) ? entityParam : "all";

  const rows = await getLeaderboard({
    period,
    entity,
    q,
    limit: 150,
  });

  const heroCommand =
    rows.length > 0
      ? buildInstallCommand({
          entityType: rows[0].entityType,
          owner: rows[0].owner,
          repo: rows[0].repo,
          displayName: rows[0].displayName,
        })
      : "npx agentloom add owner/repo";

  return (
    <main className="space-y-10">
      <header className="rounded-2xl border border-ink/10 bg-white/75 p-6 shadow-card backdrop-blur md:p-10 dark:border-white/10 dark:bg-black/35">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60 dark:text-white/60">Agentloom Directory</p>
            <h1 className="max-w-2xl text-3xl font-semibold leading-tight md:text-5xl">
              Discover the public ecosystem of Agentloom installs.
            </h1>
            <p className="max-w-2xl text-sm text-ink/70 md:text-base dark:text-white/70">
              Search what teams are importing with <code className="font-mono">agentloom add</code> across
              agents, commands, and MCP servers.
            </p>
          </div>
          <Link
            href="/docs"
            className="inline-flex w-fit items-center rounded-full border border-ink/20 bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink/90 dark:border-white/15 dark:bg-white/90 dark:text-black dark:hover:bg-white"
          >
            Read Docs
          </Link>
        </div>

        <div className="mt-8 rounded-xl border border-ink/10 bg-chalk/80 p-4 card-grid dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <code className="overflow-x-auto font-mono text-xs text-ink md:text-sm dark:text-white">$ {heroCommand}</code>
            <CopyCommand command={heroCommand} />
          </div>
        </div>
      </header>

      <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-5 shadow-card md:p-7 dark:border-white/10 dark:bg-black/30">
        <form className="grid gap-3 md:grid-cols-[1fr_auto]" action="/" method="get">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name, owner, repo"
            className="w-full rounded-lg border border-ink/20 bg-chalk px-4 py-2 text-sm outline-none transition focus:border-ocean dark:border-white/15 dark:bg-white/10 dark:text-white"
          />
          <button
            type="submit"
            className="rounded-lg border border-ocean bg-ocean px-4 py-2 text-sm font-medium text-white transition hover:bg-ocean/90"
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((option) => {
            const active = option === period;
            return (
              <Link
                key={option}
                href={withQuery({ period: option, entity, q })}
                className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition ${
                  active
                    ? "border-ink bg-ink text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-ink/15 bg-chalk text-ink/70 hover:border-ink/30 dark:border-white/15 dark:bg-white/5 dark:text-white/70 dark:hover:border-white/30"
                }`}
              >
                {PERIOD_LABELS[option]}
              </Link>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["all", ...ENTITY_TYPES] as const).map((option) => {
            const active = option === entity;
            return (
              <Link
                key={option}
                href={withQuery({ period, entity: option, q })}
                className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-ember bg-ember text-white"
                    : "border-ink/15 bg-white text-ink/70 hover:border-ink/35 dark:border-white/15 dark:bg-white/5 dark:text-white/70 dark:hover:border-white/30"
                }`}
              >
                {ENTITY_LABELS[option]}
              </Link>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-ink/10 dark:border-white/10">
          <div className="grid grid-cols-[70px_1fr_120px] bg-chalk px-4 py-2 text-xs uppercase tracking-wide text-ink/60 dark:bg-white/10 dark:text-white/70">
            <span>Rank</span>
            <span>Item</span>
            <span className="text-right">{PERIOD_LABELS[period]}</span>
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-ink/70 dark:text-white/70">No records yet. Run agentloom add on GitHub sources to populate the directory.</p>
          ) : (
            <ul>
              {rows.map((row, index) => (
                <li key={row.id}>
                  <Link
                    href={`/${row.owner}/${row.repo}/${row.entityType}/${row.itemSlug}`}
                    className="grid grid-cols-[70px_1fr_120px] items-center gap-3 border-t border-ink/10 px-4 py-3 transition hover:bg-chalk/60 dark:border-white/10 dark:hover:bg-white/5"
                  >
                    <span className="font-mono text-sm text-ink/60 dark:text-white/60">{index + 1}</span>
                    <span>
                      <span className="inline-flex items-center gap-2">
                        <span className="text-sm font-semibold">{row.displayName}</span>
                        <span className="rounded-full border border-ink/15 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink/60 dark:border-white/15 dark:bg-white/10 dark:text-white/70">
                          {row.entityType}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-ink/60 dark:text-white/60">
                        {row.owner}/{row.repo} • First seen {formatHumanDate(row.firstSeenAt)}
                      </span>
                    </span>
                    <span className="text-right font-mono text-sm text-ink dark:text-white">{formatInstallCount(row.installs)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
