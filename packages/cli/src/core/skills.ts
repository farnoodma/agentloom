import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Provider, ScopePaths } from "../types.js";
import { ensureDir, slugify } from "./fs.js";
import { getProviderSkillsPaths } from "./provider-paths.js";

export interface CanonicalSkill {
  name: string;
  sourcePath: string;
  skillPath: string;
  layout: "nested" | "root";
}

export const ROOT_SKILL_ARTIFACT_DIRS = [
  "references",
  "assets",
  "scripts",
  "templates",
  "examples",
] as const;

export function parseSkillsDir(skillsDir: string): CanonicalSkill[] {
  if (!fs.existsSync(skillsDir)) return [];

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: CanonicalSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;

    skills.push({
      name: entry.name,
      sourcePath: skillDir,
      skillPath: skillFile,
      layout: "nested",
    });
  }

  if (skills.length > 0) {
    return skills.sort((left, right) => left.name.localeCompare(right.name));
  }

  const rootSkillFile = path.join(skillsDir, "SKILL.md");
  if (!fs.existsSync(rootSkillFile) || !fs.statSync(rootSkillFile).isFile()) {
    return [];
  }

  const raw = fs.readFileSync(rootSkillFile, "utf8");
  return [
    {
      name: extractSkillName(raw) || path.basename(skillsDir),
      sourcePath: skillsDir,
      skillPath: rootSkillFile,
      layout: "root",
    },
  ];
}

function extractSkillName(raw: string): string | undefined {
  try {
    const parsed = matter(raw);
    if (typeof parsed.data.name !== "string") return undefined;
    const name = parsed.data.name.trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeSkillSelector(value: string): string {
  return slugify(value.trim().replace(/\/+$/, "")).toLowerCase();
}

export function resolveSkillSelections(
  skills: CanonicalSkill[],
  selectors: string[],
): { selected: CanonicalSkill[]; unmatched: string[] } {
  const normalizedSelectors = selectors
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeSkillSelector)
    .filter(Boolean);

  const selectedMap = new Map<string, CanonicalSkill>();
  const unmatched: string[] = [];

  for (const selector of normalizedSelectors) {
    const matches = skills.filter(
      (skill) => normalizeSkillSelector(skill.name) === selector,
    );

    if (matches.length === 0) {
      unmatched.push(selector);
      continue;
    }

    for (const match of matches) {
      selectedMap.set(match.name, match);
    }
  }

  return {
    selected: [...selectedMap.values()],
    unmatched,
  };
}

export function copyRootSkillArtifacts(
  sourceRoot: string,
  targetDir: string,
): void {
  ensureDir(targetDir);

  const sourceSkillPath = path.join(sourceRoot, "SKILL.md");
  if (
    !fs.existsSync(sourceSkillPath) ||
    !fs.statSync(sourceSkillPath).isFile()
  ) {
    throw new Error(
      `Root skill source is missing SKILL.md at ${sourceSkillPath}.`,
    );
  }

  fs.copyFileSync(sourceSkillPath, path.join(targetDir, "SKILL.md"));

  for (const artifactDirName of ROOT_SKILL_ARTIFACT_DIRS) {
    const sourceArtifactDir = path.join(sourceRoot, artifactDirName);
    if (
      !fs.existsSync(sourceArtifactDir) ||
      !fs.statSync(sourceArtifactDir).isDirectory()
    ) {
      continue;
    }

    fs.cpSync(sourceArtifactDir, path.join(targetDir, artifactDirName), {
      recursive: true,
      force: true,
    });
  }
}

export function copySkillArtifacts(
  skill: CanonicalSkill,
  targetDir: string,
): void {
  if (skill.layout === "nested") {
    fs.cpSync(skill.sourcePath, targetDir, {
      recursive: true,
      force: true,
    });
    return;
  }

  copyRootSkillArtifacts(skill.sourcePath, targetDir);
}

export function skillContentMatchesTarget(
  skill: CanonicalSkill,
  targetDir: string,
): boolean {
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return false;
  }

  if (skill.layout === "nested") {
    return directoriesAreEqual(skill.sourcePath, targetDir);
  }

  return rootSkillArtifactsEqual(skill.sourcePath, targetDir);
}

export function applySkillProviderSideEffects(options: {
  paths: ScopePaths;
  providers: Provider[];
  dryRun?: boolean;
  warn?: (message: string) => void;
}): void {
  const pathsToSymlink = getProviderSkillsPaths(
    options.paths,
    options.providers,
  );
  if (pathsToSymlink.length === 0) return;

  const canonicalSkillsDir = options.paths.skillsDir;
  if (!options.dryRun) {
    ensureDir(canonicalSkillsDir);
  }

  for (const targetSkillsDir of pathsToSymlink) {
    enforceProviderSkillsSymlink({
      targetSkillsDir,
      canonicalSkillsDir,
      dryRun: Boolean(options.dryRun),
      warn: options.warn,
    });
  }
}

