import type { ScopePaths, SyncManifest } from "../types.js";
import { readJsonIfExists, writeJsonAtomic } from "./fs.js";

const EMPTY_MANIFEST: SyncManifest = {
  version: 1,
  generatedFiles: [],
};

export function readManifest(paths: ScopePaths): SyncManifest {
  const manifest = readJsonIfExists<SyncManifest>(paths.manifestPath);
  if (
    !manifest ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.generatedFiles)
  ) {
    return { ...EMPTY_MANIFEST };
  }

  const generatedByEntity =
    manifest.generatedByEntity && typeof manifest.generatedByEntity === "object"
      ? manifest.generatedByEntity
      : undefined;

  return {
    ...manifest,
    generatedByEntity,
  };
}

export function writeManifest(paths: ScopePaths, manifest: SyncManifest): void {
  writeJsonAtomic(paths.manifestPath, manifest);
}
