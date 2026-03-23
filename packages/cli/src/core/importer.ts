import fs from "node:fs";
import path from "node:path";
import {
  cancel,
  isCancel,
  multiselect,
  select,
  text as promptText,
} from "@clack/prompts";
import TOML from "@iarna/toml";
import matter from "gray-matter";
import YAML from "yaml";
import type {
  CanonicalAgent,
  CanonicalMcpFile,
  EntityType,
  Provider,
  LockEntry,
  SelectionMode,
  ScopePaths,
} from "../types.js";
import {
  buildAgentMarkdown,
  parseAgentsDir,
  targetFileNameForAgent,
} from "./agents.js";
import {
  normalizeCommandArgumentsForCanonical,
  normalizeCommandSelector,
  parseCommandsDir,
  resolveCommandSelections,
} from "./commands.js";
import type { CanonicalCommandFile } from "./commands.js";
import {
  normalizeRuleSelector,
  parseRulesDir,
  resolveRuleSelections,
  stripRuleFileExtension,
  type CanonicalRuleFile,
} from "./rules.js";
import {
  applySkillProviderSideEffects,
  copySkillArtifacts,
  normalizeSkillSelector,
  parseSkillsDir,
  resolveSkillSelector,
  resolveSkillSelections,
  skillContentMatchesTarget,
  type CanonicalSkill,
} from "./skills.js";
import {
  ensureDir,
  hashContent,
  isObject,
  readJsonIfExists,
  relativePosix,
  slugify,
  writeTextAtomic,
} from "./fs.js";
import { ALL_PROVIDERS } from "../types.js";
import { readLockfile, upsertLockEntry, writeLockfile } from "./lockfile.js";
import { readCanonicalMcp, writeCanonicalMcp } from "./mcp.js";
import {
  discoverPluginSourceRoots,
  discoverSourceAgentsDirs,
  discoverSourceCommandsDirs,
  discoverSourceMcpPaths,
  discoverSourceRulesDirs,
  discoverSourceSkillsDirs,
  prepareSource,
} from "./sources.js";
import { isProviderEntityFileName } from "./provider-entity-validation.js";

export class NonInteractiveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonInteractiveConflictError";
  }
}

const MULTISELECT_HELP_TEXT = "↑↓ move, space select, enter confirm";

function withMultiselectHelp(message: string): string {
  return `${message}\n${MULTISELECT_HELP_TEXT}`;
}

export interface ImportOptions {
  source: string;
  ref?: string;
  subdir?: string;
  rename?: string;
  agents?: string[];
  promptForAgentSelection?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  paths: ScopePaths;
  importAgents?: boolean;
  requireAgents?: boolean;
  importCommands?: boolean;
  requireCommands?: boolean;
  importMcp?: boolean;
  requireMcp?: boolean;
  mcpSelectors?: string[];
  promptForMcp?: boolean;
  importRules?: boolean;
  requireRules?: boolean;
  ruleSelectors?: string[];
  promptForRules?: boolean;
  ruleRenameMap?: Record<string, string>;
  importSkills?: boolean;
  requireSkills?: boolean;
  skillSelectors?: string[];
  promptForSkills?: boolean;
  skillsProviders?: Provider[];
  resolveSkillsProviders?: () => Promise<Provider[] | undefined>;
  skillRenameMap?: Record<string, string>;
  selectionMode?: SelectionMode;
  commandSelectors?: string[];
  commandRenameMap?: Record<string, string>;
  promptForCommands?: boolean;
}

export interface ImportSummary {
  source: string;
  sourceType: "local" | "github" | "git";
  importedAgents: string[];
  importedCommands: string[];
  importedMcpServers: string[];
  importedRules: string[];
  importedSkills: string[];
  telemetryRules?: Array<{ name: string; filePath: string }>;
  telemetrySkills?: Array<{ name: string; filePath: string }>;
  resolvedCommit: string;
}

interface AgentsToImportResult {
  selectedAgents: CanonicalAgent[];
  requestedAgentsForLock?: string[];
}

interface CommandSelectionResult {
  selectedCommands: ReturnType<typeof parseCommandsDir>;
  selectionMode: SelectionMode;
}

interface McpSelectionResult {
  selectedServerNames: string[];
  selectionMode: SelectionMode;
}

interface SkillSelectionResult {
  selectedSkills: CanonicalSkill[];
  selectedSourceSkills: string[];
  selectionMode: SelectionMode;
}

interface RuleSelectionResult {
  selectedRules: CanonicalRuleFile[];
  selectionMode: SelectionMode;
}

interface SelectionModeResolution {
  selectionMode: SelectionMode;
  skipImport: boolean;
}

