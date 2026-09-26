import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function createD1Shim(sqlite: Database): D1Database {
  const client = {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      return {
        bind(...parameters: unknown[]) {
          const args = parameters as never[];
          return {
            all: async () => ({ results: statement.all(...args) }),
            // bun:sqlite's raw() yields BLOB-style values, so emulate D1's raw
            // mode with plain values in the statement's column order.
            raw: async () => {
              const rows = statement.all(...args) as Array<Record<string, unknown>>;
              const columns = (statement as unknown as { columnNames: string[] }).columnNames;
              return rows.map((row) => columns.map((column) => row[column]));
            },
            run: async () => {
              statement.run(...args);
              return { success: true, meta: {} };
            },
            first: async () => statement.get(...args) ?? null,
          };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }> = []) {
      const results: Array<{ results: unknown[] }> = [];
      for (const statement of statements) {
        await statement.run();
        results.push({ results: [] });
      }
      return results;
    },
  };
  return client as unknown as D1Database;
}

export function applyMigrations(sqlite: Database): void {
  const directory = join(import.meta.dir, "..", "drizzle");
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(directory, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}

export function createMigratedDb(): { sqlite: Database; db: D1Database } {
  const sqlite = new Database(":memory:");
  applyMigrations(sqlite);
  return { sqlite, db: createD1Shim(sqlite) };
}
