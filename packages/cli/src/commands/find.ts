import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import matter from "gray-matter";
import type { ParsedArgs } from "minimist";
import { parseAgentMarkdown, parseAgentsDir } from "../core/agents.js";
import { parseCommandsDir } from "../core/commands.js";
import { formatUsageError, getFindHelpText } from "../core/copy.js";
import { readCanonicalMcp } from "../core/mcp.js";
import { buildScopePaths } from "../core/scope.js";
import { parseSkillsDir } from "../core/skills.js";
import type { EntityType } from "../types.js";

const FIND_API_BASE =
  process.env.AGENTLOOM_FIND_API_BASE || "https://api.github.com";
const REQUEST_TIMEOUT_MS = 3500;
const DEFAULT_RESULT_LIMIT = 8;
const DEFAULT_REPO_SCAN_LIMIT = 10;
const MAX_INSTALLABILITY_CHECKS = 24;
const INSTALLABILITY_CHECK_BATCH_SIZE = 6;

type AgentSearchClient = (
  query: string,
  limit: number,
) => Promise<FoundAgent[] | SearchAgentsResult>;

interface FoundCommand {
  repo: string;
  commandName: string;
  filePath: string;
  fileUrl: string;
  source: string;
  stars: number;
  subdir?: string;
}

interface FoundMcpServer {
  repo: string;
  serverName: string;
  filePath: string;
  fileUrl: string;
  source: string;
  stars: number;
}

interface FoundSkill {
  repo: string;
  skillName: string;
  installSkillSelector?: string;
  filePath: string;
  fileUrl: string;
  source: string;
  stars: number;
  subdir?: string;
}

type SearchEntityResult<T> = {
  items: T[];
  failures: string[];
};

type GitHubRepoSearchResponse = {
  items?: unknown;
};

type GitHubRepoSearchItem = {
  full_name?: unknown;
  stargazers_count?: unknown;
  default_branch?: unknown;
  html_url?: unknown;
  clone_url?: unknown;
};

type GitHubTreeResponse = {
  tree?: unknown;
};

type GitHubTreeEntry = {
  path?: unknown;
  type?: unknown;
};

type GitHubContentsResponse = {
  type?: unknown;
  content?: unknown;
  encoding?: unknown;
};

type RepoCandidate = {
  fullName: string;
  stars: number;
  defaultBranch: string;
  repoWebUrl: string;
  installSource: string;
};

type RankedFoundAgent = {
  agent: FoundAgent;
  score: number;
};

type InstallabilityResult =
  | {
      installable: true;
    }
  | {
      installable: false;
      failure?: string;
    };

export type FoundAgent = {
  repo: string;
  agentName: string;
  filePath: string;
  fileUrl: string;
  source?: string;
  stars: number;
  subdir?: string;
};

export type SearchAgentsResult = {
  agents: FoundAgent[];
  failures: string[];
};

export async function runFindCommand(
  argv: ParsedArgs,
  searchClient: AgentSearchClient = searchAgentsWithDiagnostics,
): Promise<void> {
  const target: EntityType | "all" =
    searchClient === searchAgentsWithDiagnostics ? "all" : "agent";
  await runScopedFindCommand(argv, target, searchClient);
}

