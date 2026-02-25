import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { isObject, listMarkdownFiles, slugify } from "./fs.js";
import { ALL_PROVIDERS } from "../types.js";
import type { Provider } from "../types.js";

export interface CanonicalCommandFile {
  fileName: string;
  sourcePath: string;
  content: string;
  body: string;
  frontmatter?: Record<string, unknown>;
}

export function parseCommandsDir(commandsDir: string): CanonicalCommandFile[] {
  if (!fs.existsSync(commandsDir)) return [];

  return listMarkdownFiles(commandsDir)
    .sort((a, b) => a.localeCompare(b))
    .map((sourcePath) => {
      const content = fs.readFileSync(sourcePath, "utf8");
      const fileName = path.basename(sourcePath);
      const parsed = parseCommandContent(content);

      return {
        fileName,
        sourcePath,
        content,
        body: parsed.body,
        frontmatter: parsed.frontmatter,
      };
    });
}

export function parseCommandContent(content: string): {
  body: string;
  frontmatter?: Record<string, unknown>;
} {
  const parsed = matter(content);
  if (
    isObject(parsed.data) &&
    Object.keys(parsed.data as Record<string, unknown>).length > 0
  ) {
    return {
      body: parsed.content.trimStart(),
      frontmatter: parsed.data as Record<string, unknown>,
    };
  }

  return {
    body: content,
  };
}

export function getCommandProviderConfig(
  command: CanonicalCommandFile,
  provider: Provider,
): Record<string, unknown> | null {
  if (!command.frontmatter) return {};
  const value = command.frontmatter[provider];
  if (value === false) return null;
  if (isObject(value)) return value;
  return {};
}

export function isCommandProviderEnabled(
  command: CanonicalCommandFile,
  provider: Provider,
): boolean {
  return getCommandProviderConfig(command, provider) !== null;
}

export function renderCommandForProvider(
  command: CanonicalCommandFile,
  provider: Provider,
): string | null {
  if (!isCommandProviderEnabled(command, provider)) {
    return null;
  }
  const providerConfig = getCommandProviderConfig(command, provider);
  if (providerConfig === null) {
    return null;
  }

  const body = command.frontmatter ? command.body : command.content;
  const normalizedBody = normalizeCommandArgumentsForProvider(body, provider);
  const frontmatter = buildProviderCommandFrontmatter(command, providerConfig);
  if (Object.keys(frontmatter).length === 0) {
    return normalizedBody;
  }

  const fm = YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${fm}\n---\n\n${normalizedBody.trimStart()}${normalizedBody.endsWith("\n") ? "" : "\n"}`;
}

function buildProviderCommandFrontmatter(
  command: CanonicalCommandFile,
  providerConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...getSharedCommandMetadata(command.frontmatter),
    ...providerConfig,
  };
}

function getSharedCommandMetadata(
  frontmatter: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!frontmatter) return {};

  const shared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (ALL_PROVIDERS.includes(key as Provider)) continue;
    shared[key] = value;
  }
  return shared;
}

const COMMAND_ARGUMENT_PLACEHOLDER_BY_PROVIDER: Partial<
  Record<Provider, string>
> = {
  copilot: "${input:args}",
};

function normalizeCommandArgumentsForProvider(
  body: string,
  provider: Provider,
): string {
  const providerPlaceholder =
    COMMAND_ARGUMENT_PLACEHOLDER_BY_PROVIDER[provider];
  if (!providerPlaceholder || providerPlaceholder === "$ARGUMENTS") {
    return body;
  }

  return body.replace(/\$ARGUMENTS\b/g, providerPlaceholder);
}

export function stripCommandFileExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".prompt.md")) {
    return fileName.slice(0, -".prompt.md".length);
  }

  const ext = path.extname(fileName);
  if (!ext) return fileName;
  return fileName.slice(0, -ext.length);
}

export function commandFileMatchesSelector(
  fileName: string,
  selector: string,
): boolean {
  const raw = selector.trim().toLowerCase();
  if (!raw) return false;

  const normalizedSelector = normalizeCommandSelector(raw);
  const normalizedFileName = fileName.toLowerCase();
  const withoutExt = stripCommandFileExtension(normalizedFileName);

  if (normalizedFileName === raw || normalizedFileName === normalizedSelector) {
    return true;
  }

  if (withoutExt === raw || withoutExt === normalizedSelector) {
    return true;
  }

  if (
    slugify(withoutExt) === normalizedSelector ||
    slugify(withoutExt) === slugify(normalizedSelector)
  ) {
    return true;
  }

  return false;
}

export function normalizeCommandSelector(selector: string): string {
  const trimmed = selector.trim().replace(/^\/+/, "");
  return stripCommandFileExtension(trimmed).toLowerCase();
}

export function resolveCommandSelections(
  commands: CanonicalCommandFile[],
  selectors: string[],
): {
  selected: CanonicalCommandFile[];
  unmatched: string[];
} {
  const uniqueSelected = new Map<string, CanonicalCommandFile>();
  const unmatched: string[] = [];

  for (const selector of selectors) {
    const matches = commands.filter((command) =>
      commandFileMatchesSelector(command.fileName, selector),
    );

    if (matches.length === 0) {
      unmatched.push(selector);
      continue;
    }

    for (const match of matches) {
      uniqueSelected.set(match.fileName, match);
    }
  }

  return {
    selected: [...uniqueSelected.values()],
    unmatched,
  };
}
