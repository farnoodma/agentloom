import type { CatalogEntityType } from "@/lib/catalog";

export interface InstallTarget {
  entityType: CatalogEntityType;
  owner: string;
  repo: string;
  displayName: string;
}

export function buildInstallCommand(target: InstallTarget): string {
  const source = `https://github.com/${target.owner}/${target.repo}`;
  if (target.entityType === "agent") {
    return `npx agentloom agent add ${source} --agents ${target.displayName}`;
  }
  if (target.entityType === "command") {
    return `npx agentloom command add ${source} --commands ${target.displayName}`;
  }
  return `npx agentloom mcp add ${source} --mcps ${target.displayName}`;
}