export async function runScopedFindCommand(
  argv: ParsedArgs,
  target: EntityType | "all",
  searchClient: AgentSearchClient = searchAgentsWithDiagnostics,
): Promise<void> {
  if (argv.help) {
    console.log(getFindHelpText());
    return;
  }

  const query = buildQueryFromArgs(argv);
  if (!query) {
    throw new Error(
      formatUsageError({
        issue: "Missing required <query>.",
        usage: "agentloom find <query>",
        example: "agentloom find reviewer",
      }),
    );
  }

  const shouldSearchAgents = target === "all" || target === "agent";
  const shouldSearchCommands = target === "all" || target === "command";
  const shouldSearchMcp = target === "all" || target === "mcp";
  const shouldSearchSkills = target === "all" || target === "skill";

  const agentResult = shouldSearchAgents
    ? normalizeSearchResult(await searchClient(query, DEFAULT_RESULT_LIMIT))
    : { agents: [], failures: [] };
  const commandResult = shouldSearchCommands
    ? await searchCommandsWithDiagnostics(
        query,
        DEFAULT_RESULT_LIMIT,
        FIND_API_BASE,
      )
    : { items: [], failures: [] };
  const mcpResult = shouldSearchMcp
    ? await searchMcpWithDiagnostics(query, DEFAULT_RESULT_LIMIT, FIND_API_BASE)
    : { items: [], failures: [] };
  const skillResult = shouldSearchSkills
    ? await searchSkillsWithDiagnostics(
        query,
        DEFAULT_RESULT_LIMIT,
        FIND_API_BASE,
      )
    : { items: [], failures: [] };

  if (target === "agent") {
    const results = agentResult.agents;
    const failures = agentResult.failures;

    if (results.length === 0) {
      if (failures.length > 0) {
        const details = failures.slice(0, 3).join("; ");
        throw new Error(
          `Agent search could not complete reliably (${failures.length} repository/file checks failed): ${details}`,
        );
      }
      console.log(`No shared agents found for "${query}".`);
      return;
    }

    const partialSuffix =
      failures.length > 0
        ? ` (partial results: ${failures.length} repository scan${failures.length === 1 ? "" : "s"} failed)`
        : "";
    console.log(
      `Found ${results.length} matching agent${results.length === 1 ? "" : "s"} for "${query}"${partialSuffix}:`,
    );
    console.log("");

    if (failures.length > 0) {
      console.log("Scan warnings:");
      for (const failure of failures.slice(0, 3)) {
        console.log(`  - ${failure}`);
      }
      if (failures.length > 3) {
        console.log(`  - ...and ${failures.length - 3} more`);
      }
      console.log("");
    }

    for (const result of results) {
      console.log(
        `${result.repo}@${result.agentName}${formatStars(result.stars)} (${result.filePath})`,
      );
      console.log(`  ${result.fileUrl}`);
      console.log(`  Install: ${buildInstallCommand(result)}`);
      console.log("");
    }
    return;
  }

  const local = searchLocalMatches(query, target);
  const total =
    agentResult.agents.length +
    commandResult.items.length +
    mcpResult.items.length +
    skillResult.items.length +
    local.total;

  if (total === 0) {
    const failureCount =
      agentResult.failures.length +
      commandResult.failures.length +
      mcpResult.failures.length +
      skillResult.failures.length;
    if (failureCount > 0) {
      throw new Error(
        `Search returned no results and encountered ${failureCount} remote scan failure(s).`,
      );
    }
    console.log(`No matches found for "${query}".`);
    return;
  }

  console.log(`Found ${total} match(es) for "${query}".`);
  console.log("");

  if (local.total > 0) {
    console.log("Local matches:");
    for (const item of local.lines) {
      console.log(`  - ${item}`);
    }
    console.log("");
  }

  if (agentResult.agents.length > 0) {
    console.log("Agent matches:");
    for (const result of agentResult.agents) {
      console.log(
        `  - ${result.repo}@${result.agentName}${formatStars(result.stars)} (${result.filePath})`,
      );
      console.log(`    ${result.fileUrl}`);
      console.log(`    Install: ${buildInstallCommand(result)}`);
    }
    console.log("");
  }

  if (commandResult.items.length > 0) {
    console.log("Command matches:");
    for (const result of commandResult.items) {
      console.log(
        `  - ${result.repo}@${result.commandName}${formatStars(result.stars)} (${result.filePath})`,
      );
      console.log(`    ${result.fileUrl}`);
      console.log(`    Install: ${buildCommandInstallCommand(result)}`);
    }
    console.log("");
  }

  if (mcpResult.items.length > 0) {
    console.log("MCP matches:");
    for (const result of mcpResult.items) {
      console.log(
        `  - ${result.repo}@${result.serverName}${formatStars(result.stars)} (${result.filePath})`,
      );
      console.log(`    ${result.fileUrl}`);
      console.log(`    Install: ${buildMcpInstallCommand(result)}`);
    }
    console.log("");
  }

  if (skillResult.items.length > 0) {
    console.log("Skill matches:");
    for (const result of skillResult.items) {
      console.log(
        `  - ${result.repo}@${result.skillName}${formatStars(result.stars)} (${result.filePath})`,
      );
      console.log(`    ${result.fileUrl}`);
      console.log(`    Install: ${buildSkillInstallCommand(result)}`);
    }
    console.log("");
  }

  const failures = [
    ...agentResult.failures,
    ...commandResult.failures,
    ...mcpResult.failures,
    ...skillResult.failures,
  ];
  if (failures.length > 0) {
    console.log("Warnings:");
    for (const failure of failures.slice(0, 5)) {
      console.log(`  - ${failure}`);
    }
  }
}

