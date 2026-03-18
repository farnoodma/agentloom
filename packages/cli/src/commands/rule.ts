import type { ParsedArgs } from "minimist";
import { formatUsageError } from "../core/copy.js";
import { parseRulesDir } from "../core/rules.js";
import { runScopedAddCommand } from "./add.js";
import { runScopedDeleteCommand } from "./delete.js";
import { resolvePathsForCommand } from "./entity-utils.js";
import { runScopedFindCommand } from "./find.js";
import { runScopedSyncCommand } from "./sync.js";
import { runScopedUpdateCommand } from "./update.js";

export async function runRuleCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  const rawAction = argv._[1];
  const action = rawAction === "remove" ? "delete" : rawAction;

  if (argv.help || !action) {
    console.log(
      "Usage:\n  agentloom rule <add|list|delete|find|update|sync> [options]",
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
        issue: "Invalid rule command.",
        usage: "agentloom rule <add|list|delete|find|update|sync> [options]",
        example: "agentloom rule add farnoodma/agents",
      }),
    );
  }

  if (action === "list") {
    const paths = await resolvePathsForCommand(argv, cwd);
    const rules = parseRulesDir(paths.rulesDir);

    if (Boolean(argv.json)) {
      console.log(
        JSON.stringify(
          {
            version: 1,
            rules: rules.map((rule) => ({
              id: rule.id,
              name: rule.name,
              fileName: rule.fileName,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (rules.length === 0) {
      console.log("No canonical rules configured.");
      return;
    }

    for (const rule of rules) {
      console.log(`${rule.name} (${rule.fileName})`);
    }
    return;
  }

  if (action === "add") {
    await runScopedAddCommand({
      argv,
      cwd,
      entity: "rule",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "delete") {
    await runScopedDeleteCommand({
      argv,
      cwd,
      entity: "rule",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "find") {
    await runScopedFindCommand(argv, "rule");
    return;
  }

  if (action === "update") {
    await runScopedUpdateCommand({
      argv,
      cwd,
      entity: "rule",
      sourceIndex: 2,
    });
    return;
  }

  await runScopedSyncCommand({
    argv,
    cwd,
    target: "rule",
  });
}