export async function importSource(
  options: ImportOptions,
): Promise<ImportSummary> {
  const shouldImportAgents = options.importAgents ?? true;
  const requireAgents = options.requireAgents ?? shouldImportAgents;
  const shouldImportCommands = options.importCommands ?? true;
  const shouldImportMcp = options.importMcp ?? true;
  const shouldImportRules = options.importRules ?? false;
  const requireRules = options.requireRules ?? shouldImportRules;
  const shouldImportSkills = options.importSkills ?? false;

  if (
    !shouldImportAgents &&
    !shouldImportCommands &&
    !shouldImportMcp &&
    !shouldImportRules &&
    !shouldImportSkills
  ) {
    throw new Error("No import targets selected.");
  }

  const prepared = prepareSource({
    source: options.source,
    ref: options.ref,
    subdir: options.subdir,
  });
  const normalizedSubdir = options.subdir?.replace(/^\/+|\/+$/g, "");
  const sourceLocation =
    prepared.spec.type === "github"
      ? `https://github.com/${prepared.spec.source}/tree/${prepared.resolvedCommit}${normalizedSubdir ? `/${normalizedSubdir}` : ""}`
      : options.subdir
        ? `${options.source} (subdir: ${options.subdir})`
        : options.source;

  try {
    const pluginSourceRoots = discoverPluginSourceRoots(prepared.importRoot);
    const sourceAgentsDirs = shouldImportAgents
      ? discoverSourceAgentsDirs(prepared.importRoot)
      : [];
    const sourceCommandsDirs = shouldImportCommands
      ? discoverSourceCommandsDirs(prepared.importRoot)
      : [];
    const sourceMcpPaths = shouldImportMcp
      ? discoverSourceMcpPaths(prepared.importRoot)
      : [];
    const sourceRulesDirs = shouldImportRules
      ? discoverSourceRulesDirs(prepared.importRoot)
      : [];
    const sourceSkillsDirs = shouldImportSkills
      ? discoverSourceSkillsDirs(prepared.importRoot)
      : [];

    const sourceAgents =
      sourceAgentsDirs.length > 0
        ? parseSourceAgentsForImport(sourceAgentsDirs, pluginSourceRoots)
        : [];
    const sourceCommands =
      sourceCommandsDirs.length > 0
        ? parseSourceCommandsForImport(sourceCommandsDirs, pluginSourceRoots)
        : [];
    const sourceMcp =
      sourceMcpPaths.length > 0
        ? parseSourceMcpForImport(sourceMcpPaths, pluginSourceRoots)
        : null;
    const sourceRules =
      sourceRulesDirs.length > 0
        ? parseSourceRulesForImport(sourceRulesDirs, pluginSourceRoots)
        : [];
    const sourceSkills =
      sourceSkillsDirs.length > 0
        ? parseSourceSkillsForImport(sourceSkillsDirs, pluginSourceRoots)
        : [];
    const sourceAgentsDir = sourceAgentsDirs[0] ?? null;
    const sourceCommandsDir = sourceCommandsDirs[0] ?? null;
    const sourceMcpPath = sourceMcpPaths[0] ?? null;
    const sourceRulesDir = sourceRulesDirs[0] ?? null;
    const sourceSkillsDir = sourceSkillsDirs[0] ?? null;
    const hasExplicitCommandSelection =
      (options.commandSelectors?.length ?? 0) > 0;
    const isAggregateImport =
      shouldImportAgents &&
      shouldImportCommands &&
      shouldImportMcp &&
      (options.importRules === undefined || shouldImportRules) &&
      shouldImportSkills;

    if (shouldImportAgents && requireAgents && sourceAgentsDirs.length === 0) {
      throw new Error(
        `No source agents directory found under ${prepared.importRoot} (expected agents/, .agents/agents/, or .github/agents/, including plugin sources declared in .claude-plugin/marketplace.json).`,
      );
    }
    if (shouldImportAgents && requireAgents && sourceAgents.length === 0) {
      throw new Error(`No agent files found in ${sourceAgentsDir}.`);
    }
    if (
      shouldImportCommands &&
      options.requireCommands &&
      sourceCommandsDirs.length === 0
    ) {
      throw new Error(
        `No source commands directory found under ${prepared.importRoot} (expected .agents/commands/, commands/, prompts/, .gemini/commands/, or .github/prompts/, including plugin sources declared in .claude-plugin/marketplace.json).`,
      );
    }
    if (
      shouldImportCommands &&
      options.requireCommands &&
      sourceCommands.length === 0
    ) {
      throw new Error(`No command files found in ${sourceCommandsDir}.`);
    }
    if (shouldImportMcp && options.requireMcp && sourceMcpPaths.length === 0) {
      throw new Error(
        `No source mcp.json found under ${prepared.importRoot} (expected mcp.json or .agents/mcp.json, including plugin sources declared in .claude-plugin/marketplace.json).`,
      );
    }
    if (shouldImportRules && requireRules && sourceRulesDirs.length === 0) {
      throw new Error(
        `No source rules directory found under ${prepared.importRoot} (expected .agents/rules/ or rules/, including plugin sources declared in .claude-plugin/marketplace.json).`,
      );
    }
    if (shouldImportRules && requireRules && sourceRules.length === 0) {
      throw new Error(`No rule files found in ${sourceRulesDir}.`);
    }
    if (
      shouldImportSkills &&
      options.requireSkills &&
      sourceSkillsDirs.length === 0
    ) {
      throw new Error(
        `No source skills directory found under ${prepared.importRoot} (expected .agents/skills/, skills/, root SKILL.md, or root <name>/SKILL.md directories, including plugin sources declared in .claude-plugin/marketplace.json).`,
      );
    }
    if (
      shouldImportSkills &&
      options.requireSkills &&
      sourceSkills.length === 0
    ) {
      throw new Error(`No skills found in ${sourceSkillsDir}.`);
    }

    if (
      isAggregateImport &&
      sourceAgents.length === 0 &&
      sourceCommands.length === 0 &&
      sourceRules.length === 0 &&
      sourceSkills.length === 0 &&
      Object.keys(sourceMcp?.mcpServers ?? {}).length === 0
    ) {
      throw new Error(
        `No importable entities found in source "${sourceLocation}".\nExpected agents/, .agents/agents/, .github/agents/, commands/, .agents/commands/, prompts/, .gemini/commands/, .github/prompts/, mcp.json/.agents/mcp.json, rules/.agents/rules/, skills/, .agents/skills/, root SKILL.md, root <name>/SKILL.md directories, or plugin sources from .claude-plugin/marketplace.json.`,
      );
    }

    const shouldResolveAgents =
      shouldImportAgents &&
      (sourceAgents.length > 0 ||
        (options.agents?.length ?? 0) > 0 ||
        requireAgents);

    const selection: AgentsToImportResult = shouldResolveAgents
      ? await resolveAgentsToImport({
          sourceAgents,
          requestedAgents: options.agents,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptForAgentSelection: options.promptForAgentSelection ?? true,
          selectionMode: options.selectionMode,
        })
      : { selectedAgents: [] };

    let selectedSourceCommands: ReturnType<typeof parseCommandsDir> = [];
    let selectedSourceCommandFiles: string[] = [];
    let commandSelectionMode: SelectionMode = "all";
    if (shouldImportCommands && sourceCommandsDir) {
      const commandSelection = await resolveCommandsToImport({
        sourceCommands,
        selectors: options.commandSelectors ?? [],
        promptForCommands: Boolean(options.promptForCommands),
        nonInteractive: Boolean(options.nonInteractive),
        selectionMode: options.selectionMode,
      });
      selectedSourceCommands = commandSelection.selectedCommands;
      commandSelectionMode = commandSelection.selectionMode;
      selectedSourceCommandFiles = selectedSourceCommands.map(
        (command) => command.fileName,
      );
    }

    let selectedSourceMcpServers: string[] = [];
    let sourceMcpServerNames: string[] = sourceMcp
      ? Object.keys(sourceMcp.mcpServers).sort()
      : [];
    let mcpSelectionMode: SelectionMode = "all";

    if (shouldImportMcp && sourceMcp) {
      const mcpSelection = await resolveMcpServersToImport({
        sourceMcp,
        selectors: options.mcpSelectors ?? [],
        promptForMcp: options.promptForMcp ?? true,
        nonInteractive: Boolean(options.nonInteractive),
        selectionMode: options.selectionMode,
      });
      selectedSourceMcpServers = mcpSelection.selectedServerNames;
      mcpSelectionMode = mcpSelection.selectionMode;
    }

    let selectedRules: CanonicalRuleFile[] = [];
    let selectedSourceRules: string[] = [];
    let ruleSelectionMode: SelectionMode = "all";

    if (shouldImportRules && sourceRulesDir) {
      const ruleSelection = await resolveRulesToImport({
        sourceRules,
        selectors: options.ruleSelectors ?? [],
        promptForRules: options.promptForRules ?? true,
        nonInteractive: Boolean(options.nonInteractive),
        selectionMode: options.selectionMode,
      });
      selectedRules = ruleSelection.selectedRules;
      ruleSelectionMode = ruleSelection.selectionMode;
      selectedSourceRules = selectedRules.map((rule) => rule.fileName);
    }

    let selectedSkills: CanonicalSkill[] = [];
    let selectedSourceSkills: string[] = [];
    let skillSelectionMode: SelectionMode = "all";

    if (shouldImportSkills && sourceSkillsDir) {
      const skillSelection = await resolveSkillsToImport({
        sourceSkills,
        selectors: options.skillSelectors ?? [],
        promptForSkills: options.promptForSkills ?? true,
        nonInteractive: Boolean(options.nonInteractive),
        selectionMode: options.selectionMode,
      });
      selectedSkills = skillSelection.selectedSkills;
      selectedSourceSkills = skillSelection.selectedSourceSkills;
      skillSelectionMode = skillSelection.selectionMode;
    }

    const importedAgents: string[] = [];
    if (shouldImportAgents && selection.selectedAgents.length > 0) {
      ensureDir(options.paths.agentsDir);

      for (const [index, agent] of selection.selectedAgents.entries()) {
        let targetFileName = targetFileNameForAgent(agent);

        if (
          options.rename &&
          selection.selectedAgents.length === 1 &&
          !(shouldImportCommands && hasExplicitCommandSelection)
        ) {
          targetFileName = `${slugify(options.rename) || "agent"}.md`;
        }

        const resolvedFileName = await resolveAgentConflict({
          targetFileName,
          agentContent: buildAgentMarkdown(agent.frontmatter, agent.body),
          paths: options.paths,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptLabel: `${agent.name} (${index + 1}/${selection.selectedAgents.length})`,
        });

        if (!resolvedFileName) continue;

        const targetPath = path.join(options.paths.agentsDir, resolvedFileName);
        const content = buildAgentMarkdown(agent.frontmatter, agent.body);
        writeTextAtomic(targetPath, content);
        importedAgents.push(
          relativePosix(options.paths.agentsRoot, targetPath),
        );
      }
    }

    const importedCommands: string[] = [];
    const importedCommandRenameMap: Record<string, string> = {};
    if (shouldImportCommands && sourceCommandsDir) {
      if (selectedSourceCommands.length > 0) {
        ensureDir(options.paths.commandsDir);
      }

      for (const [index, command] of selectedSourceCommands.entries()) {
        let targetFileName = command.fileName;

        const mappedTargetFileName = resolveMappedTargetFileName(
          command.fileName,
          options.commandRenameMap,
        );
        if (mappedTargetFileName) {
          targetFileName = mappedTargetFileName;
        } else if (
          options.rename &&
          selectedSourceCommands.length === 1 &&
          (!shouldImportAgents || hasExplicitCommandSelection)
        ) {
          targetFileName = `${slugify(options.rename) || "command"}.md`;
        }

        const resolvedFileName = await resolveCommandConflict({
          targetFileName,
          commandContent: command.content,
          paths: options.paths,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptLabel: `${command.fileName} (${index + 1}/${selectedSourceCommands.length})`,
        });

        if (!resolvedFileName) continue;

        const targetPath = path.join(
          options.paths.commandsDir,
          resolvedFileName,
        );
        writeTextAtomic(targetPath, command.content);
        importedCommands.push(
          relativePosix(options.paths.agentsRoot, targetPath),
        );
        importedCommandRenameMap[command.fileName] = resolvedFileName;
      }
    }

    const importedMcpServers: string[] = [];
    if (shouldImportMcp && sourceMcp) {
      const selectedSourceMcp: CanonicalMcpFile = {
        version: 1,
        mcpServers: Object.fromEntries(
          selectedSourceMcpServers.map((serverName) => [
            serverName,
            sourceMcp.mcpServers[serverName] ?? {},
          ]),
        ),
      };

      if (selectedSourceMcpServers.length > 0) {
        const targetMcp = readCanonicalMcp(options.paths);

        const merged = await resolveMcpConflict({
          sourceMcp: selectedSourceMcp,
          targetMcp,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
        });

        writeCanonicalMcp(options.paths, merged);
      }

      importedMcpServers.push(...selectedSourceMcpServers);
    }

    const importedRules: string[] = [];
    const telemetryRules: Array<{ name: string; filePath: string }> = [];
    const importedRuleRenameMap: Record<string, string> = {};
    if (shouldImportRules && sourceRulesDir) {
      if (selectedRules.length > 0) {
        ensureDir(options.paths.rulesDir);
      }

      for (const [index, rule] of selectedRules.entries()) {
        let targetFileName = rule.fileName;

        const mappedTargetFileName = resolveMappedTargetRuleFileName(
          rule.fileName,
          options.ruleRenameMap,
        );
        if (mappedTargetFileName) {
          targetFileName = mappedTargetFileName;
        } else if (
          options.rename &&
          selectedRules.length === 1 &&
          importedAgents.length === 0 &&
          importedCommands.length === 0 &&
          importedMcpServers.length === 0 &&
          selectedSkills.length === 0
        ) {
          targetFileName = `${slugify(options.rename) || "rule"}.md`;
        }

        const resolvedFileName = await resolveRuleConflict({
          targetFileName,
          ruleContent: rule.content,
          paths: options.paths,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptLabel: `${rule.fileName} (${index + 1}/${selectedRules.length})`,
        });

        if (!resolvedFileName) continue;

        const targetPath = path.join(options.paths.rulesDir, resolvedFileName);
        writeTextAtomic(targetPath, rule.content);
        importedRules.push(relativePosix(options.paths.agentsRoot, targetPath));
        telemetryRules.push({
          name: stripRuleFileExtension(rule.fileName),
          filePath: relativePosix(prepared.rootPath, rule.sourcePath),
        });
        importedRuleRenameMap[rule.fileName] = resolvedFileName;
      }
    }

    const importedSkills: string[] = [];
    const telemetrySkills: Array<{ name: string; filePath: string }> = [];
    const importedSkillRenameMap: Record<string, string> = {};
    let skillsProvidersForLock: Provider[] | undefined;
    if (shouldImportSkills && sourceSkillsDir) {
      if (selectedSkills.length > 0) {
        ensureDir(options.paths.skillsDir);
      }

      for (const [index, sourceSkill] of selectedSkills.entries()) {
        const canonicalSkillDirName = slugify(sourceSkill.name) || "skill";
        const legacySkillDirName =
          slugify(sourceSkill.sourceDirName) || "skill";
        let targetSkillDirName = canonicalSkillDirName;

        const mappedTargetSkillDirName = resolveMappedTargetSkillName(
          sourceSkill,
          selectedSkills,
          options.skillRenameMap,
        );
        if (mappedTargetSkillDirName) {
          targetSkillDirName =
            mappedTargetSkillDirName === legacySkillDirName &&
            legacySkillDirName !== canonicalSkillDirName
              ? canonicalSkillDirName
              : mappedTargetSkillDirName;
        } else if (
          options.rename &&
          selectedSkills.length === 1 &&
          importedAgents.length === 0 &&
          importedCommands.length === 0 &&
          importedMcpServers.length === 0 &&
          importedRules.length === 0
        ) {
          targetSkillDirName = slugify(options.rename) || "skill";
        }

        const resolvedSkillDirName = await resolveSkillConflict({
          sourceSkill,
          targetSkillDirName,
          legacySkillDirName:
            targetSkillDirName === canonicalSkillDirName
              ? legacySkillDirName
              : undefined,
          canonicalSkillDirName,
          paths: options.paths,
          yes: !!options.yes,
          nonInteractive: !!options.nonInteractive,
          promptLabel: `${sourceSkill.name} (${index + 1}/${selectedSkills.length})`,
        });

        if (!resolvedSkillDirName) continue;

        const targetSkillDir = path.join(
          options.paths.skillsDir,
          resolvedSkillDirName,
        );
        if (resolvedSkillDirName === canonicalSkillDirName) {
          moveLegacySkillDirectoryToCanonicalIfUnchanged({
            sourceSkill,
            legacySkillDirName,
            canonicalSkillDirName,
            paths: options.paths,
          });
        }
        if (!skillContentMatchesTarget(sourceSkill, targetSkillDir)) {
          fs.rmSync(targetSkillDir, { recursive: true, force: true });
          copySkillArtifacts(sourceSkill, targetSkillDir);
        }

        if (resolvedSkillDirName === canonicalSkillDirName) {
          removeLegacySkillDirectory({
            legacySkillDirName,
            canonicalSkillDirName,
            paths: options.paths,
          });
        }

        importedSkills.push(resolvedSkillDirName);
        telemetrySkills.push({
          name: sourceSkill.name,
          filePath: relativePosix(prepared.rootPath, sourceSkill.skillPath),
        });
        importedSkillRenameMap[sourceSkill.name] = resolvedSkillDirName;
      }

      if (importedSkills.length > 0) {
        const resolvedSkillsProviders = normalizeSkillsProviders(
          options.skillsProviders && options.skillsProviders.length > 0
            ? options.skillsProviders
            : await options.resolveSkillsProviders?.(),
        );

        if (resolvedSkillsProviders && resolvedSkillsProviders.length > 0) {
          applySkillProviderSideEffects({
            paths: options.paths,
            providers: resolvedSkillsProviders,
            warn(message) {
              console.warn(`Warning: ${message}`);
            },
          });
          skillsProvidersForLock = resolvedSkillsProviders;
        }
      }
    }

    const selectedSubsetOfSourceAgents =
      sourceAgents.length > 0 &&
      selection.selectedAgents.length < sourceAgents.length;
    const selectedSubsetOfSourceCommands =
      sourceCommands.length > 0 &&
      selectedSourceCommandFiles.length < sourceCommands.length;
    const selectedSubsetOfSourceMcp =
      sourceMcpServerNames.length > 0 &&
      selectedSourceMcpServers.length < sourceMcpServerNames.length;
    const selectedSubsetOfSourceRules =
      sourceRules.length > 0 && selectedSourceRules.length < sourceRules.length;
    const selectedSubsetOfSourceSkills =
      sourceSkills.length > 0 &&
      selectedSourceSkills.length < sourceSkills.length;
    const shouldPersistCommandSelection =
      shouldImportCommands && commandSelectionMode === "custom";
    const shouldPersistMcpSelection =
      shouldImportMcp && mcpSelectionMode === "custom";
    const shouldPersistRuleSelection =
      shouldImportRules && ruleSelectionMode === "custom";
    const shouldPersistSkillSelection =
      shouldImportSkills && skillSelectionMode === "custom";

    const selectedSourceCommandsForLock =
      shouldPersistCommandSelection || selectedSubsetOfSourceCommands
        ? selectedSourceCommandFiles
        : undefined;
    const selectedSourceMcpServersForLock =
      shouldPersistMcpSelection || selectedSubsetOfSourceMcp
        ? selectedSourceMcpServers
        : undefined;
    const selectedSourceRulesForLock =
      shouldPersistRuleSelection || selectedSubsetOfSourceRules
        ? selectedSourceRules
        : undefined;
    const selectedSourceSkillsForLock =
      shouldPersistSkillSelection || selectedSubsetOfSourceSkills
        ? selectedSourceSkills
        : undefined;

    const lockfile = readLockfile(options.paths);
    const importedEntities = [
      shouldImportAgents ? "agent" : null,
      shouldImportCommands ? "command" : null,
      shouldImportMcp ? "mcp" : null,
      shouldImportRules ? "rule" : null,
      shouldImportSkills ? "skill" : null,
    ].filter(Boolean) as EntityType[];
    const singleEntityImport =
      importedEntities.length === 1 ? importedEntities[0] : undefined;
    const isAgentOnlyImport = singleEntityImport === "agent";
    const isCommandOnlyImport = singleEntityImport === "command";
    const isMcpOnlyImport = singleEntityImport === "mcp";
    const isRuleOnlyImport = singleEntityImport === "rule";
    const isSkillOnlyImport = singleEntityImport === "skill";

    const relaxedSingleEntityEntries = singleEntityImport
      ? findRelaxedEntityEntries(lockfile.entries, {
          source: prepared.spec.source,
          sourceType: prepared.spec.type,
          subdir: options.subdir,
          requestedAgents: options.agents,
          entity: singleEntityImport,
        })
      : [];
    let relaxedSingleEntityEntry = relaxedSingleEntityEntries[0];

    if (relaxedSingleEntityEntries.length > 1) {
      const canonicalEntry = relaxedSingleEntityEntries[0];
      const redundantEntries = relaxedSingleEntityEntries.slice(1);
      const collapsibleRedundantEntries = redundantEntries.filter(
        (entry) => !isMixedEntryForEntity(entry, singleEntityImport!),
      );
      const consolidatedEntry = mergeRelaxedEntityEntriesForLock({
        canonicalEntry,
        redundantEntries: collapsibleRedundantEntries,
        entity: singleEntityImport!,
      });
      const canonicalEntryIndex = lockfile.entries.indexOf(canonicalEntry);
      if (canonicalEntryIndex >= 0) {
        lockfile.entries[canonicalEntryIndex] = consolidatedEntry;
      }
      const redundantEntriesSet = new Set(collapsibleRedundantEntries);
      lockfile.entries = lockfile.entries.filter(
        (entry) => !redundantEntriesSet.has(entry),
      );
      relaxedSingleEntityEntry = consolidatedEntry;
    }

    const existingEntry = singleEntityImport
      ? relaxedSingleEntityEntry
      : findMatchingLockEntry(lockfile.entries, {
          source: prepared.spec.source,
          sourceType: prepared.spec.type,
          subdir: options.subdir,
          requestedAgents: shouldImportAgents
            ? selection.requestedAgentsForLock
            : options.agents,
          selectedSourceCommands: selectedSourceCommandsForLock,
          selectedSourceMcpServers: selectedSourceMcpServersForLock,
          selectedSourceRules: selectedSourceRulesForLock,
          selectedSourceSkills: selectedSourceSkillsForLock,
          selectedSkills,
          skillsProviders: skillsProvidersForLock,
        });
    const shouldMergeCommandOnlyEntry =
      isCommandOnlyImport &&
      Boolean(existingEntry) &&
      (existingEntry?.importedAgents.length ?? 0) === 0 &&
      (existingEntry?.importedMcpServers.length ?? 0) === 0 &&
      (existingEntry?.importedSkills.length ?? 0) === 0;
    const shouldMergeAgentOnlyEntry =
      isAgentOnlyImport &&
      Boolean(existingEntry) &&
      (selection.requestedAgentsForLock !== undefined ||
        selectedSubsetOfSourceAgents);
    const shouldMergeMcpOnlyEntry =
      isMcpOnlyImport &&
      Boolean(existingEntry) &&
      (existingEntry?.importedAgents.length ?? 0) === 0 &&
      (existingEntry?.importedCommands.length ?? 0) === 0 &&
      (existingEntry?.importedRules.length ?? 0) === 0 &&
      (existingEntry?.importedSkills.length ?? 0) === 0 &&
      (shouldPersistMcpSelection || selectedSubsetOfSourceMcp);
    const shouldMergeRuleOnlyEntry =
      isRuleOnlyImport &&
      Boolean(existingEntry) &&
      (existingEntry?.importedAgents.length ?? 0) === 0 &&
      (existingEntry?.importedCommands.length ?? 0) === 0 &&
      (existingEntry?.importedMcpServers.length ?? 0) === 0 &&
      (existingEntry?.importedSkills.length ?? 0) === 0 &&
      (shouldPersistRuleSelection || selectedSubsetOfSourceRules);
    const shouldMergeSkillOnlyEntry =
      isSkillOnlyImport &&
      Boolean(existingEntry) &&
      (shouldPersistSkillSelection || selectedSubsetOfSourceSkills);

    const lockImportedAgents = shouldImportAgents
      ? shouldMergeAgentOnlyEntry
        ? uniqueStrings([
            ...(existingEntry?.importedAgents ?? []),
            ...importedAgents,
          ])
        : importedAgents
      : (existingEntry?.importedAgents ?? []);
    const lockImportedCommands = shouldImportCommands
      ? shouldMergeCommandOnlyEntry
        ? uniqueStrings([
            ...(existingEntry?.importedCommands ?? []),
            ...importedCommands,
          ])
        : importedCommands
      : (existingEntry?.importedCommands ?? []);
    const lockImportedMcpServers = shouldImportMcp
      ? shouldMergeMcpOnlyEntry
        ? uniqueStrings([
            ...(existingEntry?.importedMcpServers ?? []),
            ...importedMcpServers,
          ])
        : importedMcpServers
      : (existingEntry?.importedMcpServers ?? []);
    const lockImportedRules = shouldImportRules
      ? shouldMergeRuleOnlyEntry
        ? uniqueStrings([
            ...(existingEntry?.importedRules ?? []),
            ...importedRules,
          ])
        : importedRules
      : (existingEntry?.importedRules ?? []);
    const lockImportedSkills = shouldImportSkills
      ? shouldMergeSkillOnlyEntry
        ? mergeImportedSkills({
            existingImportedSkills: existingEntry?.importedSkills,
            importedSkills,
            selectedSkills,
            existingSkillRenameMap: existingEntry?.skillRenameMap,
          })
        : importedSkills
      : (existingEntry?.importedSkills ?? []);

    let lockSelectedSourceCommands: string[] | undefined;
    if (shouldImportCommands) {
      if (shouldMergeCommandOnlyEntry) {
        if (shouldPersistCommandSelection || selectedSubsetOfSourceCommands) {
          lockSelectedSourceCommands = uniqueStrings([
            ...(existingEntry?.selectedSourceCommands ?? []),
            ...selectedSourceCommandFiles,
          ]);
        } else {
          lockSelectedSourceCommands = undefined;
        }
      } else if (
        shouldPersistCommandSelection ||
        selectedSubsetOfSourceCommands
      ) {
        lockSelectedSourceCommands = [...selectedSourceCommandFiles];
      } else {
        lockSelectedSourceCommands = undefined;
      }
    } else {
      lockSelectedSourceCommands = existingEntry?.selectedSourceCommands;
    }

    let lockSelectedSourceMcpServers: string[] | undefined;
    if (shouldImportMcp) {
      if (shouldMergeMcpOnlyEntry) {
        if (shouldPersistMcpSelection || selectedSubsetOfSourceMcp) {
          lockSelectedSourceMcpServers = uniqueStrings([
            ...(existingEntry?.selectedSourceMcpServers ?? []),
            ...selectedSourceMcpServers,
          ]);
        } else {
          lockSelectedSourceMcpServers = undefined;
        }
      } else if (shouldPersistMcpSelection || selectedSubsetOfSourceMcp) {
        lockSelectedSourceMcpServers = [...selectedSourceMcpServers];
      } else {
        lockSelectedSourceMcpServers = undefined;
      }
    } else {
      lockSelectedSourceMcpServers = existingEntry?.selectedSourceMcpServers;
    }

    let lockSelectedSourceRules: string[] | undefined;
    if (shouldImportRules) {
      if (shouldMergeRuleOnlyEntry) {
        if (shouldPersistRuleSelection || selectedSubsetOfSourceRules) {
          lockSelectedSourceRules = uniqueStrings([
            ...(existingEntry?.selectedSourceRules ?? []),
            ...selectedSourceRules,
          ]);
        } else {
          lockSelectedSourceRules = undefined;
        }
      } else if (shouldPersistRuleSelection || selectedSubsetOfSourceRules) {
        lockSelectedSourceRules = [...selectedSourceRules];
      } else {
        lockSelectedSourceRules = undefined;
      }
    } else {
      lockSelectedSourceRules = existingEntry?.selectedSourceRules;
    }

    let lockSelectedSourceSkills: string[] | undefined;
    if (shouldImportSkills) {
      if (shouldMergeSkillOnlyEntry) {
        if (shouldPersistSkillSelection || selectedSubsetOfSourceSkills) {
          lockSelectedSourceSkills = uniqueStrings([
            ...(existingEntry?.selectedSourceSkills ?? []),
            ...selectedSourceSkills,
          ]);
        } else {
          lockSelectedSourceSkills = undefined;
        }
      } else if (shouldPersistSkillSelection || selectedSubsetOfSourceSkills) {
        lockSelectedSourceSkills = [...selectedSourceSkills];
      } else {
        lockSelectedSourceSkills = undefined;
      }
    } else {
      lockSelectedSourceSkills = existingEntry?.selectedSourceSkills;
    }
    const lockRuleRenameMap = shouldImportRules
      ? shouldMergeRuleOnlyEntry
        ? mergeRuleRenameMaps(
            existingEntry?.ruleRenameMap,
            importedRuleRenameMap,
          )
        : normalizeRuleRenameMap(importedRuleRenameMap)
      : existingEntry?.ruleRenameMap;
    const lockSkillsProviders = shouldImportSkills
      ? shouldMergeSkillOnlyEntry
        ? normalizeSkillsProviders([
            ...(existingEntry?.skillsProviders ?? []),
            ...(skillsProvidersForLock ?? []),
          ])
        : (skillsProvidersForLock ?? existingEntry?.skillsProviders)
      : existingEntry?.skillsProviders;
    const lockSkillRenameMap = shouldImportSkills
      ? shouldMergeSkillOnlyEntry
        ? mergeSkillRenameMaps(
            existingEntry?.skillRenameMap,
            importedSkillRenameMap,
          )
        : normalizeSkillRenameMap(importedSkillRenameMap)
      : existingEntry?.skillRenameMap;
    let lockCommandRenameMap: Record<string, string> | undefined;
    if (shouldImportCommands) {
      if (shouldMergeCommandOnlyEntry) {
        lockCommandRenameMap = mergeCommandRenameMaps(
          existingEntry?.commandRenameMap,
          importedCommandRenameMap,
        );
      } else {
        lockCommandRenameMap = normalizeCommandRenameMap(
          importedCommandRenameMap,
        );
      }
    } else {
      lockCommandRenameMap = existingEntry?.commandRenameMap;
    }

    const lockRequestedAgents = shouldImportAgents
      ? shouldMergeAgentOnlyEntry
        ? uniqueStrings([
            ...(existingEntry?.requestedAgents ?? []),
            ...(selection.requestedAgentsForLock ?? []),
          ])
        : selection.requestedAgentsForLock
      : existingEntry?.requestedAgents;
    const trackedEntities = computeTrackedEntitiesForLock({
      requestedAgents: lockRequestedAgents,
      importedAgents: lockImportedAgents,
      importedCommands: lockImportedCommands,
      selectedSourceCommands: lockSelectedSourceCommands,
      commandRenameMap: lockCommandRenameMap,
      importedMcpServers: lockImportedMcpServers,
      selectedSourceMcpServers: lockSelectedSourceMcpServers,
      importedRules: lockImportedRules,
      selectedSourceRules: lockSelectedSourceRules,
      ruleRenameMap: lockRuleRenameMap,
      importedSkills: lockImportedSkills,
      selectedSourceSkills: lockSelectedSourceSkills,
      skillsProviders: lockSkillsProviders,
      skillRenameMap: lockSkillRenameMap,
    });

    const contentHash = hashContent(
      JSON.stringify({
        agents: lockImportedAgents,
        commands: lockImportedCommands,
        selectedSourceCommands: lockSelectedSourceCommands ?? [],
        commandRenameMap: lockCommandRenameMap ?? {},
        mcp: lockImportedMcpServers,
        selectedSourceMcpServers: lockSelectedSourceMcpServers ?? [],
        rules: lockImportedRules,
        selectedSourceRules: lockSelectedSourceRules ?? [],
        ruleRenameMap: lockRuleRenameMap ?? {},
        skills: lockImportedSkills,
        selectedSourceSkills: lockSelectedSourceSkills ?? [],
        skillsProviders: lockSkillsProviders ?? [],
        skillRenameMap: lockSkillRenameMap ?? {},
        trackedEntities: trackedEntities ?? [],
      }),
    );

    const lockEntry: LockEntry = {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      requestedRef: options.ref,
      requestedAgents: lockRequestedAgents,
      resolvedCommit: prepared.resolvedCommit,
      subdir: options.subdir,
      importedAt: new Date().toISOString(),
      importedAgents: lockImportedAgents,
      importedCommands: lockImportedCommands,
      selectedSourceCommands: lockSelectedSourceCommands,
      commandRenameMap: lockCommandRenameMap,
      importedMcpServers: lockImportedMcpServers,
      selectedSourceMcpServers: lockSelectedSourceMcpServers,
      importedRules: lockImportedRules,
      selectedSourceRules: lockSelectedSourceRules,
      ruleRenameMap: lockRuleRenameMap,
      importedSkills: lockImportedSkills,
      selectedSourceSkills: lockSelectedSourceSkills,
      skillsProviders: lockSkillsProviders,
      skillRenameMap: lockSkillRenameMap,
      trackedEntities,
      contentHash,
    };

    if (existingEntry) {
      const existingIndex = lockfile.entries.indexOf(existingEntry);
      if (existingIndex >= 0) {
        lockfile.entries[existingIndex] = lockEntry;
      } else {
        upsertLockEntry(lockfile, lockEntry);
      }
    } else {
      upsertLockEntry(lockfile, lockEntry);
    }
    writeLockfile(options.paths, lockfile);

    return {
      source: prepared.spec.source,
      sourceType: prepared.spec.type,
      importedAgents,
      importedCommands,
      importedMcpServers,
      importedRules,
      importedSkills,
      telemetryRules: telemetryRules.length > 0 ? telemetryRules : undefined,
      telemetrySkills: telemetrySkills.length > 0 ? telemetrySkills : undefined,
      resolvedCommit: prepared.resolvedCommit,
    };
  } finally {
    prepared.cleanup();
  }
}

