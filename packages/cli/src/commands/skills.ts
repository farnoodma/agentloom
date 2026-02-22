import path from "node:path";
import type { ParsedArgs } from "minimist";
import { parseProvidersFlag } from "../core/argv.js";
import { formatUsageError } from "../core/copy.js";
import {
  applySkillProviderSideEffects,
  parseSkillsDir,
} from "../core/skills.js";
import {
  formatSyncSummary,
  resolveProvidersForSync,
  syncFromCanonical,
} from "../sync/index.js";
import { runScopedAddCommand } from "./add.js";
import { runScopedDeleteCommand } from "./delete.js";
import {
  getNonInteractiveMode,
  resolvePathsForCommand,
} from "./entity-utils.js";
import { runScopedFindCommand } from "./find.js";
import { runScopedUpdateCommand } from "./update.js";

export async function runSkillCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  const action = argv._[1];

  if (argv.help || !action) {
    console.log(
      "Usage:\n  agentloom skill <add|list|delete|find|update|sync> [options]",
    );
    return;
  }

  if (
    action !== "add" &&
    action !== "list" &&
    action !== "delete" &&
    action !== "find" &&
    action !== "update" &&
    action !== "sync"
  ) {
    throw new Error(
      formatUsageError({
        issue: "Invalid skill command.",
        usage: "agentloom skill <add|list|delete|find|update|sync> [options]",
        example: "agentloom skill add farnoodma/agents",
      }),
    );
  }

  if (action === "add") {
    await runScopedAddCommand({
      argv,
      cwd,
      entity: "skill",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "list") {
    const paths = await resolvePathsForCommand(argv, cwd);
    const skills = parseSkillsDir(paths.skillsDir);

    if (Boolean(argv.json)) {
      console.log(
        JSON.stringify(
          {
            version: 1,
            skills: skills.map((skill) => ({
              name: skill.name,
              directory: path.basename(skill.sourcePath),
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (skills.length === 0) {
      console.log("No canonical skills configured.");
      return;
    }

    for (const skill of skills) {
      console.log(`${skill.name} (${path.basename(skill.sourcePath)})`);
    }
    return;
  }

  if (action === "delete") {
    await runScopedDeleteCommand({
      argv,
      cwd,
      entity: "skill",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "find") {
    await runScopedFindCommand(argv, "skill");
    return;
  }

  if (action === "update") {
    await runScopedUpdateCommand({
      argv,
      cwd,
      entity: "skill",
      sourceIndex: 2,
    });
    return;
  }

  const paths = await resolvePathsForCommand(argv, cwd);
  const nonInteractive = getNonInteractiveMode(argv);
  const explicitProviders = parseProvidersFlag(argv.providers);
  const providers = await resolveProvidersForSync({
    paths,
    explicitProviders,
    nonInteractive,
  });

  applySkillProviderSideEffects({
    paths,
    providers,
    dryRun: Boolean(argv["dry-run"]),
    warn(message) {
      console.warn(`Warning: ${message}`);
    },
  });

  const summary = await syncFromCanonical({
    paths,
    providers,
    yes: Boolean(argv.yes),
    nonInteractive,
    dryRun: Boolean(argv["dry-run"]),
    target: "skill",
  });

  console.log(formatSyncSummary(summary, paths.agentsRoot));
}
