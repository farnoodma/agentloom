import type { EntityType } from "../types.js";

export type AggregateVerb = "add" | "find" | "update" | "sync" | "delete";
export type EntityVerb = "add" | "list" | "delete" | "find" | "update" | "sync";
export type McpServerVerb = "add" | "list" | "delete";

export type CommandRoute =
  | {
      mode: "aggregate";
      verb: AggregateVerb;
    }
  | {
      mode: "entity";
      entity: EntityType;
      verb: EntityVerb;
    }
  | {
      mode: "mcp-server";
      verb: McpServerVerb;
    };

const AGGREGATE_VERBS = new Set<AggregateVerb>([
  "add",
  "find",
  "update",
  "sync",
  "delete",
]);

const ENTITY_NOUNS = new Set<EntityType>(["agent", "command", "mcp", "skill"]);

const ENTITY_VERBS = new Set<EntityVerb>([
  "add",
  "list",
  "delete",
  "find",
  "update",
  "sync",
]);

const MCP_SERVER_VERBS = new Set<McpServerVerb>(["add", "list", "delete"]);

export function parseCommandRoute(argv: string[]): CommandRoute | null {
  const root = argv[0]?.trim().toLowerCase();
  if (!root) return null;

  if (AGGREGATE_VERBS.has(root as AggregateVerb)) {
    return {
      mode: "aggregate",
      verb: root as AggregateVerb,
    };
  }

  if (!ENTITY_NOUNS.has(root as EntityType)) {
    return null;
  }

  const action = argv[1]?.trim().toLowerCase();
  if (!action || action === "--help" || action === "-h" || action === "help") {
    return {
      mode: "entity",
      entity: root as EntityType,
      verb: "list",
    };
  }

  if (root === "mcp" && action === "server") {
    const serverVerb = argv[2]?.trim().toLowerCase();
    if (
      !serverVerb ||
      serverVerb === "--help" ||
      serverVerb === "-h" ||
      serverVerb === "help"
    ) {
      return {
        mode: "mcp-server",
        verb: "list",
      };
    }

    if (!MCP_SERVER_VERBS.has(serverVerb as McpServerVerb)) {
      return null;
    }

    return {
      mode: "mcp-server",
      verb: serverVerb as McpServerVerb,
    };
  }

  if (!ENTITY_VERBS.has(action as EntityVerb)) {
    return null;
  }

  return {
    mode: "entity",
    entity: root as EntityType,
    verb: action as EntityVerb,
  };
}