function parseSourceAgentsForImport(
  sourceAgentsDirs: string[],
  pluginSourceRoots: string[],
): CanonicalAgent[] {
  const sourceAgents = sourceAgentsDirs.flatMap((sourceAgentsDir) => {
    if (isGitHubAgentsDir(sourceAgentsDir)) {
      return parseGitHubAgentsDirForImport(sourceAgentsDir);
    }
    return parseAgentsDir(sourceAgentsDir);
  });

  assertNoPluginSourceCollisions({
    entityLabel: "agent",
    pluginSourceRoots,
    entries: sourceAgents.map((agent) => ({
      key: targetFileNameForAgent(agent),
      sourcePath: agent.sourcePath,
    })),
  });

  return sourceAgents;
}

function parseSourceCommandsForImport(
  sourceCommandsDirs: string[],
  pluginSourceRoots: string[],
): CanonicalCommandFile[] {
  const sourceCommands = sourceCommandsDirs.flatMap((dirPath) =>
    parseSourceCommandsFromDir(dirPath),
  );

  assertNoPluginSourceCollisions({
    entityLabel: "command",
    pluginSourceRoots,
    entries: sourceCommands.map((command) => ({
      key: toCanonicalCommandFileName(command.fileName),
      sourcePath: command.sourcePath,
    })),
  });

  return mergeCanonicalCommandFiles(sourceCommands);
}

