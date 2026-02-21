import os from "node:os";
import path from "node:path";
import { readJsonIfExists, writeJsonAtomic } from "./fs.js";
import type {
  AgentloomSettings,
  Provider,
  Scope,
  ScopePaths,
} from "../types.js";

const DEFAULT_SETTINGS: AgentloomSettings = {
  version: 1,
  defaultProviders: [
    "cursor",
    "claude",
    "codex",
    "opencode",
    "gemini",
    "copilot",
  ],
  telemetry: {
    enabled: true,
  },
};

export function getGlobalSettingsPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".agents", "settings.local.json");
}

export function readSettings(settingsPath: string): AgentloomSettings {
  const settings = readJsonIfExists<AgentloomSettings>(settingsPath);
  if (!settings) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    telemetry: {
      ...DEFAULT_SETTINGS.telemetry,
      ...settings.telemetry,
    },
    defaultProviders:
      settings.defaultProviders && settings.defaultProviders.length > 0
        ? settings.defaultProviders
        : DEFAULT_SETTINGS.defaultProviders,
  };
}

export function writeSettings(
  settingsPath: string,
  settings: AgentloomSettings,
): void {
  writeJsonAtomic(settingsPath, settings);
}

export function updateLastScope(
  settingsPath: string,
  scope: Scope,
  providers?: Provider[],
): void {
  const current = readSettings(settingsPath);
  const next: AgentloomSettings = {
    ...current,
    version: 1,
    lastScope: scope,
  };
  if (providers && providers.length > 0) {
    next.defaultProviders = [...providers];
  }
  writeSettings(settingsPath, next);
}

export function settingsPathForScope(paths: ScopePaths): string {
  return paths.settingsPath;
}