function buildQueryFromArgs(argv: ParsedArgs): string {
  const root = String(argv._[0] ?? "")
    .trim()
    .toLowerCase();
  const action = String(argv._[1] ?? "")
    .trim()
    .toLowerCase();
  const positionalStartIndex = root === "find" ? 1 : action === "find" ? 2 : 1;

  const positionalTokens = argv._.slice(positionalStartIndex)
    .map((value) => String(value).trim())
    .filter(Boolean);
  const passthroughTokens = Array.isArray(argv["--"])
    ? argv["--"].map((value) => String(value).trim()).filter(Boolean)
    : [];

  return positionalTokens.concat(passthroughTokens).join(" ").trim();
}

export async function searchAgents(
  query: string,
  limit: number = DEFAULT_RESULT_LIMIT,
  apiBase: string = FIND_API_BASE,
): Promise<FoundAgent[]> {
  const result = await searchAgentsWithDiagnostics(query, limit, apiBase);
  return result.agents;
}

export async function searchAgentsWithDiagnostics(
  query: string,
  limit: number = DEFAULT_RESULT_LIMIT,
  apiBase: string = FIND_API_BASE,
): Promise<SearchAgentsResult> {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const repos = await searchReposByQuery(query, apiBase);
  if (repos.length === 0) {
    return { agents: [], failures: [] };
  }

  const candidates = repos.slice(0, DEFAULT_REPO_SCAN_LIMIT);
  const scanned = await Promise.allSettled(
    candidates.map(async (repo) => {
      try {
        return await findAgentsInRepo(repo, tokens, apiBase);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${repo.fullName}: ${reason}`);
      }
    }),
  );

  const flattened: RankedFoundAgent[] = [];
  const failures: string[] = [];
  for (const result of scanned) {
    if (result.status === "fulfilled") {
      flattened.push(...result.value);
      continue;
    }

    failures.push(
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason),
    );
  }

  if (flattened.length === 0 && failures.length > 0) {
    const details = failures.slice(0, 3).join("; ");
    throw new Error(
      `Agent search could not complete repository scans (${failures.length} failed): ${details}`,
    );
  }

  flattened.sort(compareRankedFoundAgents);
  const { selected: installable, failures: installabilityFailures } =
    await selectInstallableCandidates(flattened, limit, apiBase);

  if (installable.length === 0 && installabilityFailures.length > 0) {
    const details = installabilityFailures.slice(0, 3).join("; ");
    throw new Error(
      `Agent search could not validate candidate agents (${installabilityFailures.length} file fetch${installabilityFailures.length === 1 ? "" : "es"} failed): ${details}`,
    );
  }

  const allFailures = failures.concat(installabilityFailures);

  return {
    agents: installable.map((item) => item.agent),
    failures: allFailures,
  };
}

async function searchCommandsWithDiagnostics(
  query: string,
  limit: number,
  apiBase: string,
): Promise<SearchEntityResult<FoundCommand>> {
  const tokens = tokenizeQuery(query);
  const repos = await searchReposByQuery(query, apiBase);
  const candidates = repos.slice(0, DEFAULT_REPO_SCAN_LIMIT);

  const scanned = await Promise.allSettled(
    candidates.map(async (repo) => {
      const tree = await getRepoTree(repo, apiBase);
      const matches: FoundCommand[] = [];

      for (const entry of tree) {
        if (entry.type !== "blob") continue;
        const filePath = toTrimmedString(entry.path);
        if (!filePath) continue;

        const parsed = parseCommandPath(filePath);
        if (!parsed) continue;

        const haystack =
          `${repo.fullName} ${filePath} ${parsed.commandName}`.toLowerCase();
        if (
          tokens.length > 0 &&
          !tokens.some((token) => haystack.includes(token))
        ) {
          continue;
        }

        matches.push({
          repo: repo.fullName,
          commandName: parsed.commandName,
          filePath,
          fileUrl: `${repo.repoWebUrl}/blob/${repo.defaultBranch}/${filePath}`,
          source: repo.installSource,
          stars: repo.stars,
          subdir: parsed.subdir,
        });
      }

      return matches;
    }),
  );

  return normalizeEntityScanResults(scanned, limit);
}

async function searchMcpWithDiagnostics(
  query: string,
  limit: number,
  apiBase: string,
): Promise<SearchEntityResult<FoundMcpServer>> {
  const tokens = tokenizeQuery(query);
  const repos = await searchReposByQuery(query, apiBase);
  const candidates = repos.slice(0, DEFAULT_REPO_SCAN_LIMIT);

  const scanned = await Promise.allSettled(
    candidates.map(async (repo) => {
      const tree = await getRepoTree(repo, apiBase);
      const mcpFiles = tree
        .filter((entry) => entry.type === "blob")
        .map((entry) => toTrimmedString(entry.path))
        .filter(Boolean)
        .filter((filePath) => isMcpPath(filePath));

      const matches: FoundMcpServer[] = [];

      for (const filePath of mcpFiles) {
        try {
          const content = await fetchRepositoryFile(
            repo.fullName,
            filePath,
            apiBase,
          );
          const parsed = JSON.parse(content) as {
            mcpServers?: Record<string, unknown>;
          };
          const serverNames = Object.keys(parsed.mcpServers ?? {});

          for (const serverName of serverNames) {
            const haystack =
              `${repo.fullName} ${filePath} ${serverName}`.toLowerCase();
            if (
              tokens.length > 0 &&
              !tokens.some((token) => haystack.includes(token))
            ) {
              continue;
            }

            matches.push({
              repo: repo.fullName,
              serverName,
              filePath,
              fileUrl: `${repo.repoWebUrl}/blob/${repo.defaultBranch}/${filePath}`,
              source: repo.installSource,
              stars: repo.stars,
            });
          }
        } catch {
          // Ignore invalid mcp files and continue scanning.
        }
      }

      return matches;
    }),
  );

  return normalizeEntityScanResults(
    scanned,
    limit,
    (item) =>
      `${item.repo}::${item.filePath}::${item.serverName.toLowerCase()}`,
  );
}

async function searchSkillsWithDiagnostics(
  query: string,
  limit: number,
  apiBase: string,
): Promise<SearchEntityResult<FoundSkill>> {
  const tokens = tokenizeQuery(query);
  const repos = await searchReposByQuery(query, apiBase);
  const candidates = repos.slice(0, DEFAULT_REPO_SCAN_LIMIT);

  const scanned = await Promise.allSettled(
    candidates.map(async (repo) => {
      const tree = await getRepoTree(repo, apiBase);
      const matches: FoundSkill[] = [];

      for (const entry of tree) {
        if (entry.type !== "blob") continue;
        const filePath = toTrimmedString(entry.path);
        if (!filePath) continue;

        const parsed = parseSkillPath(filePath);
        if (!parsed) continue;

        let skillName = parsed.skillName;
        let installSkillSelector: string | undefined = parsed.skillName;

        if (parsed.isRootSkill) {
          installSkillSelector = undefined;
          try {
            const content = await fetchRepositoryFile(
              repo.fullName,
              filePath,
              apiBase,
            );
            const frontmatterName = parseSkillNameFromMarkdown(content);
            if (frontmatterName) {
              skillName = frontmatterName;
              installSkillSelector = frontmatterName;
            }
          } catch {
            // Keep root-skill fallback naming when source content cannot be fetched.
          }
        }

        const haystack =
          `${repo.fullName} ${filePath} ${skillName}`.toLowerCase();
        if (
          tokens.length > 0 &&
          !tokens.some((token) => haystack.includes(token))
        ) {
          continue;
        }

        matches.push({
          repo: repo.fullName,
          skillName,
          installSkillSelector,
          filePath,
          fileUrl: `${repo.repoWebUrl}/blob/${repo.defaultBranch}/${filePath}`,
          source: repo.installSource,
          stars: repo.stars,
          subdir: parsed.subdir,
        });
      }

      return matches;
    }),
  );

  return normalizeEntityScanResults(scanned, limit);
}

async function searchReposByQuery(
  query: string,
  apiBase: string,
): Promise<RepoCandidate[]> {
  const url = buildApiUrl(apiBase, "search/repositories");
  url.searchParams.set("q", `${query} in:name,description,readme`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "20");

  const payload = await requestJson(url);
  if (!isGitHubRepoSearchResponse(payload)) return [];

  const repos: RepoCandidate[] = [];
  for (const item of payload.items) {
    const fullName = toTrimmedString(item.full_name);
    const defaultBranch = toTrimmedString(item.default_branch) || "main";
    if (!fullName) continue;

    const starsRaw = item.stargazers_count;
    const stars =
      typeof starsRaw === "number" && Number.isFinite(starsRaw) && starsRaw > 0
        ? Math.floor(starsRaw)
        : 0;

    const htmlUrl = normalizeUrl(toTrimmedString(item.html_url));
    const cloneUrl = toTrimmedString(item.clone_url);
    const repoWebUrl =
      htmlUrl ||
      deriveRepoWebUrlFromClone(cloneUrl) ||
      deriveRepoWebUrlFromApiBase(apiBase, fullName);
    const installSource = deriveInstallSource({
      fullName,
      cloneUrl,
      apiBase,
      repoWebUrl,
    });

    repos.push({
      fullName,
      stars,
      defaultBranch,
      repoWebUrl,
      installSource,
    });
  }

  return repos;
}

async function findAgentsInRepo(
  repo: RepoCandidate,
  tokens: string[],
  apiBase: string,
): Promise<RankedFoundAgent[]> {
  const tree = await getRepoTree(repo, apiBase);
  const matches: RankedFoundAgent[] = [];
  for (const entry of tree) {
    if (entry.type !== "blob") continue;
    const filePath = toTrimmedString(entry.path);
    if (!filePath) continue;

    const parsed = parseAgentPath(filePath);
    if (!parsed) continue;

    const haystack =
      `${repo.fullName} ${filePath} ${parsed.agentName}`.toLowerCase();
    const matchCount = tokens.filter((token) =>
      haystack.includes(token),
    ).length;
    if (tokens.length > 0 && matchCount === 0) continue;

    matches.push({
      score: matchCount,
      agent: {
        repo: repo.fullName,
        agentName: parsed.agentName,
        filePath,
        fileUrl: `${repo.repoWebUrl}/blob/${repo.defaultBranch}/${filePath}`,
        source: repo.installSource,
        stars: repo.stars,
        subdir: parsed.subdir,
      },
    });
  }

  return matches;
}

async function getRepoTree(
  repo: RepoCandidate,
  apiBase: string,
): Promise<GitHubTreeEntry[]> {
  const branch = encodeURIComponent(repo.defaultBranch);
  const url = buildApiUrl(
    apiBase,
    `repos/${repo.fullName}/git/trees/${branch}`,
  );
  url.searchParams.set("recursive", "1");

  const payload = await requestJson(url);
  if (!isGitHubTreeResponse(payload)) {
    throw new Error(
      `Agent search returned an invalid tree response for ${repo.fullName}.`,
    );
  }
  return payload.tree;
}

function parseAgentPath(
  filePath: string,
): { agentName: string; subdir?: string } | null {
  const directAgentloom = filePath.match(/^\.agents\/agents\/([^/]+)\.md$/);
  if (directAgentloom) {
    return { agentName: directAgentloom[1] };
  }

  const nestedAgentloom = filePath.match(
    /^(.+)\/\.agents\/agents\/([^/]+)\.md$/,
  );
  if (nestedAgentloom) {
    return {
      subdir: nestedAgentloom[1],
      agentName: nestedAgentloom[2],
    };
  }

  const directAgents = filePath.match(/^agents\/([^/]+)\.md$/);
  if (directAgents) {
    return { agentName: directAgents[1] };
  }

  const nestedAgents = filePath.match(/^(.+)\/agents\/([^/]+)\.md$/);
  if (nestedAgents) {
    return {
      subdir: nestedAgents[1],
      agentName: nestedAgents[2],
    };
  }

  return null;
}

function parseCommandPath(
  filePath: string,
): { commandName: string; subdir?: string } | null {
  const directAgentloom = filePath.match(
    /^\.agents\/commands\/([^/]+)\.(md|mdc)$/i,
  );
  if (directAgentloom) {
    return { commandName: directAgentloom[1] };
  }

  const nestedAgentloom = filePath.match(
    /^(.+)\/\.agents\/commands\/([^/]+)\.(md|mdc)$/i,
  );
  if (nestedAgentloom) {
    return {
      subdir: nestedAgentloom[1],
      commandName: nestedAgentloom[2],
    };
  }

  const directCommands = filePath.match(/^commands\/([^/]+)\.(md|mdc)$/i);
  if (directCommands) {
    return { commandName: directCommands[1] };
  }

  const nestedCommands = filePath.match(/^(.+)\/commands\/([^/]+)\.(md|mdc)$/i);
  if (nestedCommands) {
    return {
      subdir: nestedCommands[1],
      commandName: nestedCommands[2],
    };
  }

  const directPrompts = filePath.match(/^prompts\/([^/]+)\.(md|mdc)$/i);
  if (directPrompts) {
    return { commandName: directPrompts[1] };
  }

  const nestedPrompts = filePath.match(/^(.+)\/prompts\/([^/]+)\.(md|mdc)$/i);
  if (nestedPrompts) {
    return {
      subdir: nestedPrompts[1],
      commandName: nestedPrompts[2],
    };
  }

  return null;
}

function parseSkillPath(
  filePath: string,
): { skillName: string; subdir?: string; isRootSkill?: boolean } | null {
  const directAgentloom = filePath.match(
    /^\.agents\/skills\/([^/]+)\/SKILL\.md$/i,
  );
  if (directAgentloom) {
    return { skillName: directAgentloom[1] };
  }

  const nestedAgentloom = filePath.match(
    /^(.+)\/\.agents\/skills\/([^/]+)\/SKILL\.md$/i,
  );
  if (nestedAgentloom) {
    return {
      subdir: nestedAgentloom[1],
      skillName: nestedAgentloom[2],
    };
  }

  const directSkills = filePath.match(/^skills\/([^/]+)\/SKILL\.md$/i);
  if (directSkills) {
    return { skillName: directSkills[1] };
  }

  const nestedSkills = filePath.match(/^(.+)\/skills\/([^/]+)\/SKILL\.md$/i);
  if (nestedSkills) {
    return {
      subdir: nestedSkills[1],
      skillName: nestedSkills[2],
    };
  }

  const directRootSkill = filePath.match(/^SKILL\.md$/i);
  if (directRootSkill) {
    return {
      skillName: "SKILL",
      isRootSkill: true,
    };
  }

  const nestedRootSkill = filePath.match(/^(.+)\/SKILL\.md$/i);
  if (nestedRootSkill) {
    return {
      subdir: nestedRootSkill[1],
      skillName: path.basename(nestedRootSkill[1]),
      isRootSkill: true,
    };
  }

  return null;
}

function isMcpPath(filePath: string): boolean {
  return (
    /^mcp\.json$/i.test(filePath) ||
    /^\.agents\/mcp\.json$/i.test(filePath) ||
    /\/mcp\.json$/i.test(filePath)
  );
}

async function selectInstallableCandidates(
  candidates: RankedFoundAgent[],
  limit: number,
  apiBase: string,
): Promise<{ selected: RankedFoundAgent[]; failures: string[] }> {
  const selected: RankedFoundAgent[] = [];
  const failures: string[] = [];
  const selectedKeys = new Set<string>();
  let checked = 0;

  for (
    let index = 0;
    index < candidates.length &&
    selected.length < limit &&
    checked < MAX_INSTALLABILITY_CHECKS;
    index += INSTALLABILITY_CHECK_BATCH_SIZE
  ) {
    const maxBatchSize = Math.min(
      INSTALLABILITY_CHECK_BATCH_SIZE,
      MAX_INSTALLABILITY_CHECKS - checked,
    );
    const batch = candidates
      .slice(index, index + maxBatchSize)
      .filter(
        (candidate) => !selectedKeys.has(getAgentIdentityKey(candidate.agent)),
      );
    checked += batch.length;
    if (batch.length === 0) continue;

    const validated = await Promise.all(
      batch.map(async (candidate) => ({
        candidate,
        result: await isInstallableCandidate(candidate.agent, apiBase),
      })),
    );

    for (const item of validated) {
      const key = getAgentIdentityKey(item.candidate.agent);
      if (!item.result.installable) {
        if (item.result.failure) {
          failures.push(item.result.failure);
        }
        continue;
      }

      if (selectedKeys.has(key)) continue;

      selected.push(item.candidate);
      selectedKeys.add(key);
      if (selected.length >= limit) {
        break;
      }
    }
  }

  return { selected, failures };
}

function compareRankedFoundAgents(
  a: RankedFoundAgent,
  b: RankedFoundAgent,
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.agent.stars !== a.agent.stars) return b.agent.stars - a.agent.stars;

  const pathRankDelta = getPathRank(a.agent) - getPathRank(b.agent);
  if (pathRankDelta !== 0) return pathRankDelta;

  if (a.agent.filePath.length !== b.agent.filePath.length) {
    return a.agent.filePath.length - b.agent.filePath.length;
  }

  const repoDelta = a.agent.repo.localeCompare(b.agent.repo);
  if (repoDelta !== 0) return repoDelta;

  return a.agent.filePath.localeCompare(b.agent.filePath);
}

function getPathRank(agent: FoundAgent): number {
  const subdir = agent.subdir?.trim();
  if (!subdir) return 0;

  const hasHiddenSegment = subdir
    .split("/")
    .some((segment) => segment.startsWith("."));
  return hasHiddenSegment ? 2 : 1;
}

async function isInstallableCandidate(
  agent: FoundAgent,
  apiBase: string,
): Promise<InstallabilityResult> {
  let markdown: string;
  try {
    markdown = await fetchRepositoryFile(agent.repo, agent.filePath, apiBase);
  } catch (error) {
    return {
      installable: false,
      failure: `${agent.repo}/${agent.filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    parseAgentMarkdown(markdown, `${agent.repo}/${agent.filePath}`);
    return { installable: true };
  } catch {
    return { installable: false };
  }
}

function getAgentIdentityKey(agent: FoundAgent): string {
  return `${agent.repo}::${normalizeSubdirForIdentity(agent.subdir)}::${agent.agentName}`;
}

async function fetchRepositoryFile(
  repo: string,
  filePath: string,
  apiBase: string,
): Promise<string> {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = buildApiUrl(apiBase, `repos/${repo}/contents/${encodedPath}`);

  const payload = await requestJson(url);
  if (!isGitHubContentsResponse(payload)) {
    throw new Error(
      `Invalid repository file response for ${repo}/${filePath}.`,
    );
  }

  const base64 = payload.content.replace(/\n/g, "");
  return Buffer.from(base64, "base64").toString("utf8");
}

function normalizeSearchResult(
  value: FoundAgent[] | SearchAgentsResult,
): SearchAgentsResult {
  if (Array.isArray(value)) {
    return { agents: value, failures: [] };
  }
  return value;
}

function normalizeEntityScanResults<
  T extends { repo: string; filePath: string },
>(
  scanned: PromiseSettledResult<T[]>[],
  limit: number,
  getKey: (item: T) => string = (item) => `${item.repo}::${item.filePath}`,
): SearchEntityResult<T> {
  const items: T[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();

  for (const result of scanned) {
    if (result.status === "fulfilled") {
      for (const item of result.value) {
        const key = getKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
      continue;
    }

    failures.push(
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason),
    );
  }

  return {
    items: items.slice(0, limit),
    failures,
  };
}

function buildInstallCommand(result: FoundAgent): string {
  const source = result.source?.trim() || result.repo;
  const repoArg = quoteShellArg(source);
  if (result.subdir && result.subdir.trim()) {
    return `agentloom add ${repoArg} --subdir ${quoteShellArg(result.subdir)}`;
  }
  return `agentloom add ${repoArg}`;
}

function buildCommandInstallCommand(result: FoundCommand): string {
  const source = result.source?.trim() || result.repo;
  const repoArg = quoteShellArg(source);
  if (result.subdir && result.subdir.trim()) {
    return `agentloom command add ${repoArg} --subdir ${quoteShellArg(result.subdir)}`;
  }
  return `agentloom command add ${repoArg}`;
}

function buildMcpInstallCommand(result: FoundMcpServer): string {
  const source = result.source?.trim() || result.repo;
  return `agentloom mcp add ${quoteShellArg(source)} --mcps ${quoteShellArg(result.serverName)}`;
}

function buildSkillInstallCommand(result: FoundSkill): string {
  const source = result.source?.trim() || result.repo;
  const repoArg = quoteShellArg(source);
  const selector = result.installSkillSelector?.trim();
  if (result.subdir && result.subdir.trim()) {
    if (!selector) {
      return `agentloom skill add ${repoArg} --subdir ${quoteShellArg(result.subdir)}`;
    }
    return `agentloom skill add ${repoArg} --subdir ${quoteShellArg(result.subdir)} --skills ${quoteShellArg(selector)}`;
  }
  if (!selector) {
    return `agentloom skill add ${repoArg}`;
  }
  return `agentloom skill add ${repoArg} --skills ${quoteShellArg(selector)}`;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseSkillNameFromMarkdown(markdown: string): string | undefined {
  try {
    const parsed = matter(markdown);
    if (typeof parsed.data.name !== "string") return undefined;
    const name = parsed.data.name.trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

function searchLocalMatches(
  query: string,
  target: EntityType | "all",
): { lines: string[]; total: number } {
  const tokens = tokenizeQuery(query);
  const paths = buildScopePaths(process.cwd(), "local");
  const lines: string[] = [];

  if ((target === "all" || target === "agent") && fsExists(paths.agentsDir)) {
    const agents = parseAgentsDir(paths.agentsDir);
    for (const agent of agents) {
      if (!matchesTokens(`${agent.name} ${agent.fileName}`, tokens)) continue;
      lines.push(`agent: ${agent.name} (${agent.fileName})`);
    }
  }

  if (
    (target === "all" || target === "command") &&
    fsExists(paths.commandsDir)
  ) {
    const commands = parseCommandsDir(paths.commandsDir);
    for (const command of commands) {
      if (!matchesTokens(command.fileName, tokens)) continue;
      lines.push(`command: ${command.fileName}`);
    }
  }

  if ((target === "all" || target === "mcp") && fsExists(paths.mcpPath)) {
    const mcp = readCanonicalMcp(paths);
    for (const name of Object.keys(mcp.mcpServers)) {
      if (!matchesTokens(name, tokens)) continue;
      lines.push(`mcp: ${name}`);
    }
  }

  if ((target === "all" || target === "skill") && fsExists(paths.skillsDir)) {
    const skills = parseSkillsDir(paths.skillsDir);
    for (const skill of skills) {
      if (!matchesTokens(skill.name, tokens)) continue;
      lines.push(`skill: ${skill.name}`);
    }
  }

  return {
    lines,
    total: lines.length,
  };
}

function matchesTokens(value: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = value.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function fsExists(value: string): boolean {
  return fs.existsSync(value);
}

function normalizeSubdirForIdentity(subdir?: string): string {
  if (!subdir) return "";

  return subdir
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !segment.startsWith("."))
    .join("/");
}

function normalizeUrl(value: string): string {
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function deriveRepoWebUrlFromClone(cloneUrl: string): string {
  if (!cloneUrl) return "";

  const gitSshMatch = cloneUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (gitSshMatch) {
    return `https://${gitSshMatch[1]}/${gitSshMatch[2]}`;
  }

  try {
    const parsed = new URL(cloneUrl);
    parsed.pathname = parsed.pathname.replace(/\.git$/, "");
    parsed.search = "";
    parsed.hash = "";
    return normalizeUrl(parsed.toString());
  } catch {
    return "";
  }
}

function deriveRepoWebUrlFromApiBase(
  apiBase: string,
  fullName: string,
): string {
  const webBase = deriveWebBaseFromApiBase(apiBase);
  if (!webBase.pathname.endsWith("/")) {
    webBase.pathname = `${webBase.pathname}/`;
  }
  const repoUrl = new URL(fullName, webBase);
  return normalizeUrl(repoUrl.toString());
}

function deriveInstallSource(options: {
  fullName: string;
  cloneUrl: string;
  apiBase: string;
  repoWebUrl: string;
}): string {
  const cloneUrl = options.cloneUrl.trim();
  if (cloneUrl) {
    if (isPublicGitHubCloneUrl(cloneUrl)) {
      return options.fullName;
    }
    return cloneUrl;
  }

  if (isPublicGitHubApi(options.apiBase)) {
    return options.fullName;
  }

  return `${options.repoWebUrl}.git`;
}

function deriveWebBaseFromApiBase(apiBase: string): URL {
  const base = new URL(apiBase);
  base.search = "";
  base.hash = "";

  let pathname = base.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api/v3")) {
    pathname = pathname.slice(0, -"/api/v3".length);
  } else if (pathname.endsWith("/api")) {
    pathname = pathname.slice(0, -"/api".length);
  }
  base.pathname = pathname || "/";
  return base;
}

function isPublicGitHubApi(apiBase: string): boolean {
  try {
    const host = new URL(apiBase).hostname.toLowerCase();
    return host === "api.github.com" || host === "github.com";
  } catch {
    return false;
  }
}

function isPublicGitHubCloneUrl(cloneUrl: string): boolean {
  if (cloneUrl.startsWith("git@github.com:")) return true;

  try {
    return new URL(cloneUrl).hostname.toLowerCase() === "github.com";
  } catch {
    return false;
  }
}

function quoteShellArg(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith("-")) return value;
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function buildApiUrl(apiBase: string, relativePath: string): URL {
  const baseUrl = new URL(apiBase);
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }
  return new URL(relativePath.replace(/^\/+/, ""), baseUrl);
}

function formatStars(stars: number): string {
  if (!stars || stars <= 0) return "";
  return ` (${stars}★)`;
}

function toTrimmedString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isGitHubRepoSearchResponse(
  value: unknown,
): value is { items: GitHubRepoSearchItem[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as GitHubRepoSearchResponse).items)
  );
}

function isGitHubTreeResponse(
  value: unknown,
): value is { tree: GitHubTreeEntry[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as GitHubTreeResponse).tree)
  );
}

function isGitHubContentsResponse(
  value: unknown,
): value is { type: "file"; content: string; encoding: "base64" } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as GitHubContentsResponse).type === "file" &&
    typeof (value as GitHubContentsResponse).content === "string" &&
    (value as GitHubContentsResponse).encoding === "base64"
  );
}

function requestJson(url: URL): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "agentloom-cli",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const req = https.get(
      url,
      {
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (
            !res.statusCode ||
            res.statusCode < 200 ||
            res.statusCode >= 300
          ) {
            reject(
              new Error(
                `Agent search failed with status ${res.statusCode ?? 0}. ${
                  raw ? `Response: ${raw}` : ""
                }`.trim(),
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error("Agent search returned invalid JSON."));
          }
        });
      },
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error("Agent search request timed out."));
    });

    req.on("error", (error) => {
      reject(
        new Error(
          `Agent search request failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    });
  });
}
