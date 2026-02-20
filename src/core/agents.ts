import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import type { AgentFrontmatter, CanonicalAgent, Provider } from "../types.js";
import { isObject, slugify } from "./fs.js";

export function parseAgentsDir(agentsDir: string): CanonicalAgent[] {
  if (!fs.existsSync(agentsDir)) return [];

  const files = fs
    .readdirSync(agentsDir)
    .filter((entry) => entry.endsWith(".md"))
    .sort();

  return files.map((entry) => {
    const filePath = path.join(agentsDir, entry);
    const raw = fs.readFileSync(filePath, "utf8");
    return parseAgentMarkdown(raw, filePath, entry);
  });
}

export function parseAgentMarkdown(
  raw: string,
  sourcePath: string,
  fileName = path.basename(sourcePath),
): CanonicalAgent {
  const parsed = matter(raw);
  if (!isObject(parsed.data)) {
    throw new Error(`Invalid frontmatter in ${sourcePath}: expected object.`);
  }

  const frontmatter = parsed.data as AgentFrontmatter;

  if (typeof frontmatter.name !== "string" || frontmatter.name.trim() === "") {
    throw new Error(`Invalid frontmatter in ${sourcePath}: missing \`name\`.`);
  }

  if (
    typeof frontmatter.description !== "string" ||
    frontmatter.description.trim() === ""
  ) {
    throw new Error(
      `Invalid frontmatter in ${sourcePath}: missing \`description\`.`,
    );
  }

  const normalizedName = frontmatter.name.trim();
  const normalizedDescription = frontmatter.description.trim();
  const body = parsed.content.trimStart();

  return {
    name: normalizedName,
    description: normalizedDescription,
    body,
    frontmatter: {
      ...frontmatter,
      name: normalizedName,
      description: normalizedDescription,
    },
    sourcePath,
    fileName,
  };
}

export function buildAgentMarkdown(
  frontmatter: AgentFrontmatter,
  body: string,
): string {
  const fm = YAML.stringify(frontmatter).trimEnd();
  const normalizedBody = body.trimStart();
  return `---\n${fm}\n---\n\n${normalizedBody}${normalizedBody.endsWith("\n") ? "" : "\n"}`;
}

export function targetFileNameForAgent(agent: CanonicalAgent): string {
  const slug = slugify(agent.name);
  return `${slug || "agent"}.md`;
}

export function getProviderConfig(
  frontmatter: AgentFrontmatter,
  provider: Provider,
): Record<string, unknown> | null {
  const value = frontmatter[provider];
  if (value === false) return null;
  if (isObject(value)) return value;
  return {};
}

export function isProviderEnabled(
  frontmatter: AgentFrontmatter,
  provider: Provider,
): boolean {
  return frontmatter[provider] !== false;
}
