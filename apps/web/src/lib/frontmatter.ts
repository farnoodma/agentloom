export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface ParsedMarkdownSource {
  body: string;
  frontmatter: FrontmatterEntry[];
}

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function parseFrontmatter(rawFrontmatter: string): FrontmatterEntry[] {
  const lines = rawFrontmatter.replace(/\r\n/g, "\n").split("\n");
  const entries: FrontmatterEntry[] = [];
  let current: { key: string; lines: string[] } | null = null;

  const flushCurrent = () => {
    if (!current) return;
    const normalizedValue = current.lines.join("\n").replace(/\n+$/, "");
    entries.push({ key: current.key, value: normalizedValue });
  };

  for (const line of lines) {
    const keyMatch = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line);
    if (keyMatch && !line.startsWith(" ")) {
      flushCurrent();
      current = { key: keyMatch[1], lines: [] };
      const sameLineValue = keyMatch[2].trim();
      if (sameLineValue.length > 0) {
        current.lines.push(sameLineValue);
      }
      continue;
    }

    if (!current) {
      continue;
    }
    current.lines.push(line);
  }

  flushCurrent();
  return entries;
}

export function parseMarkdownSource(content: string): ParsedMarkdownSource {
  const match = FRONTMATTER_BLOCK.exec(content);
  if (!match) {
    return { body: content, frontmatter: [] };
  }

  const frontmatter = parseFrontmatter(match[1] ?? "");
  const body = content.slice(match[0].length);

  return {
    body: body.startsWith("\n") ? body.slice(1) : body,
    frontmatter,
  };
}
