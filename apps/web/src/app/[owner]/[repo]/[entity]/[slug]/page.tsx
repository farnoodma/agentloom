import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyCommand } from "@/components/copy-command";
import { isCatalogEntityType } from "@/lib/catalog";
import { parseMarkdownSource } from "@/lib/frontmatter";
import { buildInstallCommand } from "@/lib/install";
import { formatHumanDate } from "@/lib/time";
import { getItemDetail } from "@/server/db/queries";
import { fetchGithubSourceDocument } from "@/server/github/content";

export const dynamic = "force-dynamic";

interface DetailPageProps {
  params: Promise<{
    owner: string;
    repo: string;
    entity: string;
    slug: string;
  }>;
}

function prettyEntity(value: string): string {
  if (value === "mcp") {
    return "MCP";
  }
  return value[0].toUpperCase() + value.slice(1);
}

export default async function DetailPage({ params }: DetailPageProps) {
  const resolved = await params;

  if (!isCatalogEntityType(resolved.entity)) {
    notFound();
  }

  const detail = await getItemDetail({
    owner: resolved.owner,
    repo: resolved.repo,
    entity: resolved.entity,
    slug: resolved.slug,
  });

  if (!detail) {
    notFound();
  }

  const source = await fetchGithubSourceDocument({
    owner: detail.owner,
    repo: detail.repo,
    entityType: detail.entityType,
    slug: detail.itemSlug,
    sourceFilePath: detail.sourceFilePath,
  });

  const installCommand = buildInstallCommand({
    entityType: detail.entityType,
    owner: detail.owner,
    repo: detail.repo,
    displayName: detail.displayName,
  });
  const parsedMarkdown =
    source && source.resolvedPath.endsWith(".md")
      ? parseMarkdownSource(source.content)
      : null;

  return (
    <main className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-ink/60 hover:text-ink dark:text-white/60 dark:hover:text-white">
        ← Back to leaderboard
      </Link>

      <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60 dark:text-white/60">
              {detail.owner}/{detail.repo}
            </p>
            <h1 className="mt-2 text-3xl font-semibold md:text-4xl">{detail.displayName}</h1>
            <p className="mt-2 text-sm text-ink/70 dark:text-white/70">
              {prettyEntity(detail.entityType)} • First seen {formatHumanDate(detail.firstSeenAt)}
            </p>
          </div>
          <a
            href={detail.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-ink/20 px-4 py-2 text-xs font-medium uppercase tracking-wide hover:border-ocean dark:border-white/15 dark:hover:border-ocean"
          >
            View Source
          </a>
        </div>

        <div className="mt-6 rounded-xl border border-ink/10 bg-chalk p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <code className="min-w-0 overflow-x-auto font-mono text-xs text-ink md:text-sm dark:text-white">$ {installCommand}</code>
            <CopyCommand command={installCommand} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-3 rounded-2xl border border-ink/10 bg-white p-5 shadow-card dark:border-white/10 dark:bg-black/30">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/70 dark:text-white/70">Install Stats</h2>
          <dl className="space-y-3 text-sm">
            <div className="rounded-lg border border-ink/10 bg-chalk/60 p-3 dark:border-white/10 dark:bg-white/5">
              <dt className="text-ink/60 dark:text-white/60">All Time</dt>
              <dd className="mt-1 font-mono text-xl">{detail.totalInstalls.toLocaleString("en-US")}</dd>
            </div>
            <div className="rounded-lg border border-ink/10 bg-chalk/60 p-3 dark:border-white/10 dark:bg-white/5">
              <dt className="text-ink/60 dark:text-white/60">24h</dt>
              <dd className="mt-1 font-mono text-xl">{detail.dailyInstalls.toLocaleString("en-US")}</dd>
            </div>
            <div className="rounded-lg border border-ink/10 bg-chalk/60 p-3 dark:border-white/10 dark:bg-white/5">
              <dt className="text-ink/60 dark:text-white/60">Monthly</dt>
              <dd className="mt-1 font-mono text-xl">{detail.monthlyInstalls.toLocaleString("en-US")}</dd>
            </div>
            <div className="rounded-lg border border-ink/10 bg-chalk/60 p-3 dark:border-white/10 dark:bg-white/5">
              <dt className="text-ink/60 dark:text-white/60">Weekly</dt>
              <dd className="mt-1 font-mono text-xl">{detail.weeklyInstalls.toLocaleString("en-US")}</dd>
            </div>
            <div className="break-all text-xs text-ink/60 dark:text-white/60">
              Last seen {formatHumanDate(detail.lastSeenAt)} • Path {detail.sourceFilePath}
            </div>
          </dl>
        </aside>

        <article className="min-w-0 rounded-2xl border border-ink/10 bg-white p-5 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink/70 dark:text-white/70">Source Preview</h2>

          {!source ? (
            <p className="text-sm text-ink/60 dark:text-white/60">
              Source could not be fetched from GitHub yet. The telemetry record exists and will still appear in ranking.
            </p>
          ) : parsedMarkdown ? (
            <div className="prose prose-slate max-w-none break-words prose-pre:max-w-full prose-pre:overflow-x-auto dark:prose-invert">
              {parsedMarkdown.frontmatter.length > 0 ? (
                <section className="not-prose mb-6 rounded-xl border border-ink/10 bg-chalk/70 p-4 dark:border-white/10 dark:bg-white/5">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink/70 dark:text-white/70">
                    Metadata
                  </h3>
                  <dl className="space-y-3">
                    {parsedMarkdown.frontmatter.map((entry, index) => {
                      const isMultiline = entry.value.includes("\n");
                      return (
                        <div key={`${entry.key}-${index}`} className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start">
                          <dt className="break-all font-mono text-[11px] uppercase tracking-[0.08em] text-ink/60 dark:text-white/60">
                            {entry.key}
                          </dt>
                          <dd className="min-w-0 text-sm text-ink dark:text-white">
                            {entry.value.length === 0 ? (
                              <span className="text-ink/50 dark:text-white/50">(empty)</span>
                            ) : isMultiline ? (
                              <pre className="whitespace-pre-wrap break-all rounded border border-ink/10 bg-white/90 p-2 text-xs text-ink dark:border-white/10 dark:bg-black/30 dark:text-white">
                                <code>{entry.value}</code>
                              </pre>
                            ) : (
                              <code className="break-all rounded bg-white/90 px-1.5 py-0.5 text-xs text-ink dark:bg-black/30 dark:text-white">
                                {entry.value}
                              </code>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              ) : null}

              {parsedMarkdown.body.trim().length > 0 ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsedMarkdown.body}</ReactMarkdown>
              ) : (
                <p className="not-prose text-sm text-ink/60 dark:text-white/60">
                  This file only contains frontmatter metadata.
                </p>
              )}
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-lg border border-ink/10 bg-chalk p-4 text-xs text-ink dark:border-white/10 dark:bg-white/5 dark:text-white">
              <code>{source.content}</code>
            </pre>
          )}
        </article>
      </section>
    </main>
  );
}
