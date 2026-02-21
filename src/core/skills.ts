import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Provider } from "../types.js";
import { slugify } from "./fs.js";

export interface CanonicalSkill {
  name: string;
  sourcePath: string;
  skillPath: string;
}

const PROVIDER_TO_SKILLS_AGENT: Record<Provider, string> = {
  cursor: "cursor",
  claude: "claude-code",
  codex: "codex",
  opencode: "opencode",
  gemini: "gemini",
  copilot: "copilot",
};

export function parseSkillsDir(skillsDir: string): CanonicalSkill[] {
  if (!fs.existsSync(skillsDir)) return [];

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: CanonicalSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;

    skills.push({
      name: entry.name,
      sourcePath: skillDir,
      skillPath: skillFile,
    });
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeSkillSelector(value: string): string {
  return slugify(value.trim().replace(/\/+$/, "")).toLowerCase();
}

export function resolveSkillSelections(
  skills: CanonicalSkill[],
  selectors: string[],
): { selected: CanonicalSkill[]; unmatched: string[] } {
  const normalizedSelectors = selectors
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeSkillSelector)
    .filter(Boolean);

  const selectedMap = new Map<string, CanonicalSkill>();
  const unmatched: string[] = [];

  for (const selector of normalizedSelectors) {
    const matches = skills.filter(
      (skill) => normalizeSkillSelector(skill.name) === selector,
    );

    if (matches.length === 0) {
      unmatched.push(selector);
      continue;
    }

    for (const match of matches) {
      selectedMap.set(match.name, match);
    }
  }

  return {
    selected: [...selectedMap.values()],
    unmatched,
  };
}

export function mapProvidersToSkillsAgents(providers: Provider[]): string[] {
  const mapped = providers.map((provider) => {
    const value = PROVIDER_TO_SKILLS_AGENT[provider];
    if (!value) {
      throw new Error(
        `No skills agent mapping configured for provider "${provider}".`,
      );
    }
    return value;
  });

  return [...new Set(mapped)];
}

export function runSkillsCommand(options: {
  args: string[];
  cwd?: string;
  inheritStdio?: boolean;
}): { status: number } {
  const child = spawnSync("npx", ["skills", ...options.args], {
    stdio: options.inheritStdio ? "inherit" : "pipe",
    shell: false,
    cwd: options.cwd,
    encoding: options.inheritStdio ? undefined : "utf8",
  });

  if (child.error) {
    throw child.error;
  }

  const status = child.status ?? 1;
  if (status !== 0) {
    const stderr =
      typeof child.stderr === "string" ? child.stderr.trim() : undefined;
    throw new Error(
      stderr && stderr.length > 0
        ? `skills command failed (${status}): ${stderr}`
        : `skills command failed (${status}).`,
    );
  }

  return { status };
}
