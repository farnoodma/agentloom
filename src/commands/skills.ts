import type { ParsedArgs } from "minimist";
import { formatUsageError } from "../core/copy.js";
import { runSkillsCommand } from "../core/skills.js";
import { runScopedAddCommand } from "./add.js";
import { runScopedDeleteCommand } from "./delete.js";
import { resolvePathsForCommand } from "./entity-utils.js";
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

  if (action === "delete") {
    await runScopedDeleteCommand({
      argv,
      cwd,
      entity: "skill",
      sourceIndex: 2,
    });
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

  if (action === "sync") {
    const paths = await resolvePathsForCommand(argv, cwd);
    const args = ["experimental_sync", "--yes"];
    if (paths.scope === "global") {
      args.push("--global");
    }
    runSkillsCommand({ args, cwd: paths.workspaceRoot, inheritStdio: true });
    return;
  }

  const passthrough = action === "list" ? "list" : "find";
  const args = [passthrough, ...argv._.slice(2).map((item) => String(item))];

  const paths = await resolvePathsForCommand(argv, cwd);
  if (paths.scope === "global") {
    args.push("--global");
  }

  runSkillsCommand({
    args,
    cwd: paths.workspaceRoot,
    inheritStdio: true,
  });
}
