import path from "node:path";
import type { AgentsLockFile, LockEntry, ScopePaths } from "../types.js";
import { readJsonIfExists, writeJsonAtomic } from "./fs.js";

const EMPTY_LOCK: AgentsLockFile = {
  version: 1,
  entries: [],
};

export function readLockfile(paths: ScopePaths): AgentsLockFile {
  const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
  if (!lock || lock.version !== 1 || !Array.isArray(lock.entries)) {
    return createEmptyLockfile();
  }

  return {
    version: 1,
    entries: lock.entries.map((entry) =>
      normalizeLockEntryForRuntime(paths, {
        ...entry,
        importedAgents: Array.isArray(entry.importedAgents)
          ? entry.importedAgents
          : [],
        importedCommands: Array.isArray(entry.importedCommands)
          ? entry.importedCommands
          : [],
        selectedSourceCommands: Array.isArray(entry.selectedSourceCommands)
          ? entry.selectedSourceCommands
          : undefined,
        commandRenameMap: normalizeRenameMap(entry.commandRenameMap),
        importedMcpServers: Array.isArray(entry.importedMcpServers)
          ? entry.importedMcpServers
          : [],
        selectedSourceMcpServers: Array.isArray(entry.selectedSourceMcpServers)
          ? entry.selectedSourceMcpServers
          : undefined,
        importedSkills: Array.isArray(entry.importedSkills)
          ? entry.importedSkills
          : [],
        selectedSourceSkills: Array.isArray(entry.selectedSourceSkills)
          ? entry.selectedSourceSkills
          : undefined,
        skillsProviders: Array.isArray(entry.skillsProviders)
          ? entry.skillsProviders
          : undefined,
        skillRenameMap: normalizeRenameMap(entry.skillRenameMap),
        trackedEntities: Array.isArray(entry.trackedEntities)
          ? entry.trackedEntities
          : undefined,
      }),
    ),
  };
}

function createEmptyLockfile(): AgentsLockFile {
  return {
    version: EMPTY_LOCK.version,
    entries: [],
  };
}

function normalizeRenameMap(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [sourceName, importedName] of Object.entries(value)) {
    if (
      typeof sourceName === "string" &&
      sourceName.trim() &&
      typeof importedName === "string" &&
      importedName.trim()
    ) {
      normalized[sourceName] = importedName;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function writeLockfile(
  paths: ScopePaths,
  lockfile: AgentsLockFile,
): void {
  writeJsonAtomic(paths.lockPath, {
    version: 1,
    entries: lockfile.entries.map((entry) =>
      normalizeLockEntryForDisk(paths, entry),
    ),
  });
}

export function upsertLockEntry(
  lockfile: AgentsLockFile,
  entry: LockEntry,
): void {
  const index = lockfile.entries.findIndex(
    (item) =>
      item.source === entry.source &&
      item.sourceType === entry.sourceType &&
      item.subdir === entry.subdir &&
      sameRequestedAgents(item.requestedAgents, entry.requestedAgents) &&
      sameSelection(
        item.selectedSourceCommands,
        entry.selectedSourceCommands,
      ) &&
      sameSelection(
        item.selectedSourceMcpServers,
        entry.selectedSourceMcpServers,
      ) &&
      sameSelection(item.selectedSourceSkills, entry.selectedSourceSkills) &&
      sameSelection(item.skillsProviders, entry.skillsProviders),
  );

  if (index >= 0) {
    lockfile.entries[index] = entry;
    return;
  }

  lockfile.entries.push(entry);
}

function sameRequestedAgents(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const normalizedLeft = normalizeSelectionForKey(left);
  const normalizedRight = normalizeSelectionForKey(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function sameSelection(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const normalizedLeft = normalizeSelectionForKey(left);
  const normalizedRight = normalizeSelectionForKey(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function normalizeSelectionForKey(value: string[] | undefined): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return [
    ...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean)),
  ].sort();
}

function normalizeLockEntryForRuntime(
  paths: ScopePaths,
  entry: LockEntry,
): LockEntry {
  if (paths.scope !== "local" || entry.sourceType !== "local") {
    return entry;
  }

  if (path.isAbsolute(entry.source)) {
    return entry;
  }

  return {
    ...entry,
    source: path.resolve(paths.workspaceRoot, entry.source),
  };
}

function normalizeLockEntryForDisk(
  paths: ScopePaths,
  entry: LockEntry,
): LockEntry {
  if (paths.scope !== "local" || entry.sourceType !== "local") {
    return entry;
  }

  if (!path.isAbsolute(entry.source)) {
    return {
      ...entry,
      source: entry.source || ".",
    };
  }

  const relativeSource = path.relative(paths.workspaceRoot, entry.source);
  return {
    ...entry,
    source: relativeSource || ".",
  };
}
