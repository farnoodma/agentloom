export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface ParsedMarkdownSource {
  body: string;
  frontmatter: FrontmatterEntry[];
}

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const BLOCK_SCALAR_INDICATOR = /^[|>][-+0-9]*$/;

function stripWrappingQuotes(value: string): string {
  if (value.includes("\n")) {
    return value;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function normalizeMultilineValue(lines: string[]): string {
  const withoutTrailingBlanks = [...lines];
  while (
    withoutTrailingBlanks.length > 0 &&
    withoutTrailingBlanks[withoutTrailingBlanks.length - 1].trim().length === 0
  ) {
    withoutTrailingBlanks.pop();
  }

  if (withoutTrailingBlanks.length === 0) {
    return "";
  }

  const nonEmptyLines = withoutTrailingBlanks.filter(
    (line) => line.trim().length > 0,
  );
  const minIndent = nonEmptyLines.reduce((minIndentSoFar, line) => {
    const indent = line.match(/^ */)?.[0].length ?? 0;
    return Math.min(minIndentSoFar, indent);
  }, Number.POSITIVE_INFINITY);

  const dedented =
    Number.isFinite(minIndent) && minIndent > 0
      ? withoutTrailingBlanks.map((line) =>
          line.startsWith(" ".repeat(minIndent))
            ? line.slice(minIndent)
            : line,
        )
      : withoutTrailingBlanks;

  return stripWrappingQuotes(dedented.join("\n").trim());
}

function parseFrontmatter(rawFrontmatter: string): FrontmatterEntry[] {
  const lines = rawFrontmatter.replace(/\r\n/g, "\n").split("\n");
  const entries: FrontmatterEntry[] = [];
  let current: { key: string; lines: string[] } | null = null;

  const flushCurrent = () => {
    if (!current) return;
    const normalizedValue = normalizeMultilineValue(current.lines);
    entries.push({ key: current.key, value: normalizedValue });
  };

  for (const line of lines) {
    const keyMatch = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line);
    if (keyMatch && !line.startsWith(" ")) {
      flushCurrent();
      current = { key: keyMatch[1], lines: [] };
      const sameLineValue = keyMatch[2].trim();
      if (
        sameLineValue.length > 0 &&
        !BLOCK_SCALAR_INDICATOR.test(sameLineValue)
      ) {
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
