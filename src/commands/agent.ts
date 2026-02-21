import type { ParsedArgs } from "minimist";
import { parseAgentsDir } from "../core/agents.js";
import { formatUsageError } from "../core/copy.js";
import { runScopedAddCommand } from "./add.js";
import { runScopedDeleteCommand } from "./delete.js";
import { resolvePathsForCommand } from "./entity-utils.js";
import { runScopedFindCommand } from "./find.js";
import { runScopedSyncCommand } from "./sync.js";
import { runScopedUpdateCommand } from "./update.js";

export async function runAgentCommand(
  argv: ParsedArgs,
  cwd: string,
): Promise<void> {
  const action = argv._[1];

  if (argv.help || !action) {
    console.log(
      "Usage:\n  agentloom agent <add|list|delete|find|update|sync> [options]",
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
        issue: "Invalid agent command.",
        usage: "agentloom agent <add|list|delete|find|update|sync> [options]",
        example: "agentloom agent add farnoodma/agents",
      }),
    );
  }

  if (action === "list") {
    const paths = await resolvePathsForCommand(argv, cwd);
    const agents = parseAgentsDir(paths.agentsDir);

    if (Boolean(argv.json)) {
      console.log(
        JSON.stringify(
          {
            version: 1,
            agents: agents.map((agent) => ({
              name: agent.name,
              fileName: agent.fileName,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (agents.length === 0) {
      console.log("No canonical agents configured.");
      return;
    }

    for (const agent of agents) {
      console.log(`${agent.name} (${agent.fileName})`);
    }
    return;
  }

  if (action === "add") {
    await runScopedAddCommand({
      argv,
      cwd,
      entity: "agent",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "delete") {
    await runScopedDeleteCommand({
      argv,
      cwd,
      entity: "agent",
      sourceIndex: 2,
    });
    return;
  }

  if (action === "find") {
    await runScopedFindCommand(argv, "agent");
    return;
  }

  if (action === "update") {
    await runScopedUpdateCommand({
      argv,
      cwd,
      entity: "agent",
      sourceIndex: 2,
    });
    return;
  }

  await runScopedSyncCommand({
    argv,
    cwd,
    target: "agent",
  });
}
