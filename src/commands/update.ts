import type { ParsedArgs } from "minimist";
import { importSource, NonInteractiveConflictError } from "../core/importer.js";
import { readLockfile } from "../core/lockfile.js";
import { resolveScope } from "../core/scope.js";
import { prepareSource } from "../core/sources.js";
import { parseProvidersFlag } from "../core/argv.js";
import { getUpdateHelpText } from "../core/copy.js";
import { formatSyncSummary, syncFromCanonical } from "../sync/index.js";

export async function runUpdateCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  if (argv.help) {
    console.log(getUpdateHelpText());
    return;
  }

  const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY);

  const paths = await resolveScope({
    cwd,
    global: Boolean(argv.global),
    local: Boolean(argv.local),
    interactive: !nonInteractive,
  });

  const lockfile = readLockfile(paths);
  if (lockfile.entries.length === 0) {
    console.log(`No lock entries found in ${paths.lockPath}.`);
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const entry of lockfile.entries) {
    const probe = prepareSource({
      source: entry.source,
      ref: entry.requestedRef,
      subdir: entry.subdir,
    });

    const hasNewCommit = probe.resolvedCommit !== entry.resolvedCommit;
    probe.cleanup();

    if (!hasNewCommit) {
      skipped += 1;
      continue;
    }

    try {
      await importSource({
        source: entry.source,
        ref: entry.requestedRef,
        subdir: entry.subdir,
        yes: Boolean(argv.yes),
        nonInteractive,
        paths,
      });
      updated += 1;
    } catch (err) {
      if (err instanceof NonInteractiveConflictError) {
        console.error(err.message);
        process.exit(2);
      }
      throw err;
    }
  }

  console.log(`Updated entries: ${updated}`);
  console.log(`Unchanged entries: ${skipped}`);

  if (updated > 0 && !argv["no-sync"]) {
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
}
