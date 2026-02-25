import path from "node:path";
import type { Provider } from "../types.js";

type ProviderEntity = "agent" | "command";

const COPILOT_AGENT_FILE = /\.agent\.md$/i;
const COPILOT_COMMAND_FILE = /\.prompt\.md$/i;
const GENERIC_AGENT_FILE = /\.md$/i;
const GENERIC_COMMAND_FILE = /(?:\.prompt)?\.(md|mdc)$/i;
const EXCLUDED_ENTITY_STEMS = new Set(["readme"]);

export function isProviderEntityFileName(options: {
  provider: Provider;
  entity: ProviderEntity;
  fileName: string;
}): boolean {
  const normalizedName = path.basename(options.fileName);
  const stem = normalizeEntityStem(normalizedName);
  if (!stem || EXCLUDED_ENTITY_STEMS.has(stem)) {
    return false;
  }

  if (options.provider === "copilot") {
    if (options.entity === "agent") {
      return COPILOT_AGENT_FILE.test(normalizedName);
    }
    return COPILOT_COMMAND_FILE.test(normalizedName);
  }

  if (options.entity === "agent") {
    return GENERIC_AGENT_FILE.test(normalizedName);
  }

  return GENERIC_COMMAND_FILE.test(normalizedName);
}

function normalizeEntityStem(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.agent\.md$/i, "")
    .replace(/\.prompt\.(md|mdc)$/i, "")
    .replace(/\.(md|mdc)$/i, "");
}