function parseSourceMcpForImport(
  sourceMcpPaths: string[],
  pluginSourceRoots: string[],
): CanonicalMcpFile {
  const mergedMcpServers: Record<string, Record<string, unknown>> = {};
  const seenServerSource = new Map<
    string,
    { sourcePath: string; pluginSourceRoot: string | null }
  >();

  for (const sourceMcpPath of sourceMcpPaths) {
    const sourceMcp = normalizeMcp(
      readJsonIfExists<Record<string, unknown>>(sourceMcpPath),
    );

    for (const [serverName, serverConfig] of Object.entries(
      sourceMcp.mcpServers,
    )) {
      const pluginSourceRoot = resolvePluginSourceRootForPath(
        sourceMcpPath,
        pluginSourceRoots,
      );
      const existing = seenServerSource.get(serverName);
      if (
        existing &&
        existing.pluginSourceRoot &&
        pluginSourceRoot &&
        existing.pluginSourceRoot !== pluginSourceRoot
      ) {
        throw buildPluginCollisionError({
          entityLabel: "mcp server",
          key: serverName,
          sourcePaths: [existing.sourcePath, sourceMcpPath],
        });
      }

      mergedMcpServers[serverName] = serverConfig;
      seenServerSource.set(serverName, {
        sourcePath: sourceMcpPath,
        pluginSourceRoot,
      });
    }
  }

  return {
    version: 1,
    mcpServers: mergedMcpServers,
  };
}

function parseSourceRulesForImport(
  sourceRulesDirs: string[],
  pluginSourceRoots: string[],
): CanonicalRuleFile[] {
  const sourceRules = sourceRulesDirs.flatMap((sourceRulesDir) =>
    parseRulesDir(sourceRulesDir),
  );

  assertNoPluginSourceCollisions({
    entityLabel: "rule",
    pluginSourceRoots,
    entries: sourceRules.map((rule) => ({
      key: rule.id,
      sourcePath: rule.sourcePath,
    })),
  });

  return sourceRules;
}

function parseSourceSkillsForImport(
  sourceSkillsDirs: string[],
  pluginSourceRoots: string[],
): CanonicalSkill[] {
  const sourceSkills = sourceSkillsDirs.flatMap((sourceSkillsDir) =>
    parseSkillsDir(sourceSkillsDir),
  );

  assertNoPluginSourceCollisions({
    entityLabel: "skill",
    pluginSourceRoots,
    entries: sourceSkills.map((skill) => ({
      key: normalizeSkillSelector(skill.name),
      sourcePath: skill.skillPath,
    })),
  });
  assertNoDuplicateSkillNames(sourceSkills);

  return sourceSkills;
}

function assertNoDuplicateSkillNames(sourceSkills: CanonicalSkill[]): void {
  const byName = new Map<string, Array<{ name: string; sourcePath: string }>>();

  for (const skill of sourceSkills) {
    const normalizedName = normalizeSkillSelector(skill.name);
    if (!normalizedName) continue;

    const matches = byName.get(normalizedName) ?? [];
    matches.push({
      name: skill.name,
      sourcePath: skill.skillPath,
    });
    byName.set(normalizedName, matches);
  }

  for (const matches of byName.values()) {
    const sourcePaths = [...new Set(matches.map((item) => item.sourcePath))];
    if (sourcePaths.length < 2) {
      continue;
    }

    const locations = sourcePaths
      .map((sourcePath) => `- ${sourcePath}`)
      .join("\n");
    throw new Error(
      `Conflicting skill "${matches[0]?.name ?? "unknown"}" found in source:\n${locations}\nEnsure each SKILL.md frontmatter name is unique.`,
    );
  }
}

function assertNoPluginSourceCollisions(options: {
  entityLabel: string;
  pluginSourceRoots: string[];
  entries: Array<{ key: string; sourcePath: string }>;
}): void {
  if (options.pluginSourceRoots.length === 0 || options.entries.length === 0) {
    return;
  }

  const byKey = new Map<
    string,
    Array<{ key: string; sourcePath: string; pluginSourceRoot: string | null }>
  >();
  for (const entry of options.entries) {
    const normalizedKey = entry.key.trim().toLowerCase();
    if (!normalizedKey) continue;

    const pluginSourceRoot = resolvePluginSourceRootForPath(
      entry.sourcePath,
      options.pluginSourceRoots,
    );
    const group = byKey.get(normalizedKey) ?? [];
    group.push({
      key: entry.key,
      sourcePath: entry.sourcePath,
      pluginSourceRoot,
    });
    byKey.set(normalizedKey, group);
  }

  for (const matches of byKey.values()) {
    const pluginRoots = [
      ...new Set(
        matches
          .map((item) => item.pluginSourceRoot)
          .filter((item): item is string => Boolean(item)),
      ),
    ];

    if (pluginRoots.length < 2) {
      continue;
    }

    throw buildPluginCollisionError({
      entityLabel: options.entityLabel,
      key: matches[0]?.key ?? "unknown",
      sourcePaths: matches.map((item) => item.sourcePath),
    });
  }
}

function buildPluginCollisionError(options: {
  entityLabel: string;
  key: string;
  sourcePaths: string[];
}): Error {
  const locations = [...new Set(options.sourcePaths)]
    .map((sourcePath) => `- ${sourcePath}`)
    .join("\n");
  return new Error(
    `Conflicting ${options.entityLabel} "${options.key}" found across plugin sources declared in .claude-plugin/marketplace.json:\n${locations}\nUse --subdir to import a single plugin source.`,
  );
}

function resolvePluginSourceRootForPath(
  sourcePath: string,
  pluginSourceRoots: string[],
): string | null {
  for (const pluginSourceRoot of [...pluginSourceRoots].sort(
    (left, right) => right.length - left.length,
  )) {
    const normalizedRoot = path.resolve(pluginSourceRoot);
    const normalizedPath = path.resolve(sourcePath);
    if (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      return normalizedRoot;
    }
  }

  return null;
}

function parseSourceCommandsFromDir(
  sourceCommandsDir: string,
): CanonicalCommandFile[] {
  if (isGeminiCommandsDir(sourceCommandsDir)) {
    const geminiMarkdownCommands = parseCommandsDir(sourceCommandsDir).filter(
      (command) =>
        isProviderEntityFileName({
          provider: "gemini",
          entity: "command",
          fileName: command.fileName,
        }),
    );
    const parsedCommands = mergeCommandsByCanonicalFileName([
      ...parseGeminiTomlCommandsForImport(sourceCommandsDir),
      ...geminiMarkdownCommands,
    ]);
    return parsedCommands.map((command) =>
      normalizeGeminiCommandForImport(command),
    );
  }

  const commands = parseCommandsDir(sourceCommandsDir);
  if (!isGitHubPromptsDir(sourceCommandsDir)) {
    return commands;
  }

  return commands
    .filter((command) =>
      isProviderEntityFileName({
        provider: "copilot",
        entity: "command",
        fileName: command.fileName,
      }),
    )
    .map((command) => normalizeGitHubPromptForImport(command));
}

function mergeCommandsByCanonicalFileName(
  commands: CanonicalCommandFile[],
): CanonicalCommandFile[] {
  const byFileName = new Map<string, CanonicalCommandFile>();
  for (const command of commands) {
    if (!byFileName.has(command.fileName)) {
      byFileName.set(command.fileName, command);
    }
  }
  return [...byFileName.values()];
}

function isGitHubAgentsDir(sourceAgentsDir: string): boolean {
  return (
    path.basename(sourceAgentsDir).toLowerCase() === "agents" &&
    path.basename(path.dirname(sourceAgentsDir)).toLowerCase() === ".github"
  );
}

function isGitHubPromptsDir(sourceCommandsDir: string): boolean {
  return (
    path.basename(sourceCommandsDir).toLowerCase() === "prompts" &&
    path.basename(path.dirname(sourceCommandsDir)).toLowerCase() === ".github"
  );
}

function isGeminiCommandsDir(sourceCommandsDir: string): boolean {
  return (
    path.basename(sourceCommandsDir).toLowerCase() === "commands" &&
    path.basename(path.dirname(sourceCommandsDir)).toLowerCase() === ".gemini"
  );
}

function parseGeminiTomlCommandsForImport(
  sourceCommandsDir: string,
): CanonicalCommandFile[] {
  return fs
    .readdirSync(sourceCommandsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) =>
      isProviderEntityFileName({
        provider: "gemini",
        entity: "command",
        fileName,
      }),
    )
    .filter((fileName) => fileName.toLowerCase().endsWith(".toml"))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) =>
      parseGeminiTomlCommandForImport(path.join(sourceCommandsDir, fileName)),
    )
    .filter((command): command is CanonicalCommandFile => command !== null);
}

function mergeCanonicalCommandFiles(
  commands: CanonicalCommandFile[],
): CanonicalCommandFile[] {
  const merged = new Map<string, CanonicalCommandFile>();

  for (const command of commands) {
    const fileName = toCanonicalCommandFileName(command.fileName);
    const normalizedCommand =
      fileName === command.fileName ? command : { ...command, fileName };
    const existing = merged.get(fileName);
    if (!existing) {
      merged.set(fileName, normalizedCommand);
      continue;
    }

    const existingHasBody =
      normalizeImportedCommandBody(existing.body).length > 0;
    const incomingHasBody =
      normalizeImportedCommandBody(normalizedCommand.body).length > 0;
    if (
      existingHasBody &&
      incomingHasBody &&
      !sameNormalizedImportedCommandBody(existing.body, normalizedCommand.body)
    ) {
      throw new Error(
        `Conflicting command bodies found for "${fileName}" in ${existing.sourcePath} and ${normalizedCommand.sourcePath}. Align the provider-specific prompts before importing, or import a single provider directory with --subdir.`,
      );
    }

    const body = existingHasBody ? existing.body : normalizedCommand.body;
    const frontmatter = mergeCommandFrontmatterForImport(
      existing.frontmatter,
      normalizedCommand.frontmatter,
    );
    merged.set(fileName, {
      ...existing,
      fileName,
      body,
      frontmatter,
      content: buildCommandMarkdownForImport(frontmatter, body),
    });
  }

  return [...merged.values()];
}

function sameNormalizedImportedCommandBody(
  left: string,
  right: string,
): boolean {
  return (
    normalizeImportedCommandBody(left) === normalizeImportedCommandBody(right)
  );
}

