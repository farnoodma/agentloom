import os from "node:os";
import path from "node:path";
import type { Provider, ScopePaths } from "../types.js";

export function getProviderAgentsDir(
  paths: ScopePaths,
  provider: Provider,
): string {
  const workspaceRoot = paths.workspaceRoot;
  const home = paths.homeDir;

  switch (provider) {
    case "cursor":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".cursor", "agents")
        : path.join(home, ".cursor", "agents");
    case "claude":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".claude", "agents")
        : path.join(home, ".claude", "agents");
    case "codex":
      return path.join(getCodexRootDir(paths), "agents");
    case "opencode":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".opencode", "agents")
        : path.join(home, ".config", "opencode", "agents");
    case "gemini":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".gemini", "agents")
        : path.join(home, ".gemini", "agents");
    case "copilot":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".github", "agents")
        : path.join(home, ".vscode", "chatmodes");
    default:
      return path.join(workspaceRoot, ".agents", "unknown");
  }
}

export function getProviderCommandsDir(
  paths: ScopePaths,
  provider: Provider,
): string {
  const workspaceRoot = paths.workspaceRoot;
  const home = paths.homeDir;

  switch (provider) {
    case "cursor":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".cursor", "commands")
        : path.join(home, ".cursor", "commands");
    case "claude":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".claude", "commands")
        : path.join(home, ".claude", "commands");
    case "codex":
      return getCodexPromptsDir(paths);
    case "opencode":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".opencode", "commands")
        : path.join(home, ".config", "opencode", "commands");
    case "gemini":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".gemini", "commands")
        : path.join(home, ".gemini", "commands");
    case "copilot":
      return paths.scope === "local"
        ? path.join(workspaceRoot, ".github", "prompts")
        : path.join(home, ".github", "prompts");
    default:
      return path.join(workspaceRoot, ".agents", "unknown", "commands");
  }
}

export function getProviderSkillsPaths(
  paths: ScopePaths,
  providers: Provider[],
): string[] {
  const targets = new Set<string>();
  const hasClaudeStyleProvider =
    providers.includes("claude") || providers.includes("copilot");

  if (hasClaudeStyleProvider) {
    targets.add(
      paths.scope === "local"
        ? path.join(paths.workspaceRoot, ".claude", "skills")
        : path.join(paths.homeDir, ".claude", "skills"),
    );
  }

  if (providers.includes("cursor")) {
    targets.add(
      paths.scope === "local"
        ? path.join(paths.workspaceRoot, ".cursor", "skills")
        : path.join(paths.homeDir, ".cursor", "skills"),
    );
  }

  return [...targets];
}

export function getCursorMcpPath(paths: ScopePaths): string {
  return paths.scope === "local"
    ? path.join(paths.workspaceRoot, ".cursor", "mcp.json")
    : path.join(paths.homeDir, ".cursor", "mcp.json");
}

export function getClaudeMcpPath(paths: ScopePaths): string {
  return paths.scope === "local"
    ? path.join(paths.workspaceRoot, ".mcp.json")
    : path.join(paths.homeDir, ".mcp.json");
}

export function getClaudeSettingsPath(paths: ScopePaths): string {
  return paths.scope === "local"
    ? path.join(paths.workspaceRoot, ".claude", "settings.json")
    : path.join(paths.homeDir, ".claude.json");
}

export function getOpenCodeConfigPath(paths: ScopePaths): string {
  return paths.scope === "local"
    ? path.join(paths.workspaceRoot, ".opencode", "opencode.json")
    : path.join(paths.homeDir, ".config", "opencode", "opencode.json");
}

export function getGeminiSettingsPath(paths: ScopePaths): string {
  return paths.scope === "local"
    ? path.join(paths.workspaceRoot, ".gemini", "settings.json")
    : path.join(paths.homeDir, ".gemini", "settings.json");
}

export function getCopilotMcpPath(paths: ScopePaths): string {
  return paths.scope === "local"
    ? path.join(paths.workspaceRoot, ".vscode", "mcp.json")
    : path.join(paths.homeDir, ".vscode", "mcp.json");
}

export function getCodexRootDir(paths: ScopePaths): string {
  return paths.scope === "local"
    ? path.join(paths.workspaceRoot, ".codex")
    : path.join(paths.homeDir, ".codex");
}

export function getCodexConfigPath(paths: ScopePaths): string {
  return path.join(getCodexRootDir(paths), "config.toml");
}

export function getCodexAgentsDir(paths: ScopePaths): string {
  return path.join(getCodexRootDir(paths), "agents");
}

export function getCodexPromptsDir(paths: ScopePaths): string {
  return path.join(paths.homeDir, ".codex", "prompts");
}

export function getVsCodeSettingsPath(homeDir: string): string {
  switch (os.platform()) {
    case "darwin":
      return path.join(
        homeDir,
        "Library",
        "Application Support",
        "Code",
        "User",
        "settings.json",
      );
    case "win32": {
      const appData = process.env.APPDATA;
      if (!appData) {
        return path.join(
          homeDir,
          "AppData",
          "Roaming",
          "Code",
          "User",
          "settings.json",
        );
      }
      return path.join(appData, "Code", "User", "settings.json");
    }
    default:
      return path.join(homeDir, ".config", "Code", "User", "settings.json");
  }
}
