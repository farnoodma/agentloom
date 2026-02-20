import type { ParsedArgs } from "minimist";
import { importSource, NonInteractiveConflictError } from "../core/importer.js";
import { resolveScope } from "../core/scope.js";
import { updateLastScope } from "../core/settings.js";
import { parseProvidersFlag } from "../core/argv.js";
import { formatUsageError, getAddHelpText } from "../core/copy.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";

export async function runAddCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getAddHelpText());
    return;
  }

  const source = argv._[1];
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error(
      formatUsageError({
        issue: "Missing required <source>.",
        usage:
          "dotagents add <source> [--ref <ref>] [--subdir <path>] [options]",
        example: "dotagents add vercel-labs/skills --subdir skills",
      }),
    );
  }

  const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);

  const paths = await resolveScope({
    cwd,
    global: Boolean(argv.global),
    local: Boolean(argv.local),
    interactive: !nonInteractive,
  });

  try {
    const summary = await importSource({
      source,
      ref: typeof argv.ref === "string" ? argv.ref : undefined,
      subdir: typeof argv.subdir === "string" ? argv.subdir : undefined,
      rename: typeof argv.rename === "string" ? argv.rename : undefined,
      yes: Boolean(argv.yes),
      nonInteractive,
      paths,
    });

    console.log(`Imported source: ${summary.source}`);
    console.log(`Source type: ${summary.sourceType}`);
    console.log(`Resolved commit: ${summary.resolvedCommit}`);
    console.log(`Imported agents: ${summary.importedAgents.length}`);
    console.log(`Imported MCP servers: ${summary.importedMcpServers.length}`);

    updateLastScope(paths.settingsPath, paths.scope);

    if (!argv["no-sync"]) {
      const syncSummary = await syncFromCanonical({
        paths,
        providers: parseProvidersFlag(argv.providers),
        yes: Boolean(argv.yes),
        nonInteractive,
        dryRun: Boolean(argv["dry-run"]),
      });
      console.log("");
      console.log(formatSyncSummary(syncSummary, paths.agentsRoot));
    }
  } catch (err) {
    if (err instanceof NonInteractiveConflictError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}