function normalizeImportedCommandBody(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function mergeCommandFrontmatterForImport(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !incoming) {
    return undefined;
  }

  const merged = existing ? cloneUnknown(existing) : {};
  for (const [key, value] of Object.entries(incoming ?? {})) {
    const current = merged[key];
    if (current === undefined) {
      merged[key] = cloneUnknown(value);
      continue;
    }

    if (isObject(current) && isObject(value)) {
      merged[key] = {
        ...(cloneUnknown(value) as Record<string, unknown>),
        ...(cloneUnknown(current) as Record<string, unknown>),
      };
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function parseGeminiTomlCommandForImport(
  sourcePath: string,
): CanonicalCommandFile | null {
  const raw = fs.readFileSync(sourcePath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!isObject(parsed) || typeof parsed.prompt !== "string") {
    return null;
  }

  const body = normalizeCommandArgumentsForCanonical(parsed.prompt, "gemini");
  const frontmatter = cloneUnknown(parsed);
  delete frontmatter.prompt;

  const normalizedFrontmatter =
    Object.keys(frontmatter).length > 0 ? frontmatter : undefined;
  const fileName = toCanonicalCommandFileName(path.basename(sourcePath));
  const content = buildCommandMarkdownForImport(normalizedFrontmatter, body);

  return {
    fileName,
    sourcePath,
    content,
    body,
    frontmatter: normalizedFrontmatter,
  };
}

function parseGitHubAgentsDirForImport(
  sourceAgentsDir: string,
): CanonicalAgent[] {
  return fs
    .readdirSync(sourceAgentsDir)
    .filter((entry) =>
      isProviderEntityFileName({
        provider: "copilot",
        entity: "agent",
        fileName: entry,
      }),
    )
    .sort((a, b) => a.localeCompare(b))
    .map((entry) =>
      parseGitHubAgentForImport(path.join(sourceAgentsDir, entry)),
    );
}

function parseGitHubAgentForImport(sourcePath: string): CanonicalAgent {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const parsed = matter(raw);
  const data = isObject(parsed.data)
    ? (parsed.data as Record<string, unknown>)
    : {};

  const fileName = path.basename(sourcePath);
  const fallbackName = inferAgentNameFromFile(fileName);
  const name =
    typeof data.name === "string" && data.name.trim().length > 0
      ? data.name.trim()
      : fallbackName;
  const description =
    typeof data.description === "string" && data.description.trim().length > 0
      ? data.description.trim()
      : `Imported from Copilot agent "${name}".`;

  const frontmatter: Record<string, unknown> = {
    name,
    description,
  };

  for (const provider of ALL_PROVIDERS) {
    if (provider === "copilot") continue;
    const value = data[provider];
    if (value === false || isObject(value)) {
      frontmatter[provider] = cloneUnknown(value);
    }
  }

  const inferredCopilotConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "name" || key === "description") continue;
    if (ALL_PROVIDERS.includes(key as Provider)) continue;
    inferredCopilotConfig[key] = cloneUnknown(value);
  }

  const explicitCopilot = data.copilot;
  if (explicitCopilot === false) {
    frontmatter.copilot = false;
  } else {
    const copilotConfig: Record<string, unknown> = isObject(explicitCopilot)
      ? cloneUnknown(explicitCopilot)
      : {};
    for (const [key, value] of Object.entries(inferredCopilotConfig)) {
      if (!(key in copilotConfig)) {
        copilotConfig[key] = value;
      }
    }

    if (Object.keys(copilotConfig).length > 0) {
      frontmatter.copilot = copilotConfig;
    }
  }

  return {
    name,
    description,
    body: parsed.content.trimStart(),
    frontmatter: frontmatter as CanonicalAgent["frontmatter"],
    sourcePath,
    fileName,
  };
}

function normalizeGitHubPromptForImport(
  command: CanonicalCommandFile,
): CanonicalCommandFile {
  const fileName = toCanonicalCommandFileName(command.fileName);
  if (!command.frontmatter) {
    return {
      ...command,
      fileName,
    };
  }

  const nextFrontmatter: Record<string, unknown> = {};
  for (const provider of ALL_PROVIDERS) {
    if (provider === "copilot") continue;
    const value = command.frontmatter[provider];
    if (value === false || isObject(value)) {
      nextFrontmatter[provider] = cloneUnknown(value);
    }
  }

  const explicitCopilot = command.frontmatter.copilot;
  if (explicitCopilot === false) {
    nextFrontmatter.copilot = false;
  } else {
    const copilotConfig: Record<string, unknown> = isObject(explicitCopilot)
      ? cloneUnknown(explicitCopilot)
      : {};

    for (const [key, value] of Object.entries(command.frontmatter)) {
      if (ALL_PROVIDERS.includes(key as Provider)) continue;
      if (!(key in copilotConfig)) {
        copilotConfig[key] = cloneUnknown(value);
      }
    }

    if (Object.keys(copilotConfig).length > 0) {
      nextFrontmatter.copilot = copilotConfig;
    }
  }

  const frontmatter =
    Object.keys(nextFrontmatter).length > 0 ? nextFrontmatter : undefined;
  const body = normalizeCommandArgumentsForCanonical(
    command.body,
    "copilot",
  ).trimStart();
  return {
    ...command,
    fileName,
    body,
    frontmatter,
    content: buildCommandMarkdownForImport(frontmatter, body),
  };
}

function normalizeGeminiCommandForImport(
  command: CanonicalCommandFile,
): CanonicalCommandFile {
  const fileName = toCanonicalCommandFileName(command.fileName);
  const body = normalizeCommandArgumentsForCanonical(command.body, "gemini");
  if (!command.frontmatter) {
    return {
      ...command,
      fileName,
      body,
      content: buildCommandMarkdownForImport(undefined, body),
    };
  }

  const nextFrontmatter: Record<string, unknown> = {};
  for (const provider of ALL_PROVIDERS) {
    if (provider === "gemini") continue;
    const value = command.frontmatter[provider];
    if (value === false || isObject(value)) {
      nextFrontmatter[provider] = cloneUnknown(value);
    }
  }

  if (typeof command.frontmatter.description === "string") {
    nextFrontmatter.description = command.frontmatter.description;
  }

  const explicitGemini = command.frontmatter.gemini;
  if (explicitGemini === false) {
    nextFrontmatter.gemini = false;
  } else {
    const geminiConfig: Record<string, unknown> = isObject(explicitGemini)
      ? cloneUnknown(explicitGemini)
      : {};

    for (const [key, value] of Object.entries(command.frontmatter)) {
      if (key === "description") continue;
      if (ALL_PROVIDERS.includes(key as Provider)) continue;
      if (!(key in geminiConfig)) {
        geminiConfig[key] = cloneUnknown(value);
      }
    }

    if (Object.keys(geminiConfig).length > 0) {
      nextFrontmatter.gemini = geminiConfig;
    }
  }

  const frontmatter =
    Object.keys(nextFrontmatter).length > 0 ? nextFrontmatter : undefined;
  return {
    ...command,
    fileName,
    body,
    frontmatter,
    content: buildCommandMarkdownForImport(frontmatter, body),
  };
}

function buildCommandMarkdownForImport(
  frontmatter: Record<string, unknown> | undefined,
  body: string,
): string {
  if (!frontmatter) {
    return body.endsWith("\n") ? body : `${body}\n`;
  }

  const fm = YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${fm}\n---\n\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

function inferAgentNameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.agent\.md$/i, "")
    .replace(/\.md$/i, "")
    .trim();
  return base || "agent";
}

function toCanonicalCommandFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".prompt.md")) {
    return `${fileName.slice(0, -".prompt.md".length)}.md`;
  }
  if (lower.endsWith(".toml")) {
    return `${fileName.slice(0, -".toml".length)}.md`;
  }
  return fileName;
}

function cloneUnknown<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function resolveAgentsToImport(options: {
  sourceAgents: CanonicalAgent[];
  requestedAgents?: string[];
  yes: boolean;
  nonInteractive: boolean;
  promptForAgentSelection: boolean;
  selectionMode?: SelectionMode;
}): Promise<AgentsToImportResult> {
  const requestedAgents = normalizeRequestedAgents(options.requestedAgents);
  if (requestedAgents && requestedAgents.length > 0) {
    const selected = resolveRequestedAgents(
      options.sourceAgents,
      requestedAgents,
    );
    if (selected.length === 0) {
      throw new Error("No agents matched the requested --agent filters.");
    }
    return {
      selectedAgents: selected,
      // Persist stable selectors so updates keep targeting the same source agents
      // even if a previously-fallback selector later gains a new exact match.
      requestedAgentsForLock: getStableRequestedAgentsForLock({
        selectedAgents: selected,
        sourceAgents: options.sourceAgents,
      }),
    };
  }

  const selectionMode = await resolveSelectionMode({
    entityLabel: "agents",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForAgentSelection,
    nonInteractive: options.nonInteractive,
  });

  if (selectionMode === "all") {
    return { selectedAgents: options.sourceAgents };
  }

  if (
    options.yes ||
    options.nonInteractive ||
    options.sourceAgents.length <= 1 ||
    !options.promptForAgentSelection
  ) {
    return {
      selectedAgents: options.sourceAgents,
      requestedAgentsForLock: getStableRequestedAgentsForLock({
        selectedAgents: options.sourceAgents,
        sourceAgents: options.sourceAgents,
      }),
    };
  }

  const selected = await promptAgentSelection(options.sourceAgents);
  if (selected.length === 0) {
    throw new Error(
      "No agents selected. Use --agent <name> or rerun and select at least one agent.",
    );
  }
  const requestedAgentsForLock = getStableRequestedAgentsForLock({
    selectedAgents: selected,
    sourceAgents: options.sourceAgents,
  });
  return { selectedAgents: selected, requestedAgentsForLock };
}

