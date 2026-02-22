import type { CatalogEntityType } from "@/lib/catalog";

export interface GithubSourceDocument {
  content: string;
  resolvedPath: string;
  url: string;
}

function encodeGithubPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildRawUrl(owner: string, repo: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/HEAD/${encodeGithubPath(path)}`;
}

function candidatePaths(input: {
  entityType: CatalogEntityType;
  slug: string;
  sourceFilePath: string;
}): string[] {
  const dedupe = new Set<string>();
  const push = (value: string) => {
    const normalized = value.replace(/^\/+/, "");
    if (normalized !== "") {
      dedupe.add(normalized);
    }
  };

  push(input.sourceFilePath);

  if (input.entityType === "agent") {
    push(`agents/${input.slug}.md`);
    push(`.agents/agents/${input.slug}.md`);
  } else if (input.entityType === "command") {
    push(`commands/${input.slug}.md`);
    push(`prompts/${input.slug}.md`);
    push(`.agents/commands/${input.slug}.md`);
  } else if (input.entityType === "skill") {
    push(`skills/${input.slug}/SKILL.md`);
    push(`.agents/skills/${input.slug}/SKILL.md`);
    push("SKILL.md");
  } else {
    push("mcp.json");
    push(".agents/mcp.json");
  }

  return [...dedupe];
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2800);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "agentloom-directory",
        Accept: "text/plain, application/json;q=0.9, */*;q=0.1",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGithubSourceDocument(input: {
  owner: string;
  repo: string;
  entityType: CatalogEntityType;
  slug: string;
  sourceFilePath: string;
}): Promise<GithubSourceDocument | null> {
  const paths = candidatePaths(input);

  for (const path of paths) {
    const url = buildRawUrl(input.owner, input.repo, path);
    const content = await fetchText(url);
    if (content !== null) {
      return {
        content,
        resolvedPath: path,
        url,
      };
    }
  }

  return null;
}
