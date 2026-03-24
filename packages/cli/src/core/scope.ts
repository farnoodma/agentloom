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

function directoryHasEntries(dirPath: string): boolean {
  return fs.existsSync(dirPath) && fs.readdirSync(dirPath).length > 0;
}

export function hasInitializedCanonicalLayout(
  paths: Pick<
    ScopePaths,
    | "agentsRoot"
    | "agentsDir"
    | "commandsDir"
    | "rulesDir"
    | "skillsDir"
    | "mcpPath"
    | "lockPath"
    | "manifestPath"
  >,
): boolean {
  if (
    !fs.existsSync(paths.agentsRoot) ||
    !fs.statSync(paths.agentsRoot).isDirectory()
  ) {
    return false;
  }

  if (
    fs.existsSync(paths.mcpPath) ||
    fs.existsSync(paths.lockPath) ||
    fs.existsSync(paths.manifestPath)
  ) {
    return true;
  }

  return (
    directoryHasEntries(paths.agentsDir) ||
    directoryHasEntries(paths.commandsDir) ||
    directoryHasEntries(paths.rulesDir) ||
    directoryHasEntries(paths.skillsDir)
  );
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
    rulesDir: path.join(agentsRoot, "rules"),
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

  const hasLocalAgents = fs.existsSync(path.join(cwd, ".agents"));

  const interactive =
    options.interactive ?? (process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    return buildScopePaths(cwd, hasLocalAgents ? "local" : "global");
  }

  const defaultScope = getDefaultScope();
  const selected = await promptForScopeSelection({
    hasLocalAgents,
    defaultScope,
  });

  return buildScopePaths(cwd, selected);
}

export async function resolveScopeForSync(
  options: ScopeResolutionOptions,
): Promise<ScopePaths> {
  const { cwd } = options;

  if (options.global && options.local) {
    throw new Error("Use either --global or --local, not both.");
  }

  if (options.global) return buildScopePaths(cwd, "global");
  if (options.local) return buildScopePaths(cwd, "local");

  const localPaths = buildScopePaths(cwd, "local");
  const globalPaths = buildScopePaths(cwd, "global");
  const hasLocalAgents = fs.existsSync(localPaths.agentsRoot);
  const hasLocalCanonical = hasInitializedCanonicalLayout(localPaths);
  const hasGlobalCanonical = hasInitializedCanonicalLayout(globalPaths);

  const interactive =
    options.interactive ?? (process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    return hasLocalAgents ? localPaths : globalPaths;
  }

  if (hasLocalAgents && hasGlobalCanonical) {
    const selected = await promptForScopeSelection({
      hasLocalAgents: true,
      defaultScope: getDefaultScope(globalPaths.homeDir),
    });
    return buildScopePaths(cwd, selected, globalPaths.homeDir);
  }

  if (hasLocalCanonical) return localPaths;
  if (hasGlobalCanonical) return globalPaths;
  if (hasLocalAgents) return localPaths;

  throw new Error(
    `No initialized canonical .agents state found at ${localPaths.agentsRoot} or ${globalPaths.agentsRoot}.\nRun \`agentloom init --local\` or \`agentloom init --global\` to bootstrap from provider configs first, or use \`agentloom add\` to create canonical content before syncing.`,
  );
}

function getDefaultScope(homeDir = os.homedir()): Scope {
  const globalSettings = readSettings(getGlobalSettingsPath(homeDir));
  return globalSettings.lastScope === "local" ? "local" : "global";
}

async function promptForScopeSelection(options: {
  hasLocalAgents: boolean;
  defaultScope: Scope;
}): Promise<Scope> {
  const selected = await select({
    message: "Choose scope for this command",
    options: [
      {
        value: "local",
        label: ".agents in this repository",
        hint: options.hasLocalAgents
          ? options.defaultScope === "local"
            ? "default"
            : undefined
          : options.defaultScope === "local"
            ? "default (creates .agents)"
            : "creates .agents",
      },
      {
        value: "global",
        label: "~/.agents shared config",
        hint: options.defaultScope === "global" ? "default" : undefined,
      },
    ],
    initialValue: options.defaultScope,
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return selected as Scope;
}