function normalizeRequestedAgents(
  requestedAgents?: string[],
): string[] | undefined {
  if (!requestedAgents || requestedAgents.length === 0) return undefined;

  const normalized = requestedAgents.map((item) => item.trim()).filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function getStableRequestedAgentsForLock(options: {
  selectedAgents: CanonicalAgent[];
  sourceAgents: CanonicalAgent[];
}): string[] | undefined {
  const nameCounts = new Map<string, number>();

  for (const agent of options.sourceAgents) {
    const normalizedName = normalizeAgentSelector(agent.name);
    if (!normalizedName) continue;
    nameCounts.set(normalizedName, (nameCounts.get(normalizedName) ?? 0) + 1);
  }

  const selectors = options.selectedAgents.map((agent) => {
    const normalizedName = normalizeAgentSelector(agent.name);
    if (normalizedName && nameCounts.get(normalizedName) === 1) {
      return agent.name;
    }
    return agent.fileName.replace(/\.md$/i, "");
  });

  return normalizeRequestedAgents(selectors);
}

function resolveRequestedAgents(
  sourceAgents: CanonicalAgent[],
  requestedAgents: string[],
): CanonicalAgent[] {
  const selectedPaths = new Set<string>();
  const missing: string[] = [];
  const ambiguous: string[] = [];

  for (const requestedAgent of requestedAgents) {
    const exactMatches = sourceAgents.filter((agent) =>
      agentMatchesSelector(agent, requestedAgent, false),
    );
    const matches =
      exactMatches.length > 0
        ? exactMatches
        : sourceAgents.filter((agent) =>
            agentMatchesSelector(agent, requestedAgent, true),
          );

    if (matches.length === 0) {
      missing.push(requestedAgent);
      continue;
    }

    if (matches.length > 1) {
      ambiguous.push(
        `${requestedAgent} (${matches.map((agent) => agent.name).join(", ")})`,
      );
      continue;
    }

    if (matches[0]) {
      selectedPaths.add(matches[0].sourcePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Requested agent(s) not found: ${missing.join(", ")}. Available agents: ${sourceAgents.map((agent) => agent.name).join(", ")}.`,
    );
  }

  if (ambiguous.length > 0) {
    throw new Error(
      `Requested agent selector is ambiguous: ${ambiguous.join("; ")}. Use the exact frontmatter name.`,
    );
  }

  return sourceAgents.filter((agent) => selectedPaths.has(agent.sourcePath));
}

function agentMatchesSelector(
  agent: CanonicalAgent,
  selector: string,
  includeSlugFallback: boolean,
): boolean {
  const normalizedSelector = normalizeAgentSelector(selector);
  if (!normalizedSelector) return false;
  if (getExactAgentSelectorCandidates(agent).has(normalizedSelector)) {
    return true;
  }
  if (!includeSlugFallback) return false;

  const selectorSlug = normalizeAgentSelector(slugify(selector));
  return (
    selectorSlug !== "" &&
    getSlugAgentSelectorCandidates(agent).has(selectorSlug)
  );
}

function getExactAgentSelectorCandidates(agent: CanonicalAgent): Set<string> {
  const fileBaseName = agent.fileName.replace(/\.md$/i, "");
  return new Set(
    [
      agent.name,
      fileBaseName,
      path.basename(agent.sourcePath).replace(/\.md$/i, ""),
    ]
      .map(normalizeAgentSelector)
      .filter(Boolean),
  );
}

function getSlugAgentSelectorCandidates(agent: CanonicalAgent): Set<string> {
  const fileBaseName = agent.fileName.replace(/\.md$/i, "");
  return new Set(
    [
      slugify(agent.name),
      slugify(fileBaseName),
      slugify(path.basename(agent.sourcePath).replace(/\.md$/i, "")),
    ]
      .map(normalizeAgentSelector)
      .filter(Boolean),
  );
}

function normalizeAgentSelector(value: string): string {
  return value.trim().toLowerCase();
}

async function promptAgentSelection(
  sourceAgents: CanonicalAgent[],
): Promise<CanonicalAgent[]> {
  const choice = await multiselect({
    message: withMultiselectHelp("Select agents to import"),
    options: sourceAgents.map((agent) => ({
      value: agent.sourcePath,
      label: agent.name,
      hint: agent.description,
    })),
    initialValues: sourceAgents.map((agent) => agent.sourcePath),
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selected = new Set(Array.isArray(choice) ? choice.map(String) : []);
  return sourceAgents.filter((agent) => selected.has(agent.sourcePath));
}

function findMatchingLockEntry(
  entries: LockEntry[],
  key: Pick<
    LockEntry,
    | "source"
    | "sourceType"
    | "subdir"
    | "requestedAgents"
    | "selectedSourceCommands"
    | "selectedSourceMcpServers"
    | "selectedSourceRules"
    | "selectedSourceSkills"
    | "skillsProviders"
  > & { selectedSkills?: CanonicalSkill[] },
): LockEntry | undefined {
  return entries.find(
    (entry) =>
      entry.source === key.source &&
      entry.sourceType === key.sourceType &&
      entry.subdir === key.subdir &&
      sameRequestedAgentsForMatch(entry.requestedAgents, key.requestedAgents) &&
      sameStringSelectionForMatch(
        entry.selectedSourceCommands,
        key.selectedSourceCommands,
      ) &&
      sameStringSelectionForMatch(
        entry.selectedSourceMcpServers,
        key.selectedSourceMcpServers,
      ) &&
      sameStringSelectionForMatch(
        entry.selectedSourceRules,
        key.selectedSourceRules,
        { wildcardWhenRightIsUndefined: true },
      ) &&
      sameSkillSelectionForMatch(
        entry.selectedSourceSkills,
        key.selectedSourceSkills,
        key.selectedSkills,
        { wildcardWhenRightIsUndefined: true },
      ) &&
      sameStringSelectionForMatch(entry.skillsProviders, key.skillsProviders, {
        wildcardWhenRightIsUndefined: true,
      }),
  );
}

function findRelaxedEntityEntries(
  entries: LockEntry[],
  key: Pick<
    LockEntry,
    "source" | "sourceType" | "subdir" | "requestedAgents"
  > & {
    entity: EntityType;
  },
): LockEntry[] {
  const matches = entries.filter(
    (entry) =>
      entry.source === key.source &&
      entry.sourceType === key.sourceType &&
      entry.subdir === key.subdir &&
      (key.entity === "agent" ||
        sameRequestedAgentsForMatch(
          entry.requestedAgents,
          key.requestedAgents,
        )),
  );

  if (matches.length <= 1) return matches;

  return [...matches].sort((left, right) => {
    const leftMixed = isMixedEntryForEntity(left, key.entity) ? 1 : 0;
    const rightMixed = isMixedEntryForEntity(right, key.entity) ? 1 : 0;
    if (leftMixed !== rightMixed) {
      return rightMixed - leftMixed;
    }

    const leftScore = scoreEntryForEntity(left, key.entity);
    const rightScore = scoreEntryForEntity(right, key.entity);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return 0;
  });
}

function isMixedEntryForEntity(entry: LockEntry, entity: EntityType): boolean {
  return (
    (entity !== "agent" &&
      (entry.importedAgents.length > 0 ||
        (entry.requestedAgents?.length ?? 0) > 0)) ||
    (entity !== "command" &&
      (entry.importedCommands.length > 0 ||
        (entry.selectedSourceCommands?.length ?? 0) > 0 ||
        Object.keys(entry.commandRenameMap ?? {}).length > 0)) ||
    (entity !== "mcp" &&
      (entry.importedMcpServers.length > 0 ||
        (entry.selectedSourceMcpServers?.length ?? 0) > 0)) ||
    (entity !== "rule" &&
      (entry.importedRules.length > 0 ||
        (entry.selectedSourceRules?.length ?? 0) > 0 ||
        Object.keys(entry.ruleRenameMap ?? {}).length > 0)) ||
    (entity !== "skill" &&
      (entry.importedSkills.length > 0 ||
        (entry.selectedSourceSkills?.length ?? 0) > 0 ||
        (entry.skillsProviders?.length ?? 0) > 0 ||
        Object.keys(entry.skillRenameMap ?? {}).length > 0))
  );
}

function scoreEntryForEntity(entry: LockEntry, entity: EntityType): number {
  if (entity === "agent") {
    return (
      entry.importedAgents.length * 100 + (entry.requestedAgents?.length ?? 0)
    );
  }

  if (entity === "command") {
    return (
      entry.importedCommands.length * 100 +
      (entry.selectedSourceCommands?.length ?? 0) * 10 +
      Object.keys(entry.commandRenameMap ?? {}).length
    );
  }

  if (entity === "mcp") {
    return (
      entry.importedMcpServers.length * 100 +
      (entry.selectedSourceMcpServers?.length ?? 0) * 10
    );
  }

  if (entity === "rule") {
    return (
      entry.importedRules.length * 100 +
      (entry.selectedSourceRules?.length ?? 0) * 10 +
      Object.keys(entry.ruleRenameMap ?? {}).length
    );
  }

  return (
    entry.importedSkills.length * 100 +
    (entry.selectedSourceSkills?.length ?? 0) * 10 +
    (entry.skillsProviders?.length ?? 0) * 3 +
    Object.keys(entry.skillRenameMap ?? {}).length
  );
}

function mergeRelaxedEntityEntriesForLock(options: {
  canonicalEntry: LockEntry;
  redundantEntries: LockEntry[];
  entity: EntityType;
}): LockEntry {
  if (options.redundantEntries.length === 0) {
    return options.canonicalEntry;
  }

  let mergedEntry: LockEntry = {
    ...options.canonicalEntry,
  };

  if (options.entity === "agent") {
    const mergedRequestedAgents = uniqueStrings([
      ...(mergedEntry.requestedAgents ?? []),
      ...options.redundantEntries.flatMap(
        (entry) => entry.requestedAgents ?? [],
      ),
    ]);
    mergedEntry = {
      ...mergedEntry,
      importedAgents: uniqueStrings([
        ...mergedEntry.importedAgents,
        ...options.redundantEntries.flatMap((entry) => entry.importedAgents),
      ]),
      requestedAgents:
        mergedRequestedAgents.length > 0 ? mergedRequestedAgents : undefined,
    };
  } else if (options.entity === "command") {
    const mergedSelectedSourceCommands = uniqueStrings([
      ...(mergedEntry.selectedSourceCommands ?? []),
      ...options.redundantEntries.flatMap(
        (entry) => entry.selectedSourceCommands ?? [],
      ),
    ]);
    const mergedCommandRenameMap = Object.assign(
      {},
      mergedEntry.commandRenameMap ?? {},
      ...options.redundantEntries.map((entry) => entry.commandRenameMap ?? {}),
    );
    mergedEntry = {
      ...mergedEntry,
      importedCommands: uniqueStrings([
        ...mergedEntry.importedCommands,
        ...options.redundantEntries.flatMap((entry) => entry.importedCommands),
      ]),
      selectedSourceCommands:
        mergedSelectedSourceCommands.length > 0
          ? mergedSelectedSourceCommands
          : undefined,
      commandRenameMap: normalizeCommandRenameMap(mergedCommandRenameMap),
    };
  } else if (options.entity === "mcp") {
    const mergedSelectedSourceMcpServers = uniqueStrings([
      ...(mergedEntry.selectedSourceMcpServers ?? []),
      ...options.redundantEntries.flatMap(
        (entry) => entry.selectedSourceMcpServers ?? [],
      ),
    ]);
    mergedEntry = {
      ...mergedEntry,
      importedMcpServers: uniqueStrings([
        ...mergedEntry.importedMcpServers,
        ...options.redundantEntries.flatMap(
          (entry) => entry.importedMcpServers,
        ),
      ]),
      selectedSourceMcpServers:
        mergedSelectedSourceMcpServers.length > 0
          ? mergedSelectedSourceMcpServers
          : undefined,
    };
  } else if (options.entity === "rule") {
    const mergedSelectedSourceRules = uniqueStrings([
      ...(mergedEntry.selectedSourceRules ?? []),
      ...options.redundantEntries.flatMap(
        (entry) => entry.selectedSourceRules ?? [],
      ),
    ]);
    const mergedRuleRenameMap = Object.assign(
      {},
      mergedEntry.ruleRenameMap ?? {},
      ...options.redundantEntries.map((entry) => entry.ruleRenameMap ?? {}),
    );
    mergedEntry = {
      ...mergedEntry,
      importedRules: uniqueStrings([
        ...mergedEntry.importedRules,
        ...options.redundantEntries.flatMap((entry) => entry.importedRules),
      ]),
      selectedSourceRules:
        mergedSelectedSourceRules.length > 0
          ? mergedSelectedSourceRules
          : undefined,
      ruleRenameMap: normalizeRuleRenameMap(mergedRuleRenameMap),
    };
  } else {
    const mergedSelectedSourceSkills = uniqueStrings([
      ...(mergedEntry.selectedSourceSkills ?? []),
      ...options.redundantEntries.flatMap(
        (entry) => entry.selectedSourceSkills ?? [],
      ),
    ]);
    const mergedSkillsProviders = normalizeSkillsProviders([
      ...(mergedEntry.skillsProviders ?? []),
      ...options.redundantEntries.flatMap(
        (entry) => entry.skillsProviders ?? [],
      ),
    ]);
    const mergedSkillRenameMap = Object.assign(
      {},
      mergedEntry.skillRenameMap ?? {},
      ...options.redundantEntries.map((entry) => entry.skillRenameMap ?? {}),
    );
    mergedEntry = {
      ...mergedEntry,
      importedSkills: uniqueStrings([
        ...mergedEntry.importedSkills,
        ...options.redundantEntries.flatMap((entry) => entry.importedSkills),
      ]),
      selectedSourceSkills:
        mergedSelectedSourceSkills.length > 0
          ? mergedSelectedSourceSkills
          : undefined,
      skillsProviders:
        mergedSkillsProviders && mergedSkillsProviders.length > 0
          ? mergedSkillsProviders
          : undefined,
      skillRenameMap: normalizeSkillRenameMap(mergedSkillRenameMap),
    };
  }

  return mergedEntry;
}

function sameRequestedAgentsForMatch(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const normalizedLeft = normalizeRequestedAgentsForMatch(left);
  const normalizedRight = normalizeRequestedAgentsForMatch(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function normalizeRequestedAgentsForMatch(
  value: string[] | undefined,
): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  return [
    ...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean)),
  ].sort();
}

function sameStringSelectionForMatch(
  left: string[] | undefined,
  right: string[] | undefined,
  options: { wildcardWhenRightIsUndefined?: boolean } = {},
): boolean {
  if (options.wildcardWhenRightIsUndefined && right === undefined) {
    return true;
  }

  const normalizedLeft = normalizeRequestedAgentsForMatch(left);
  const normalizedRight = normalizeRequestedAgentsForMatch(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function sameSkillSelectionForMatch(
  left: string[] | undefined,
  right: string[] | undefined,
  selectedSkills: CanonicalSkill[] | undefined,
  options: { wildcardWhenRightIsUndefined?: boolean } = {},
): boolean {
  if (options.wildcardWhenRightIsUndefined && right === undefined) {
    return true;
  }

  const normalizedLeft = normalizeSkillSelectionsForMatch(left);
  const normalizedRight = normalizeSkillSelectionsForMatch(right);
  if (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  ) {
    return true;
  }

  if (!selectedSkills || normalizedLeft.length !== selectedSkills.length) {
    return false;
  }

  const remainingSelectors = new Set(normalizedLeft);
  for (const skill of selectedSkills) {
    const matchedSelector = [
      normalizeSkillSelector(skill.name),
      normalizeSkillSelector(skill.sourceDirName),
    ].find((selector) => selector && remainingSelectors.has(selector));
    if (!matchedSelector) {
      return false;
    }
    remainingSelectors.delete(matchedSelector);
  }

  return remainingSelectors.size === 0;
}

function normalizeSkillSelectionsForMatch(
  value: string[] | undefined,
): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  return [
    ...new Set(
      value.map((item) => normalizeSkillSelector(item)).filter(Boolean),
    ),
  ].sort();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function computeTrackedEntitiesForLock(options: {
  requestedAgents?: string[];
  importedAgents: string[];
  importedCommands: string[];
  selectedSourceCommands?: string[];
  commandRenameMap?: Record<string, string>;
  importedMcpServers: string[];
  selectedSourceMcpServers?: string[];
  importedRules: string[];
  selectedSourceRules?: string[];
  ruleRenameMap?: Record<string, string>;
  importedSkills: string[];
  selectedSourceSkills?: string[];
  skillsProviders?: Provider[];
  skillRenameMap?: Record<string, string>;
}): EntityType[] | undefined {
  const tracked: EntityType[] = [];

  if (
    options.importedAgents.length > 0 ||
    (options.requestedAgents?.length ?? 0) > 0
  ) {
    tracked.push("agent");
  }

  if (
    options.importedCommands.length > 0 ||
    (options.selectedSourceCommands?.length ?? 0) > 0 ||
    Object.keys(options.commandRenameMap ?? {}).length > 0
  ) {
    tracked.push("command");
  }

  if (
    options.importedMcpServers.length > 0 ||
    (options.selectedSourceMcpServers?.length ?? 0) > 0
  ) {
    tracked.push("mcp");
  }

  if (
    options.importedRules.length > 0 ||
    (options.selectedSourceRules?.length ?? 0) > 0 ||
    Object.keys(options.ruleRenameMap ?? {}).length > 0
  ) {
    tracked.push("rule");
  }

  if (
    options.importedSkills.length > 0 ||
    (options.selectedSourceSkills?.length ?? 0) > 0 ||
    (options.skillsProviders?.length ?? 0) > 0 ||
    Object.keys(options.skillRenameMap ?? {}).length > 0
  ) {
    tracked.push("skill");
  }

  return tracked.length > 0 ? tracked : undefined;
}

function normalizeCommandRenameMap(
  renameMap: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!renameMap) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(renameMap).filter(
      ([sourceFileName, importedFileName]) =>
        sourceFileName.trim().length > 0 && importedFileName.trim().length > 0,
    ),
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function mergeCommandRenameMaps(
  existing: Record<string, string> | undefined,
  updates: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const merged = {
    ...(existing ?? {}),
    ...(updates ?? {}),
  };

  return normalizeCommandRenameMap(merged);
}

function mergeRuleRenameMaps(
  existing: Record<string, string> | undefined,
  updates: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const merged = {
    ...(existing ?? {}),
    ...(updates ?? {}),
  };

  return normalizeRuleRenameMap(merged);
}

function resolveMappedTargetFileName(
  sourceFileName: string,
  renameMap: Record<string, string> | undefined,
): string | undefined {
  if (!renameMap) return undefined;

  const normalizedSourceName = normalizeCommandSelector(sourceFileName);
  for (const [sourceSelector, importedName] of Object.entries(renameMap)) {
    if (normalizeCommandSelector(sourceSelector) !== normalizedSourceName) {
      continue;
    }

    const importedBaseName = path.basename(importedName.trim());
    if (!importedBaseName) return undefined;

    const importedExtension = path.extname(importedBaseName);
    if (importedExtension) return importedBaseName;

    const sourceExtension = path.extname(sourceFileName) || ".md";
    return `${slugify(importedBaseName) || "command"}${sourceExtension}`;
  }

  return undefined;
}

function normalizeRuleRenameMap(
  renameMap: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!renameMap) return undefined;

  const normalizedEntries = Object.entries(renameMap)
    .map(([sourceSelector, importedName]) => {
      const normalizedSourceSelector = normalizeRuleSelector(sourceSelector);
      const importedBaseName = path.basename(importedName.trim());
      if (!normalizedSourceSelector || !importedBaseName) {
        return null;
      }

      const ext = path.extname(importedBaseName);
      const stem = stripRuleFileExtension(importedBaseName);
      const normalizedTarget = `${slugify(stem) || "rule"}${ext || ".md"}`;
      return [normalizedSourceSelector, normalizedTarget] as const;
    })
    .filter(
      (
        entry,
      ): entry is readonly [
        normalizedSourceSelector: string,
        importedName: string,
      ] => entry !== null,
    );

  if (normalizedEntries.length === 0) return undefined;
  return Object.fromEntries(normalizedEntries);
}

function resolveMappedTargetRuleFileName(
  sourceFileName: string,
  renameMap: Record<string, string> | undefined,
): string | undefined {
  if (!renameMap) return undefined;

  const normalizedSourceName = normalizeRuleSelector(sourceFileName);
  for (const [sourceSelector, importedName] of Object.entries(renameMap)) {
    if (normalizeRuleSelector(sourceSelector) !== normalizedSourceName) {
      continue;
    }

    const importedBaseName = path.basename(importedName.trim());
    if (!importedBaseName) return undefined;

    const ext = path.extname(importedBaseName);
    if (ext) return importedBaseName;

    return `${slugify(importedBaseName) || "rule"}.md`;
  }

  return undefined;
}

function normalizeSkillRenameMap(
  renameMap: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!renameMap) return undefined;

  const normalizedEntries = Object.entries(renameMap)
    .map(([sourceSelector, importedName]) => {
      const normalizedSourceSelector = normalizeSkillSelector(sourceSelector);
      const normalizedImportedName = slugify(
        path.basename(importedName.trim()),
      );
      if (!normalizedSourceSelector || !normalizedImportedName) {
        return null;
      }
      return [normalizedSourceSelector, normalizedImportedName] as const;
    })
    .filter(
      (
        entry,
      ): entry is readonly [
        normalizedSourceSelector: string,
        importedName: string,
      ] => entry !== null,
    );

  if (normalizedEntries.length === 0) return undefined;
  return Object.fromEntries(normalizedEntries);
}

function mergeSkillRenameMaps(
  existing: Record<string, string> | undefined,
  updates: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const merged = {
    ...(existing ?? {}),
    ...(updates ?? {}),
  };

  return normalizeSkillRenameMap(merged);
}

function mergeImportedSkills(options: {
  existingImportedSkills: string[] | undefined;
  importedSkills: string[];
  selectedSkills: CanonicalSkill[];
  existingSkillRenameMap: Record<string, string> | undefined;
}): string[] {
  if (
    !options.existingImportedSkills ||
    options.existingImportedSkills.length === 0
  ) {
    return [...options.importedSkills];
  }

  const coveredSelectors = new Set<string>();
  for (const skill of options.selectedSkills) {
    const byName = normalizeSkillSelector(skill.name);
    if (byName) coveredSelectors.add(byName);
    const bySourceDir = normalizeSkillSelector(skill.sourceDirName);
    if (bySourceDir) coveredSelectors.add(bySourceDir);
  }
  if (coveredSelectors.size === 0) {
    return [...options.importedSkills];
  }

  const selectedImportedTargets = new Set<string>();
  for (const [sourceSelector, importedName] of Object.entries(
    options.existingSkillRenameMap ?? {},
  )) {
    const normalizedSourceSelector = normalizeSkillSelector(sourceSelector);
    const normalizedImportedName = normalizeSkillSelector(importedName);
    if (
      !normalizedSourceSelector ||
      !normalizedImportedName ||
      !coveredSelectors.has(normalizedSourceSelector)
    ) {
      continue;
    }
    selectedImportedTargets.add(normalizedImportedName);
  }

  const retained = options.existingImportedSkills.filter(
    (importedSkillName) => {
      const selector = normalizeSkillSelector(importedSkillName);
      if (!selector) return true;
      if (coveredSelectors.has(selector)) return false;
      if (selectedImportedTargets.has(selector)) return false;
      return true;
    },
  );

  return uniqueStrings([...retained, ...options.importedSkills]);
}

function resolveMappedTargetSkillName(
  sourceSkill: CanonicalSkill,
  selectedSkills: CanonicalSkill[],
  renameMap: Record<string, string> | undefined,
): string | undefined {
  if (!renameMap) return undefined;

  for (const [sourceSelector, importedName] of Object.entries(renameMap)) {
    const matchedSkill = resolveSkillSelector(selectedSkills, sourceSelector);
    if (!matchedSkill || matchedSkill.sourcePath !== sourceSkill.sourcePath) {
      continue;
    }
    return slugify(path.basename(importedName.trim())) || "skill";
  }

  return undefined;
}

function moveLegacySkillDirectoryToCanonicalIfUnchanged(options: {
  sourceSkill: CanonicalSkill;
  legacySkillDirName: string;
  canonicalSkillDirName: string;
  paths: ScopePaths;
}): void {
  if (options.legacySkillDirName === options.canonicalSkillDirName) {
    return;
  }

  const legacySkillDir = path.join(
    options.paths.skillsDir,
    options.legacySkillDirName,
  );
  if (
    !fs.existsSync(legacySkillDir) ||
    !fs.statSync(legacySkillDir).isDirectory()
  ) {
    return;
  }

  const canonicalSkillDir = path.join(
    options.paths.skillsDir,
    options.canonicalSkillDirName,
  );
  if (fs.existsSync(canonicalSkillDir)) {
    return;
  }
  if (!skillContentMatchesTarget(options.sourceSkill, legacySkillDir)) {
    return;
  }

  moveDirectory(legacySkillDir, canonicalSkillDir);
}

function removeLegacySkillDirectory(options: {
  legacySkillDirName: string;
  canonicalSkillDirName: string;
  paths: ScopePaths;
}): void {
  if (options.legacySkillDirName === options.canonicalSkillDirName) {
    return;
  }

  const legacySkillDir = path.join(
    options.paths.skillsDir,
    options.legacySkillDirName,
  );
  if (!fs.existsSync(legacySkillDir)) {
    return;
  }

  const stat = fs.lstatSync(legacySkillDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return;
  }

  fs.rmSync(legacySkillDir, { recursive: true, force: true });
}

function moveDirectory(sourceDir: string, targetDir: string): void {
  ensureDir(path.dirname(targetDir));

  try {
    fs.renameSync(sourceDir, targetDir);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "EXDEV") {
      throw error;
    }
  }

  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
  fs.rmSync(sourceDir, { recursive: true, force: true });
}

function normalizeSkillsProviders(
  providers: Provider[] | undefined,
): Provider[] | undefined {
  if (!providers || providers.length === 0) return undefined;

  const selected = new Set<Provider>();
  for (const provider of providers) {
    const normalized = provider.trim().toLowerCase() as Provider;
    if (ALL_PROVIDERS.includes(normalized)) {
      selected.add(normalized);
    }
  }

  return selected.size > 0 ? [...selected] : undefined;
}

async function resolveSkillConflict(options: {
  sourceSkill: CanonicalSkill;
  targetSkillDirName: string;
  legacySkillDirName?: string;
  canonicalSkillDirName: string;
  paths: ScopePaths;
  yes: boolean;
  nonInteractive: boolean;
  promptLabel: string;
}): Promise<string | null> {
  const targetPath = path.join(
    options.paths.skillsDir,
    options.targetSkillDirName,
  );
  const conflictPath = resolveExistingSkillConflictPath(options, targetPath);
  if (!conflictPath) return options.targetSkillDirName;

  if (!fs.statSync(conflictPath).isDirectory()) {
    throw new Error(
      `Cannot import skill ${options.promptLabel}: ${conflictPath} exists and is not a directory.`,
    );
  }

  if (skillContentMatchesTarget(options.sourceSkill, conflictPath)) {
    return options.targetSkillDirName;
  }

  if (options.yes) {
    return options.targetSkillDirName;
  }

  if (options.nonInteractive) {
    throw new NonInteractiveConflictError(
      `Conflict for skill "${options.targetSkillDirName}". Use --yes or run interactively.`,
    );
  }

  const choice = await select({
    message: `Skill conflict for ${options.promptLabel}`,
    options: [
      { value: "overwrite", label: `Overwrite ${options.targetSkillDirName}` },
      { value: "skip", label: "Skip this skill" },
      { value: "rename", label: "Rename imported skill" },
    ],
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "skip") return null;

  if (choice === "rename") {
    const entered = await promptText({
      message: `New directory name for ${options.promptLabel}`,
      placeholder: options.targetSkillDirName,
      validate(value) {
        if (!value.trim()) return "Name is required.";
        if (/[\\/]/.test(value)) return "Use a simple directory name.";
        return undefined;
      },
    });

    if (isCancel(entered)) {
      cancel("Operation cancelled.");
      process.exit(1);
    }

    const renamed = slugify(String(entered)) || "skill";
    return resolveSkillConflict({
      ...options,
      targetSkillDirName: renamed,
    });
  }

  return options.targetSkillDirName;
}

function resolveExistingSkillConflictPath(
  options: {
    legacySkillDirName?: string;
    canonicalSkillDirName: string;
    paths: ScopePaths;
  },
  targetPath: string,
): string | null {
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  if (
    !options.legacySkillDirName ||
    options.legacySkillDirName === options.canonicalSkillDirName
  ) {
    return null;
  }

  const legacyPath = path.join(
    options.paths.skillsDir,
    options.legacySkillDirName,
  );
  return fs.existsSync(legacyPath) ? legacyPath : null;
}

async function resolveAgentConflict(options: {
  targetFileName: string;
  agentContent: string;
  paths: ScopePaths;
  yes: boolean;
  nonInteractive: boolean;
  promptLabel: string;
}): Promise<string | null> {
  const targetPath = path.join(options.paths.agentsDir, options.targetFileName);
  if (!fs.existsSync(targetPath)) return options.targetFileName;

  const existing = fs.readFileSync(targetPath, "utf8");
  if (existing === options.agentContent) return options.targetFileName;

  if (options.yes) {
    return options.targetFileName;
  }

  if (options.nonInteractive) {
    throw new NonInteractiveConflictError(
      `Conflict for ${options.targetFileName}. Use --yes or run interactively.`,
    );
  }

  const choice = await select({
    message: `Agent conflict for ${options.promptLabel}`,
    options: [
      { value: "overwrite", label: `Overwrite ${options.targetFileName}` },
      { value: "skip", label: "Skip this agent" },
      { value: "rename", label: "Rename imported agent" },
    ],
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "skip") return null;

  if (choice === "rename") {
    const entered = await promptText({
      message: `New filename (without extension) for ${options.promptLabel}`,
      placeholder: options.targetFileName.replace(/\.md$/, ""),
      validate(value) {
        if (!value.trim()) return "Name is required.";
        if (/[\\/]/.test(value)) return "Use a simple filename.";
        return undefined;
      },
    });

    if (isCancel(entered)) {
      cancel("Operation cancelled.");
      process.exit(1);
    }

    const renamedFileName = `${slugify(String(entered)) || "agent"}.md`;
    return resolveAgentConflict({
      ...options,
      targetFileName: renamedFileName,
    });
  }

  return options.targetFileName;
}

async function resolveCommandConflict(options: {
  targetFileName: string;
  commandContent: string;
  paths: ScopePaths;
  yes: boolean;
  nonInteractive: boolean;
  promptLabel: string;
}): Promise<string | null> {
  const targetPath = path.join(
    options.paths.commandsDir,
    options.targetFileName,
  );
  if (!fs.existsSync(targetPath)) return options.targetFileName;

  const existing = fs.readFileSync(targetPath, "utf8");
  if (existing === options.commandContent) return options.targetFileName;

  if (options.yes) {
    return options.targetFileName;
  }

  if (options.nonInteractive) {
    throw new NonInteractiveConflictError(
      `Conflict for ${options.targetFileName}. Use --yes or run interactively.`,
    );
  }

  const choice = await select({
    message: `Command conflict for ${options.promptLabel}`,
    options: [
      { value: "overwrite", label: `Overwrite ${options.targetFileName}` },
      { value: "skip", label: "Skip this command" },
      { value: "rename", label: "Rename imported command" },
    ],
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "skip") return null;

  if (choice === "rename") {
    const entered = await promptText({
      message: `New filename (without extension) for ${options.promptLabel}`,
      placeholder: options.targetFileName.replace(/\.(md|mdc)$/i, ""),
      validate(value) {
        if (!value.trim()) return "Name is required.";
        if (/[\\/]/.test(value)) return "Use a simple filename.";
        return undefined;
      },
    });

    if (isCancel(entered)) {
      cancel("Operation cancelled.");
      process.exit(1);
    }

    const extension = path.extname(options.targetFileName) || ".md";
    const renamedFileName = `${slugify(String(entered)) || "command"}${extension}`;
    return resolveCommandConflict({
      ...options,
      targetFileName: renamedFileName,
    });
  }

  return options.targetFileName;
}

async function resolveRuleConflict(options: {
  targetFileName: string;
  ruleContent: string;
  paths: ScopePaths;
  yes: boolean;
  nonInteractive: boolean;
  promptLabel: string;
}): Promise<string | null> {
  const targetPath = path.join(options.paths.rulesDir, options.targetFileName);
  if (!fs.existsSync(targetPath)) return options.targetFileName;

  const existing = fs.readFileSync(targetPath, "utf8");
  if (existing === options.ruleContent) return options.targetFileName;

  if (options.yes) {
    return options.targetFileName;
  }

  if (options.nonInteractive) {
    throw new NonInteractiveConflictError(
      `Conflict for ${options.targetFileName}. Use --yes or run interactively.`,
    );
  }

  const choice = await select({
    message: `Rule conflict for ${options.promptLabel}`,
    options: [
      { value: "overwrite", label: `Overwrite ${options.targetFileName}` },
      { value: "skip", label: "Skip this rule" },
      { value: "rename", label: "Rename imported rule" },
    ],
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "skip") return null;

  if (choice === "rename") {
    const entered = await promptText({
      message: `New filename (without extension) for ${options.promptLabel}`,
      placeholder: options.targetFileName.replace(/\.(md|mdc)$/i, ""),
      validate(value) {
        if (!value.trim()) return "Name is required.";
        if (/[\\/]/.test(value)) return "Use a simple filename.";
        return undefined;
      },
    });

    if (isCancel(entered)) {
      cancel("Operation cancelled.");
      process.exit(1);
    }

    const extension = path.extname(options.targetFileName) || ".md";
    const renamedFileName = `${slugify(String(entered)) || "rule"}${extension}`;
    return resolveRuleConflict({
      ...options,
      targetFileName: renamedFileName,
    });
  }

  return options.targetFileName;
}

async function resolveCommandsToImport(options: {
  sourceCommands: ReturnType<typeof parseCommandsDir>;
  selectors: string[];
  promptForCommands: boolean;
  nonInteractive: boolean;
  selectionMode?: SelectionMode;
}): Promise<CommandSelectionResult> {
  const selectors = options.selectors
    .map((selector) => selector.trim())
    .filter(Boolean);

  if (selectors.length > 0) {
    const { selected, unmatched } = resolveCommandSelections(
      options.sourceCommands,
      selectors,
    );

    if (unmatched.length > 0) {
      throw new Error(
        `Command(s) not found in source: ${unmatched.join(", ")}. Available: ${options.sourceCommands.map((item) => item.fileName).join(", ")}`,
      );
    }

    return {
      selectedCommands: selected,
      selectionMode: "custom",
    };
  }

  const selectionResolution = await resolveSelectionModeWithSkip({
    entityLabel: "commands",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForCommands,
    nonInteractive: options.nonInteractive,
  });
  const selectionMode = selectionResolution.selectionMode;
  if (selectionResolution.skipImport) {
    return {
      selectedCommands: [],
      selectionMode: "custom",
    };
  }

  if (
    selectionMode === "all" ||
    !options.promptForCommands ||
    options.nonInteractive
  ) {
    return {
      selectedCommands: options.sourceCommands,
      selectionMode,
    };
  }

  const selected = await multiselect({
    message: withMultiselectHelp("Select commands to import"),
    options: options.sourceCommands.map((item) => ({
      value: item.fileName,
      label: item.fileName,
    })),
    initialValues: options.sourceCommands.map((item) => item.fileName),
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selectedNames = Array.isArray(selected)
    ? new Set(selected.map((value) => String(value)))
    : new Set<string>();

  return {
    selectedCommands: options.sourceCommands.filter((item) =>
      selectedNames.has(item.fileName),
    ),
    selectionMode,
  };
}

async function resolveMcpServersToImport(options: {
  sourceMcp: CanonicalMcpFile;
  selectors: string[];
  promptForMcp: boolean;
  nonInteractive: boolean;
  selectionMode?: SelectionMode;
}): Promise<McpSelectionResult> {
  const available = Object.keys(options.sourceMcp.mcpServers).sort();
  const selectors = options.selectors
    .map((item) => item.trim())
    .filter(Boolean);

  if (selectors.length > 0) {
    const selected = new Set<string>();
    const unmatched: string[] = [];

    for (const selector of selectors) {
      if (
        !Object.prototype.hasOwnProperty.call(
          options.sourceMcp.mcpServers,
          selector,
        )
      ) {
        unmatched.push(selector);
        continue;
      }
      selected.add(selector);
    }

    if (unmatched.length > 0) {
      throw new Error(
        `MCP server(s) not found in source: ${unmatched.join(", ")}. Available: ${available.join(", ")}`,
      );
    }

    return {
      selectedServerNames: [...selected],
      selectionMode: "custom",
    };
  }

  const selectionResolution = await resolveSelectionModeWithSkip({
    entityLabel: "MCP servers",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForMcp,
    nonInteractive: options.nonInteractive,
  });
  const selectionMode = selectionResolution.selectionMode;
  if (selectionResolution.skipImport) {
    return {
      selectedServerNames: [],
      selectionMode: "custom",
    };
  }

  if (
    selectionMode === "all" ||
    !options.promptForMcp ||
    options.nonInteractive
  ) {
    return {
      selectedServerNames: available,
      selectionMode,
    };
  }

  const selected = await multiselect({
    message: withMultiselectHelp("Select MCP servers to import"),
    options: available.map((serverName) => ({
      value: serverName,
      label: serverName,
    })),
    initialValues: available,
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selectedNames = Array.isArray(selected)
    ? new Set(selected.map((value) => String(value)))
    : new Set<string>();

  return {
    selectedServerNames: available.filter((serverName) =>
      selectedNames.has(serverName),
    ),
    selectionMode,
  };
}

async function resolveRulesToImport(options: {
  sourceRules: CanonicalRuleFile[];
  selectors: string[];
  promptForRules: boolean;
  nonInteractive: boolean;
  selectionMode?: SelectionMode;
}): Promise<RuleSelectionResult> {
  const selectors = options.selectors
    .map((selector) => selector.trim())
    .filter(Boolean);

  if (selectors.length > 0) {
    const { selected, unmatched } = resolveRuleSelections(
      options.sourceRules,
      selectors,
    );

    if (unmatched.length > 0) {
      throw new Error(
        `Rule(s) not found in source: ${unmatched.join(", ")}. Available: ${options.sourceRules.map((item) => item.fileName).join(", ")}`,
      );
    }

    return {
      selectedRules: selected,
      selectionMode: "custom",
    };
  }

  const selectionResolution = await resolveSelectionModeWithSkip({
    entityLabel: "rules",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForRules,
    nonInteractive: options.nonInteractive,
  });
  const selectionMode = selectionResolution.selectionMode;
  if (selectionResolution.skipImport) {
    return {
      selectedRules: [],
      selectionMode: "custom",
    };
  }

  if (
    selectionMode === "all" ||
    !options.promptForRules ||
    options.nonInteractive
  ) {
    return {
      selectedRules: options.sourceRules,
      selectionMode,
    };
  }

  const selected = await multiselect({
    message: withMultiselectHelp("Select rules to import"),
    options: options.sourceRules.map((item) => ({
      value: item.fileName,
      label: item.fileName,
      hint: item.name,
    })),
    initialValues: options.sourceRules.map((item) => item.fileName),
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selectedNames = Array.isArray(selected)
    ? new Set(selected.map((value) => String(value)))
    : new Set<string>();

  return {
    selectedRules: options.sourceRules.filter((item) =>
      selectedNames.has(item.fileName),
    ),
    selectionMode,
  };
}

async function resolveSkillsToImport(options: {
  sourceSkills: CanonicalSkill[];
  selectors: string[];
  promptForSkills: boolean;
  nonInteractive: boolean;
  selectionMode?: SelectionMode;
}): Promise<SkillSelectionResult> {
  const selectors = options.selectors
    .map((item) => item.trim())
    .filter(Boolean);
  if (selectors.length > 0) {
    const { selected, unmatched } = resolveSkillSelections(
      options.sourceSkills,
      selectors,
    );

    if (unmatched.length > 0) {
      throw new Error(
        `Skill(s) not found in source: ${unmatched.join(", ")}. Available: ${options.sourceSkills.map((skill) => skill.name).join(", ")}`,
      );
    }

    return {
      selectedSkills: selected,
      selectedSourceSkills: selectors,
      selectionMode: "custom",
    };
  }

  const selectionResolution = await resolveSelectionModeWithSkip({
    entityLabel: "skills",
    selectionMode: options.selectionMode,
    promptForSelection: options.promptForSkills,
    nonInteractive: options.nonInteractive,
  });
  const selectionMode = selectionResolution.selectionMode;
  if (selectionResolution.skipImport) {
    return {
      selectedSkills: [],
      selectedSourceSkills: [],
      selectionMode: "custom",
    };
  }

  if (
    selectionMode === "all" ||
    !options.promptForSkills ||
    options.nonInteractive
  ) {
    return {
      selectedSkills: options.sourceSkills,
      selectedSourceSkills: options.sourceSkills.map((skill) => skill.name),
      selectionMode,
    };
  }

  const selected = await multiselect({
    message: withMultiselectHelp("Select skills to import"),
    options: options.sourceSkills.map((skill) => ({
      value: skill.name,
      label: skill.name,
    })),
    initialValues: options.sourceSkills.map((skill) => skill.name),
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const selectedNames = Array.isArray(selected)
    ? new Set(selected.map((value) => String(value)))
    : new Set<string>();

  return {
    selectedSkills: options.sourceSkills.filter((skill) =>
      selectedNames.has(skill.name),
    ),
    selectedSourceSkills: options.sourceSkills
      .filter((skill) => selectedNames.has(skill.name))
      .map((skill) => skill.name),
    selectionMode,
  };
}

async function resolveSelectionMode(options: {
  entityLabel: string;
  selectionMode?: SelectionMode;
  promptForSelection: boolean;
  nonInteractive: boolean;
}): Promise<SelectionMode> {
  if (options.selectionMode) {
    return options.selectionMode;
  }

  if (!options.promptForSelection || options.nonInteractive) {
    return "all";
  }

  const choice = await select({
    message: `How should ${options.entityLabel} be tracked for future updates?`,
    options: [
      {
        value: "all",
        label: "Sync everything from source",
        hint: "Include new items on update",
      },
      {
        value: "custom",
        label: "Use custom selection",
        hint: "Update only currently selected items",
      },
    ],
    initialValue: "all",
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return choice === "custom" ? "custom" : "all";
}

async function resolveSelectionModeWithSkip(options: {
  entityLabel: string;
  selectionMode?: SelectionMode;
  promptForSelection: boolean;
  nonInteractive: boolean;
}): Promise<SelectionModeResolution> {
  if (options.selectionMode) {
    return {
      selectionMode: options.selectionMode,
      skipImport: false,
    };
  }

  if (!options.promptForSelection || options.nonInteractive) {
    return {
      selectionMode: "all",
      skipImport: false,
    };
  }

  const choice = await select({
    message: `How should ${options.entityLabel} be tracked for future updates?`,
    options: [
      {
        value: "all",
        label: "Sync everything from source",
        hint: "Include new items on update",
      },
      {
        value: "custom",
        label: "Use custom selection",
        hint: "Update only currently selected items",
      },
      {
        value: "skip",
        label: `Skip importing ${options.entityLabel}`,
        hint: "Track none from this source",
      },
    ],
    initialValue: "all",
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "skip") {
    return {
      selectionMode: "custom",
      skipImport: true,
    };
  }

  return {
    selectionMode: choice === "custom" ? "custom" : "all",
    skipImport: false,
  };
}

function normalizeMcp(raw: Record<string, unknown> | null): CanonicalMcpFile {
  if (!raw) {
    return {
      version: 1,
      mcpServers: {},
    };
  }

  if (typeof raw.mcpServers === "object" && raw.mcpServers !== null) {
    return {
      version: 1,
      mcpServers: raw.mcpServers as Record<string, Record<string, unknown>>,
    };
  }

  return {
    version: 1,
    mcpServers: {},
  };
}

async function resolveMcpConflict(options: {
  sourceMcp: CanonicalMcpFile;
  targetMcp: CanonicalMcpFile;
  yes: boolean;
  nonInteractive: boolean;
}): Promise<CanonicalMcpFile> {
  const sourceNames = Object.keys(options.sourceMcp.mcpServers);
  const targetNames = new Set(Object.keys(options.targetMcp.mcpServers));
  const overlap = sourceNames.filter((name) => targetNames.has(name));

  if (overlap.length === 0 || options.yes) {
    return mergeMcp(options.targetMcp, options.sourceMcp);
  }

  if (options.nonInteractive) {
    throw new NonInteractiveConflictError(
      "MCP server conflicts found. Use --yes or run interactively.",
    );
  }

  const choice = await select({
    message: `MCP conflicts detected for: ${overlap.join(", ")}`,
    options: [
      { value: "merge", label: "Merge (source servers override overlaps)" },
      { value: "replace", label: "Replace destination MCP with source MCP" },
    ],
  });

  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (choice === "replace") {
    return {
      version: 1,
      mcpServers: { ...options.sourceMcp.mcpServers },
    };
  }

  return mergeMcp(options.targetMcp, options.sourceMcp);
}

function mergeMcp(
  target: CanonicalMcpFile,
  source: CanonicalMcpFile,
): CanonicalMcpFile {
  return {
    version: 1,
    mcpServers: {
      ...target.mcpServers,
      ...source.mcpServers,
    },
  };
}
