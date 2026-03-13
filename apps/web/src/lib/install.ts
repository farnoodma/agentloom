import type { CatalogEntityType } from "@/lib/catalog";

export interface InstallTarget {
  entityType: CatalogEntityType;
  owner: string;
  repo: string;
  displayName: string;
}

export function buildInstallCommand(target: InstallTarget): string {
  const source = `https://github.com/${target.owner}/${target.repo}`;
  const selector = quoteShellArg(target.displayName);
  if (target.entityType === "agent") {
    return `npx agentloom agent add ${source} --agents ${selector}`;
  }
  if (target.entityType === "command") {
    return `npx agentloom command add ${source} --commands ${selector}`;
  }
  if (target.entityType === "skill") {
    return `npx agentloom skill add ${source} --skills ${selector}`;
  }
  if (target.entityType === "rule") {
    return `npx agentloom rule add ${source} --rules ${selector}`;
  }
  return `npx agentloom mcp add ${source} --mcps ${selector}`;
}

function quoteShellArg(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith("-")) return value;
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}
