import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readTextIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

export function readJsonIfExists<T>(filePath: string): T | null {
  const text = readTextIfExists(filePath);
  if (text === null) return null;
  return JSON.parse(text) as T;
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function listMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".md") || entry.endsWith(".mdc"))
    .map((entry) => path.join(dirPath, entry));
}

export function hashContent(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashFiles(filePaths: string[]): string {
  const hasher = createHash("sha256");
  for (const filePath of [...filePaths].sort()) {
    hasher.update(filePath);
    hasher.update("\0");
    hasher.update(fs.readFileSync(filePath));
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function relativePosix(fromPath: string, toPath: string): string {
  return toPosixPath(path.relative(fromPath, toPath));
}

export function removeFileIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
