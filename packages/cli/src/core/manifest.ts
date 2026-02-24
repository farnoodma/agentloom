import path from "node:path";
import type { EntityType, ScopePaths, SyncManifest } from "../types.js";
import { readJsonIfExists, toPosixPath, writeJsonAtomic } from "./fs.js";

const EMPTY_MANIFEST: SyncManifest = {
  version: 1,
  generatedFiles: [],
};

const ENTITY_TYPES: EntityType[] = ["agent", "command", "mcp", "skill"];

export function readManifest(paths: ScopePaths): SyncManifest {
  const manifest = readJsonIfExists<SyncManifest>(paths.manifestPath);
  if (
    !manifest ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.generatedFiles)
  ) {
    return { ...EMPTY_MANIFEST };
  }

  const generatedByEntity = normalizeGeneratedByEntityForRuntime(
    paths,
    manifest.generatedByEntity,
  );
  const codex = normalizeCodexMetadata(manifest.codex);

  return {
    version: 1,
    generatedFiles: normalizePathListForRuntime(paths, manifest.generatedFiles),
    generatedByEntity,
    codex,
  };
}

export function writeManifest(paths: ScopePaths, manifest: SyncManifest): void {
  const generatedByEntity = normalizeGeneratedByEntityForDisk(
    paths,
    manifest.generatedByEntity,
  );
  const codex = normalizeCodexMetadata(manifest.codex);

  writeJsonAtomic(paths.manifestPath, {
    version: 1,
    generatedFiles: normalizePathListForDisk(paths, manifest.generatedFiles),
    generatedByEntity,
    codex,
  });
}

function normalizeGeneratedByEntityForRuntime(
  paths: ScopePaths,
  generatedByEntity: SyncManifest["generatedByEntity"],
): SyncManifest["generatedByEntity"] {
  if (!generatedByEntity || typeof generatedByEntity !== "object") {
    return undefined;
  }

  const normalized: Partial<Record<EntityType, string[]>> = {};
  for (const entity of ENTITY_TYPES) {
    const values = normalizePathListForRuntime(
      paths,
      generatedByEntity[entity],
    );
    if (values.length === 0) continue;
    normalized[entity] = values;
  }

  return Object.keys(normalized).length > 0 ? normalized : {};
}

function normalizeGeneratedByEntityForDisk(
  paths: ScopePaths,
  generatedByEntity: SyncManifest["generatedByEntity"],
): SyncManifest["generatedByEntity"] {
  if (!generatedByEntity || typeof generatedByEntity !== "object") {
    return undefined;
  }

  const normalized: Partial<Record<EntityType, string[]>> = {};
  for (const entity of ENTITY_TYPES) {
    const values = normalizePathListForDisk(paths, generatedByEntity[entity]);
    if (values.length === 0) continue;
    normalized[entity] = values;
  }

  return Object.keys(normalized).length > 0 ? normalized : {};
}

function normalizePathListForRuntime(
  paths: ScopePaths,
  value: unknown,
): string[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => resolveManifestPathForRuntime(paths, item))
    .filter((item) => item.length > 0);

  return [...new Set(normalized)].sort();
}

function normalizePathListForDisk(paths: ScopePaths, value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => resolveManifestPathForDisk(paths, item))
    .filter((item) => item.length > 0);

  return [...new Set(normalized)].sort();
}

function resolveManifestPathForRuntime(
  paths: ScopePaths,
  filePath: string,
): string {
  const normalized = filePath.trim();
  if (!normalized) return "";

  if (normalized === "~") {
    return paths.homeDir;
  }

  if (normalized.startsWith("~/")) {
    return path.resolve(paths.homeDir, normalized.slice(2));
  }

  if (path.isAbsolute(normalized)) {
    return path.normalize(normalized);
  }

  return path.resolve(paths.workspaceRoot, normalized);
}

function resolveManifestPathForDisk(
  paths: ScopePaths,
  filePath: string,
): string {
  const normalized = filePath.trim();
  if (!normalized) return "";

  if (!path.isAbsolute(normalized)) {
    return toPosixPath(normalized);
  }

  const absolutePath = path.normalize(normalized);

  if (paths.scope === "global") {
    if (isSubpath(paths.homeDir, absolutePath)) {
      const relativePath = path.relative(paths.homeDir, absolutePath);
      return relativePath ? `~/${toPosixPath(relativePath)}` : "~";
    }
    return toPosixPath(absolutePath);
  }

  if (isSubpath(paths.workspaceRoot, absolutePath)) {
    const relativePath = path.relative(paths.workspaceRoot, absolutePath);
    return toPosixPath(relativePath || ".");
  }

  if (isSubpath(paths.homeDir, absolutePath)) {
    const relativePath = path.relative(paths.homeDir, absolutePath);
    return relativePath ? `~/${toPosixPath(relativePath)}` : "~";
  }

  return toPosixPath(absolutePath);
}

function isSubpath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function normalizeCodexMetadata(
  codex: SyncManifest["codex"],
): SyncManifest["codex"] {
  if (!codex || typeof codex !== "object") return undefined;

  const roles = Array.isArray(codex.roles)
    ? [...new Set(codex.roles.filter((item): item is string => !!item))].sort()
    : undefined;
  const mcpServers = Array.isArray(codex.mcpServers)
    ? [
        ...new Set(codex.mcpServers.filter((item): item is string => !!item)),
      ].sort()
    : undefined;

  if (!roles && !mcpServers) return undefined;

  return {
    roles,
    mcpServers,
  };
}