function enforceProviderSkillsSymlink(options: {
  targetSkillsDir: string;
  canonicalSkillsDir: string;
  dryRun: boolean;
  warn?: (message: string) => void;
}): void {
  const resolvedCanonical = realPathOrResolved(options.canonicalSkillsDir);
  const targetDir = options.targetSkillsDir;

  if (!fs.existsSync(targetDir)) {
    if (!options.dryRun) {
      ensureDir(path.dirname(targetDir));
      fs.symlinkSync(options.canonicalSkillsDir, targetDir, "dir");
    }
    return;
  }

  const targetStat = fs.lstatSync(targetDir);
  if (targetStat.isSymbolicLink()) {
    const resolvedTarget = realPathOrResolved(targetDir);
    if (resolvedTarget === resolvedCanonical) {
      return;
    }
    throw new Error(
      `Expected ${targetDir} to symlink to ${options.canonicalSkillsDir}, but it points to ${resolvedTarget}.`,
    );
  }

  if (!targetStat.isDirectory()) {
    throw new Error(
      `Cannot manage skills side effects because ${targetDir} exists and is not a directory.`,
    );
  }

  migrateProviderSkillsIntoCanonical({
    providerSkillsDir: targetDir,
    canonicalSkillsDir: options.canonicalSkillsDir,
    dryRun: options.dryRun,
    warn: options.warn,
  });

  if (!options.dryRun) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    ensureDir(path.dirname(targetDir));
    fs.symlinkSync(options.canonicalSkillsDir, targetDir, "dir");
  }
}

function migrateProviderSkillsIntoCanonical(options: {
  providerSkillsDir: string;
  canonicalSkillsDir: string;
  dryRun: boolean;
  warn?: (message: string) => void;
}): void {
  const providerSkills = parseSkillsDir(options.providerSkillsDir);

  for (const skill of providerSkills) {
    const targetSkillDirName =
      skill.layout === "nested"
        ? path.basename(skill.sourcePath)
        : slugify(skill.name) || "skill";
    const targetSkillDir = path.join(
      options.canonicalSkillsDir,
      targetSkillDirName,
    );

    if (fs.existsSync(targetSkillDir)) {
      const sameContent =
        skill.layout === "nested"
          ? directoriesAreEqual(skill.sourcePath, targetSkillDir)
          : rootSkillArtifactsEqual(skill.sourcePath, targetSkillDir);

      if (!sameContent) {
        options.warn?.(
          `Skipped migrating provider skill "${targetSkillDirName}" because canonical skill content already exists.`,
        );
      }
      continue;
    }

    if (options.dryRun) {
      continue;
    }

    if (skill.layout === "nested") {
      moveDirectory(skill.sourcePath, targetSkillDir);
      continue;
    }

    copyRootSkillArtifacts(skill.sourcePath, targetSkillDir);
  }
}

function moveDirectory(sourceDir: string, targetDir: string): void {
  ensureDir(path.dirname(targetDir));

  try {
    fs.renameSync(sourceDir, targetDir);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "EXDEV") {
      throw error;
    }
  }

  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
  fs.rmSync(sourceDir, { recursive: true, force: true });
}

function directoriesAreEqual(leftDir: string, rightDir: string): boolean {
  if (!fs.existsSync(leftDir) || !fs.existsSync(rightDir)) return false;

  const leftEntries = collectFileEntries(leftDir);
  const rightEntries = collectFileEntries(rightDir);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (let index = 0; index < leftEntries.length; index += 1) {
    const left = leftEntries[index];
    const right = rightEntries[index];
    if (!left || !right || left.relativePath !== right.relativePath) {
      return false;
    }
    if (!left.content.equals(right.content)) {
      return false;
    }
  }

  return true;
}

function rootSkillArtifactsEqual(
  sourceRoot: string,
  targetDir: string,
): boolean {
  const sourceArtifacts = collectRootSkillArtifacts(sourceRoot);
  const targetArtifacts = collectRootSkillArtifacts(targetDir);

  if (sourceArtifacts.length !== targetArtifacts.length) {
    return false;
  }

  for (let index = 0; index < sourceArtifacts.length; index += 1) {
    const left = sourceArtifacts[index];
    const right = targetArtifacts[index];
    if (!left || !right || left.relativePath !== right.relativePath) {
      return false;
    }
    if (!left.content.equals(right.content)) {
      return false;
    }
  }

  return true;
}

function collectRootSkillArtifacts(rootDir: string): Array<{
  relativePath: string;
  content: Buffer;
}> {
  const collected: Array<{ relativePath: string; content: Buffer }> = [];
  const rootSkillPath = path.join(rootDir, "SKILL.md");
  if (!fs.existsSync(rootSkillPath) || !fs.statSync(rootSkillPath).isFile()) {
    return collected;
  }

  collected.push({
    relativePath: "SKILL.md",
    content: fs.readFileSync(rootSkillPath),
  });

  for (const artifactDirName of ROOT_SKILL_ARTIFACT_DIRS) {
    const artifactDir = path.join(rootDir, artifactDirName);
    if (
      !fs.existsSync(artifactDir) ||
      !fs.statSync(artifactDir).isDirectory()
    ) {
      continue;
    }
    collected.push(...collectFileEntries(artifactDir, artifactDirName));
  }

  return collected.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function collectFileEntries(
  rootDir: string,
  prefix = "",
): Array<{ relativePath: string; content: Buffer }> {
  const entries: Array<{ relativePath: string; content: Buffer }> = [];

  const stack: Array<{ absolute: string; relative: string }> = [
    {
      absolute: rootDir,
      relative: prefix,
    },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const children = fs.readdirSync(current.absolute, { withFileTypes: true });
    for (const child of children) {
      const absolutePath = path.join(current.absolute, child.name);
      const relativePath = current.relative
        ? path.posix.join(current.relative, child.name)
        : child.name;

      if (child.isDirectory()) {
        stack.push({ absolute: absolutePath, relative: relativePath });
        continue;
      }

      if (!child.isFile()) continue;

      entries.push({
        relativePath,
        content: fs.readFileSync(absolutePath),
      });
    }
  }

  return entries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function realPathOrResolved(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}
