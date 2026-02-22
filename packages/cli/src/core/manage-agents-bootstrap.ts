import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";

const SKIP_COMMANDS = new Set([
  "help",
  "--help",
  "-h",
  "version",
  "--version",
  "-v",
]);

export function getGlobalManageAgentsSkillPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".agents", "skills", "manage-agents", "SKILL.md");
}

export async function maybePromptManageAgentsBootstrap(options: {
  command: string;
  help: boolean;
  yes: boolean;
  homeDir?: string;
  interactive?: boolean;
}): Promise<boolean> {
  if (process.env.AGENTLOOM_DISABLE_MANAGE_AGENTS_PROMPT === "1") return false;

  const interactive =
    options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive || options.help || options.yes) return false;

  const loweredCommand = options.command.trim().toLowerCase();
  if (SKIP_COMMANDS.has(loweredCommand)) return false;

  const globalSkillPath = getGlobalManageAgentsSkillPath(options.homeDir);
  if (fs.existsSync(globalSkillPath)) return false;

  const accepted = await confirm({
    message:
      'Global skill "manage-agents" is missing. It helps agents reliably manage Agentloom resources (find/create/import/update/sync/delete). Install it now?',
    initialValue: true,
  });

  if (isCancel(accepted) || accepted !== true) return false;
  return true;
}
