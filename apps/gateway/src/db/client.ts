import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export function createDatabase(database: D1Database) {
  return drizzle(database, { schema });
}
