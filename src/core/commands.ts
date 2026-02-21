import fs from "node:fs";
import path from "node:path";
import { listMarkdownFiles, slugify } from "./fs.js";

export interface CanonicalCommandFile {
  fileName: string;
  sourcePath: string;
  content: string;
}

export function parseCommandsDir(commandsDir: string): CanonicalCommandFile[] {
  if (!fs.existsSync(commandsDir)) return [];

  return listMarkdownFiles(commandsDir)
    .sort((a, b) => a.localeCompare(b))
    .map((sourcePath) => ({
      fileName: path.basename(sourcePath),
      sourcePath,
      content: fs.readFileSync(sourcePath, "utf8"),
    }));
}

export function stripCommandFileExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".prompt.md")) {
    return fileName.slice(0, -".prompt.md".length);
  }

  const ext = path.extname(fileName);
  if (!ext) return fileName;
  return fileName.slice(0, -ext.length);
}

export function commandFileMatchesSelector(
  fileName: string,
  selector: string,
): boolean {
  const raw = selector.trim().toLowerCase();
  if (!raw) return false;

  const normalizedSelector = normalizeCommandSelector(raw);
  const normalizedFileName = fileName.toLowerCase();
  const withoutExt = stripCommandFileExtension(normalizedFileName);

  if (normalizedFileName === raw || normalizedFileName === normalizedSelector) {
    return true;
  }

  if (withoutExt === raw || withoutExt === normalizedSelector) {
    return true;
  }

  if (
    slugify(withoutExt) === normalizedSelector ||
    slugify(withoutExt) === slugify(normalizedSelector)
  ) {
    return true;
  }

  return false;
}

export function normalizeCommandSelector(selector: string): string {
  const trimmed = selector.trim().replace(/^\/+/, "");
  return stripCommandFileExtension(trimmed).toLowerCase();
}

export function resolveCommandSelections(
  commands: CanonicalCommandFile[],
  selectors: string[],
): {
  selected: CanonicalCommandFile[];
  unmatched: string[];
} {
  const uniqueSelected = new Map<string, CanonicalCommandFile>();
  const unmatched: string[] = [];

  for (const selector of selectors) {
    const matches = commands.filter((command) =>
      commandFileMatchesSelector(command.fileName, selector),
    );

    if (matches.length === 0) {
      unmatched.push(selector);
      continue;
    }

    for (const match of matches) {
      uniqueSelected.set(match.fileName, match);
    }
  }

  return {
    selected: [...uniqueSelected.values()],
    unmatched,
  };
}
