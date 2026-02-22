import { randomUUID } from "node:crypto";
import path from "node:path";
import { getCliVersion } from "./version.js";
import type { ImportSummary } from "./importer.js";
import { parseSourceSpec } from "./sources.js";

const DEFAULT_TELEMETRY_ENDPOINT = "https://agentloom.sh/api/v1/installs";
const TELEMETRY_TIMEOUT_MS = 1800;

export type TelemetrySource = {
  owner: string;
  repo: string;
};

export type TelemetryItem = {
  entityType: "agent" | "skill" | "command" | "mcp";
  name: string;
  filePath: string;
};

export function parseGitHubSource(input: string): TelemetrySource | null {
  const spec = parseSourceSpec(input);

  if (spec.type === "github") {
    const [owner, repo] = spec.source.split("/");
    if (!owner || !repo) {
      return null;
    }
    return { owner, repo };
  }

  if (spec.type !== "git") {
    return null;
  }

  const gitSource = spec.source.trim();

  const sshMatch = gitSource.match(
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i,
  );
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(gitSource);
  } catch {
    return null;
  }

  if (parsedUrl.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");

  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

export function buildTelemetryItems(summary: ImportSummary): TelemetryItem[] {
  const items: TelemetryItem[] = [];

  for (const filePath of summary.importedAgents) {
    const name = path.basename(filePath, path.extname(filePath));
    items.push({ entityType: "agent", name, filePath });
  }

  for (const filePath of summary.importedCommands) {
    const name = path.basename(filePath, path.extname(filePath));
    items.push({ entityType: "command", name, filePath });
  }

  for (const serverName of summary.importedMcpServers) {
    items.push({ entityType: "mcp", name: serverName, filePath: "mcp.json" });
  }

  if (summary.telemetrySkills && summary.telemetrySkills.length > 0) {
    for (const skill of summary.telemetrySkills) {
      items.push({
        entityType: "skill",
        name: skill.name,
        filePath: skill.filePath.replace(/^\/+/, ""),
      });
    }
  } else {
    for (const skillName of summary.importedSkills) {
      items.push({
        entityType: "skill",
        name: skillName,
        filePath: `skills/${skillName}/SKILL.md`,
      });
    }
  }

  return items;
}

export function buildInstallTelemetryPayload(input: {
  source: TelemetrySource;
  summary: ImportSummary;
}) {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    cliVersion: getCliVersion(),
    source: input.source,
    items: buildTelemetryItems(input.summary),
  };
}

export async function sendAddTelemetryEvent(input: {
  rawSource: string;
  summary: ImportSummary;
}): Promise<void> {
  if (process.env.AGENTLOOM_DISABLE_TELEMETRY === "1") {
    return;
  }

  const source = parseGitHubSource(input.rawSource);
  if (!source) {
    return;
  }

  const payload = buildInstallTelemetryPayload({
    source,
    summary: input.summary,
  });

  if (payload.items.length === 0) {
    return;
  }

  const endpoint =
    process.env.AGENTLOOM_TELEMETRY_ENDPOINT || DEFAULT_TELEMETRY_ENDPOINT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // Telemetry is fail-open by design.
  } finally {
    clearTimeout(timeout);
  }
}
