import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "@/server/db/schema";

let pool: Pool | null = null;
let db: NeonDatabase<typeof schema> | null = null;

function getConnectionString(): string | null {
  const value = process.env.DATABASE_URL;
  if (!value || value.trim() === "") {
    return null;
  }
  return value;
}

export function getDb(): NeonDatabase<typeof schema> | null {
  if (db) {
    return db;
  }

  const connectionString = getConnectionString();
  if (!connectionString) {
    return null;
  }

  pool = new Pool({ connectionString });
  db = drizzle({ client: pool, schema });
  return db;
}
