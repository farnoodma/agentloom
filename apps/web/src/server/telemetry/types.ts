import { z } from "zod";

const entityTypeSchema = z.enum(["agent", "command", "mcp"]);

const sourceSchema = z.object({
  owner: z.string().min(1).max(128),
  repo: z.string().min(1).max(128),
});

const itemSchema = z.object({
  entityType: entityTypeSchema,
  name: z.string().min(1).max(256),
  filePath: z.string().min(1).max(512),
});

export const installEventSchema = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  cliVersion: z.string().min(1).max(64),
  source: sourceSchema,
  items: z.array(itemSchema).min(1).max(256),
});

export type InstallEventPayload = z.infer<typeof installEventSchema>;
export type InstallEventItem = z.infer<typeof itemSchema>;
