import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cancel, isCancel, select } from "@clack/prompts";
import type { Scope, ScopePaths } from "../types.js";
import { getGlobalSettingsPath, readSettings } from "./settings.js";

export interface ScopeResolutionOptions {
  cwd: string;
  global?: boolean;
  local?: boolean;
  interactive?: boolean;
}

export function buildScopePaths(
  cwd: string,
  scope: Scope,
  homeDir = os.homedir(),
): ScopePaths {
  const workspaceRoot = cwd;
  const agentsRoot =
    scope === "local"
      ? path.join(workspaceRoot, ".agents")
      : path.join(homeDir, ".agents");

  return {
    scope,
    workspaceRoot,
    homeDir,
    agentsRoot,
    agentsDir: path.join(agentsRoot, "agents"),
    commandsDir: path.join(agentsRoot, "commands"),
    skillsDir: path.join(agentsRoot, "skills"),
    mcpPath: path.join(agentsRoot, "mcp.json"),
    lockPath: path.join(agentsRoot, "agents.lock.json"),
    settingsPath: path.join(agentsRoot, "settings.local.json"),
    manifestPath: path.join(agentsRoot, ".sync-manifest.json"),
  };
}

export async function resolveScope(
  options: ScopeResolutionOptions,
): Promise<ScopePaths> {
  const { cwd } = options;

  if (options.global && options.local) {
    throw new Error("Use either --global or --local, not both.");
  }

  if (options.global) return buildScopePaths(cwd, "global");
  if (options.local) return buildScopePaths(cwd, "local");

  const interactive =
    options.interactive ?? (process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    return buildScopePaths(cwd, "global");
  }

  const hasLocalAgents = fs.existsSync(path.join(cwd, ".agents"));

  const globalSettings = readSettings(getGlobalSettingsPath());
  const defaultScope =
    globalSettings.lastScope === "local" ? "local" : "global";

  const selected = await select({
    message: "Choose scope for this command",
    options: [
      {
        value: "local",
        label: ".agents in this repository",
        hint: hasLocalAgents
          ? defaultScope === "local"
            ? "default"
            : undefined
          : defaultScope === "local"
            ? "default (creates .agents)"
            : "creates .agents",
      },
      {
        value: "global",
        label: "~/.agents shared config",
        hint: defaultScope === "global" ? "default" : undefined,
      },
    ],
    initialValue: defaultScope,
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return buildScopePaths(cwd, selected as Scope);
}
