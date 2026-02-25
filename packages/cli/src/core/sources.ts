import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SourceType = "local" | "github" | "git";

export interface SourceSpec {
  source: string;
  type: SourceType;
}

export interface PreparedSource {
  spec: SourceSpec;
  rootPath: string;
  importRoot: string;
  resolvedCommit: string;
  cleanup: () => void;
}

export function parseSourceSpec(source: string): SourceSpec {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("Source cannot be empty.");
  }

  const resolvedLocalPath = path.resolve(trimmed);
  if (isExplicitLocalPath(trimmed) || fs.existsSync(resolvedLocalPath)) {
    return { source: resolvedLocalPath, type: "local" };
  }

  if (isGitUrl(trimmed)) {
    return { source: trimmed, type: "git" };
  }

  if (isGitHubSlug(trimmed)) {
    return { source: trimmed, type: "github" };
  }

  return { source: path.resolve(trimmed), type: "local" };
}

export function prepareSource(options: {
  source: string;
  ref?: string;
  subdir?: string;
}): PreparedSource {
  const spec = parseSourceSpec(options.source);

  if (spec.type === "local") {
    if (!fs.existsSync(spec.source)) {
      throw new Error(`Local source not found: ${spec.source}`);
    }

    const importRoot = resolveImportRoot(spec.source, options.subdir);
    const resolvedCommit = resolveLocalCommitOrHash(spec.source);

    return {
      spec,
      rootPath: spec.source,
      importRoot,
      resolvedCommit,
      cleanup: () => undefined,
    };
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentloom-"));
  const cloneUrl =
    spec.type === "github"
      ? `https://github.com/${spec.source}.git`
      : spec.source;

  runGit(["clone", cloneUrl, tmpRoot]);

  if (options.ref) {
    runGit(["-C", tmpRoot, "checkout", options.ref]);
  }

  const resolvedCommit = runGit(["-C", tmpRoot, "rev-parse", "HEAD"]).trim();
  const importRoot = resolveImportRoot(tmpRoot, options.subdir);

  return {
    spec,
    rootPath: tmpRoot,
    importRoot,
    resolvedCommit,
    cleanup: () => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

export function discoverSourceAgentsDir(importRoot: string): string | null {
  const direct = path.join(importRoot, "agents");
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }

  const nested = path.join(importRoot, ".agents", "agents");
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    return nested;
  }

  const githubAgents = path.join(importRoot, ".github", "agents");
  if (fs.existsSync(githubAgents) && fs.statSync(githubAgents).isDirectory()) {
    return githubAgents;
  }

  return null;
}

export function discoverSourceMcpPath(importRoot: string): string | null {
  const nested = path.join(importRoot, ".agents", "mcp.json");
  if (fs.existsSync(nested)) return nested;

  const direct = path.join(importRoot, "mcp.json");
  if (fs.existsSync(direct)) return direct;

  return null;
}

export function discoverSourceCommandsDir(importRoot: string): string | null {
  const nested = path.join(importRoot, ".agents", "commands");
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    return nested;
  }

  const direct = path.join(importRoot, "commands");
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }

  const prompts = path.join(importRoot, "prompts");
  if (fs.existsSync(prompts) && fs.statSync(prompts).isDirectory()) {
    return prompts;
  }

  const githubPrompts = path.join(importRoot, ".github", "prompts");
  if (
    fs.existsSync(githubPrompts) &&
    fs.statSync(githubPrompts).isDirectory()
  ) {
    return githubPrompts;
  }

  return null;
}

export function discoverSourceSkillsDir(importRoot: string): string | null {
  const nested = path.join(importRoot, ".agents", "skills");
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    return nested;
  }

  const direct = path.join(importRoot, "skills");
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }

  const rootSkill = path.join(importRoot, "SKILL.md");
  if (fs.existsSync(rootSkill) && fs.statSync(rootSkill).isFile()) {
    return importRoot;
  }

  return null;
}

function resolveImportRoot(rootPath: string, subdir?: string): string {
  if (!subdir) return rootPath;
  const importRoot = path.resolve(rootPath, subdir);
  if (!fs.existsSync(importRoot)) {
    throw new Error(`Subdir does not exist in source: ${subdir}`);
  }
  return importRoot;
}

function isGitHubSlug(source: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source);
}

function isExplicitLocalPath(source: string): boolean {
  return (
    path.isAbsolute(source) ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith(".\\") ||
    source.startsWith("..\\")
  );
}

function isGitUrl(source: string): boolean {
  return (
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.startsWith("git@") ||
    source.endsWith(".git")
  );
}

function resolveLocalCommitOrHash(localPath: string): string {
  try {
    return runGit(["-C", localPath, "rev-parse", "HEAD"]).trim();
  } catch {
    return `local-${hashLocalPathContents(localPath)}`;
  }
}

function hashLocalPathContents(localPath: string): string {
  const stat = fs.statSync(localPath);
  const hasher = createHash("sha256");

  if (stat.isFile()) {
    hasher.update("file");
    hasher.update("\0");
    hasher.update(fs.readFileSync(localPath));
    return hasher.digest("hex");
  }

  const files = collectFiles(localPath);
  if (files.length === 0) {
    hasher.update("empty");
  }

  for (const filePath of files) {
    const relativeFilePath = path
      .relative(localPath, filePath)
      .split(path.sep)
      .join("/");
    hasher.update(relativeFilePath);
    hasher.update("\0");
    hasher.update(fs.readFileSync(filePath));
    hasher.update("\0");
  }

  return hasher.digest("hex");
}

function collectFiles(rootPath: string): string[] {
  const entries: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) continue;

    const children = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(currentPath, child.name);
      if (child.isDirectory()) {
        stack.push(childPath);
      } else if (child.isFile()) {
        entries.push(childPath);
      }
    }
  }

  return entries.sort();
}

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}
