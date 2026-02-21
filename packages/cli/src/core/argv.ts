import type { ParsedArgs } from "minimist";
import minimist from "minimist";
import type { Provider, SelectionMode } from "../types.js";

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed = minimist(argv, {
    boolean: ["global", "local", "yes", "no-sync", "dry-run", "json", "help"],
    string: [
      "ref",
      "subdir",
      "providers",
      "rename",
      "agent",
      "agents",
      "command",
      "commands",
      "mcp",
      "mcps",
      "skill",
      "skills",
      "url",
      "arg",
      "env",
      "source",
      "name",
      "entity",
      "selection-mode",
    ],
    alias: {
      g: "global",
      l: "local",
      y: "yes",
      h: "help",
    },
    "--": true,
  });

  const syncFlag = (parsed as Record<string, unknown>).sync;
  if (
    syncFlag === false ||
    syncFlag === "false" ||
    syncFlag === 0 ||
    syncFlag === "0"
  ) {
    (parsed as Record<string, unknown>)["no-sync"] = true;
  }

  return parsed;
}

export function parseProvidersFlag(input: unknown): Provider[] | undefined {
  if (typeof input !== "string" || input.trim() === "") return undefined;
  const parsed = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());

  const validProviders: Provider[] = [];
  for (const provider of parsed) {
    if (
      provider === "cursor" ||
      provider === "claude" ||
      provider === "codex" ||
      provider === "opencode" ||
      provider === "gemini" ||
      provider === "copilot"
    ) {
      validProviders.push(provider);
      continue;
    }
    throw new Error(
      `Unknown provider: ${provider}. Expected one of: cursor, claude, codex, opencode, gemini, copilot.`,
    );
  }

  return [...new Set(validProviders)];
}

export function parseSelectionModeFlag(
  input: unknown,
): SelectionMode | undefined {
  if (typeof input !== "string" || input.trim() === "") return undefined;
  const normalized = input.trim().toLowerCase();

  if (normalized === "all" || normalized === "sync-all") {
    return "all";
  }
  if (normalized === "custom") {
    return "custom";
  }

  throw new Error(
    `Unknown selection mode: ${normalized}. Expected one of: all, sync-all, custom.`,
  );
}

export function getStringArrayFlag(
  value: unknown,
  fallback: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return fallback;
}
