import Link from "next/link";

export default function DocsPage() {
  return (
    <main className="space-y-6">
      <header className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60 dark:text-white/60">Agentloom Docs</p>
        <h1 className="mt-3 text-3xl font-semibold md:text-4xl">Install, publish, and track Agentloom ecosystems.</h1>
        <p className="mt-3 max-w-2xl text-sm text-ink/70 dark:text-white/70">
          The directory is powered by anonymous telemetry from successful GitHub-based
          <code className="font-mono"> agentloom add </code>
          commands.
        </p>
      </header>

      <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
        <h2 className="text-xl font-semibold">Quickstart</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink/80 dark:text-white/80">
          <li>Install or run the CLI: <code className="font-mono">npx agentloom --help</code></li>
          <li>Add a GitHub source: <code className="font-mono">npx agentloom add &lt;owner/repo&gt;</code></li>
          <li>Browse discovered entities from the directory leaderboard.</li>
        </ol>
      </section>

      <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card md:p-8 dark:border-white/10 dark:bg-black/30">
        <h2 className="text-xl font-semibold">Telemetry</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink/80 dark:text-white/80">
          <li>Only GitHub sources are tracked.</li>
          <li>Local path imports are not tracked.</li>
          <li>Tracked entities include agents, skills, commands, and MCP servers.</li>
          <li>You can opt out by setting <code className="font-mono">AGENTLOOM_DISABLE_TELEMETRY=1</code>.</li>
        </ul>
      </section>

      <div className="text-sm text-ink/60 dark:text-white/60">
        <Link href="/" className="underline underline-offset-4">
          Back to leaderboard
        </Link>
      </div>
    </main>
  );
}
