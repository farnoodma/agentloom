import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { listMarkdownFiles, slugify } from "./fs.js";

const MANAGED_BLOCK_PATTERN =
  /<!--\s*agentloom:([a-z0-9._-]+):start\s*-->[\s\S]*?<!--\s*agentloom:\1:end\s*-->\s*/gi;
const MANAGED_BLOCK_CAPTURE_PATTERN =
  /<!--\s*agentloom:([a-z0-9._-]+):start\s*-->\s*([\s\S]*?)\s*<!--\s*agentloom:\1:end\s*-->/gi;

export interface CanonicalRuleFile {
  id: string;
  name: string;
  fileName: string;
  sourcePath: string;
  content: string;
  body: string;
  frontmatter: Record<string, unknown> & { name: string };
}

export interface ManagedRuleBlock {
  id: string;
  name: string;
  body: string;
}

export function parseRulesDir(rulesDir: string): CanonicalRuleFile[] {
  if (!fs.existsSync(rulesDir)) return [];

  return listMarkdownFiles(rulesDir)
    .sort((a, b) => a.localeCompare(b))
    .map((sourcePath) => {
      const content = fs.readFileSync(sourcePath, "utf8");
      const fileName = path.basename(sourcePath);
      const parsed = parseRuleMarkdown(content, sourcePath);

      return {
        id: stripRuleFileExtension(fileName),
        name: parsed.name,
        fileName,
        sourcePath,
        content,
        body: parsed.body,
        frontmatter: parsed.frontmatter,
      };
    });
}

export function parseRuleMarkdown(
  content: string,
  sourcePath = "<rule>",
): {
  name: string;
  body: string;
  frontmatter: Record<string, unknown> & { name: string };
} {
  const parsed = matter(content);
  if (
    !parsed.data ||
    typeof parsed.data !== "object" ||
    Array.isArray(parsed.data)
  ) {
    throw new Error(
      `Rule "${sourcePath}" must include YAML frontmatter with required "name".`,
    );
  }

  const frontmatter = parsed.data as Record<string, unknown>;
  if (typeof frontmatter.name !== "string" || frontmatter.name.trim() === "") {
    throw new Error(
      `Rule "${sourcePath}" is missing required frontmatter.name.`,
    );
  }

  return {
    name: frontmatter.name.trim(),
    body: parsed.content.trimStart(),
    frontmatter: {
      ...frontmatter,
      name: frontmatter.name.trim(),
    },
  };
}

export function normalizeRuleSelector(selector: string): string {
  const trimmed = selector.trim().replace(/^\/+/, "");
  const withoutExt = stripRuleFileExtension(trimmed);
  const normalized = slugify(withoutExt);
  return normalized || withoutExt.toLowerCase();
}

export function resolveRuleSelections(
  rules: CanonicalRuleFile[],
  selectors: string[],
): {
  selected: CanonicalRuleFile[];
  unmatched: string[];
} {
  const selectedById = new Map<string, CanonicalRuleFile>();
  const unmatched: string[] = [];

  for (const selector of selectors) {
    const normalizedSelector = normalizeRuleSelector(selector);
    if (!normalizedSelector) {
      continue;
    }

    const matches = rules.filter((rule) => {
      const exactCandidates = new Set([
        rule.id.toLowerCase(),
        stripRuleFileExtension(rule.fileName).toLowerCase(),
      ]);
      const slugCandidates = new Set([
        normalizeRuleSelector(rule.id),
        normalizeRuleSelector(stripRuleFileExtension(rule.fileName)),
        normalizeRuleSelector(rule.name),
      ]);
      return (
        exactCandidates.has(normalizedSelector) ||
        slugCandidates.has(normalizedSelector)
      );
    });

    if (matches.length === 0) {
      unmatched.push(selector);
      continue;
    }

    for (const match of matches) {
      selectedById.set(match.id, match);
    }
  }

  return {
    selected: [...selectedById.values()],
    unmatched,
  };
}

export function renderRuleForCursor(rule: CanonicalRuleFile): string {
  const fm = YAML.stringify(rule.frontmatter, { lineWidth: 0 }).trimEnd();
  const body = rule.body.trimStart();
  return `---\n${fm}\n---\n\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

export function renderManagedRuleBlock(rule: CanonicalRuleFile): string {
  const body = rule.body.trim();
  const heading = `## ${rule.name}`;
  const content = body ? `${heading}\n\n${body}` : heading;
  return `<!-- agentloom:${rule.id}:start -->\n${content}\n<!-- agentloom:${rule.id}:end -->`;
}

export function parseManagedRuleBlocks(content: string): ManagedRuleBlock[] {
  const blocks: ManagedRuleBlock[] = [];

  content.replace(
    MANAGED_BLOCK_CAPTURE_PATTERN,
    (_match, rawId: string, rawInner: string) => {
      const id = String(rawId).trim();
      const inner = String(rawInner).trim();
      const headingMatch = inner.match(/^##\s+(.+?)(?:\r?\n([\s\S]*))?$/);
      const name = headingMatch?.[1]?.trim() || id;
      const body = (headingMatch?.[2] ?? inner).replace(/^\r?\n/, "").trim();

      blocks.push({
        id,
        name,
        body: headingMatch ? body : inner,
      });

      return "";
    },
  );

  return blocks;
}

export function upsertManagedRuleBlocks(
  existingContent: string,
  rules: CanonicalRuleFile[],
): string {
  const byId = new Map(rules.map((rule) => [rule.id, rule] as const));
  const seen = new Set<string>();

  let nextContent = existingContent.replace(
    MANAGED_BLOCK_PATTERN,
    (match, id) => {
      const normalizedId = String(id).trim();
      const rule = byId.get(normalizedId);
      if (!rule) {
        return "";
      }
      if (seen.has(normalizedId)) {
        return "";
      }
      seen.add(normalizedId);

      const suffix = /\n$/.test(match) ? "\n" : "";
      return `${renderManagedRuleBlock(rule)}${suffix}`;
    },
  );

  const missing = rules
    .filter((rule) => !seen.has(rule.id))
    .map((rule) => renderManagedRuleBlock(rule));
  if (missing.length === 0) {
    return nextContent;
  }

  if (nextContent.trim().length === 0) {
    return `${missing.join("\n\n")}\n`;
  }

  const trailingNewline = nextContent.endsWith("\n") ? "" : "\n";
  return `${nextContent}${trailingNewline}\n${missing.join("\n\n")}\n`;
}

export function stripRuleFileExtension(fileName: string): string {
  const ext = path.extname(fileName);
  if (!ext) return fileName;
  return fileName.slice(0, -ext.length);
}
