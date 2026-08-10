/**
 * A D1 binding backed by in-process SQLite, for the deterministic test script.
 *
 * Test-only, and deliberately thin: it implements exactly the surface drizzle's D1
 * driver calls (`prepare` → `bind` → `all`/`run`/`raw`, plus `batch`) over the real
 * SQLite engine. That means the queries under test — including the conditional
 * upsert the allowance ledger depends on — are executed by SQLite itself rather than
 * by a mock that agrees with whatever the code happens to do.
 */
import { Database as Sqlite, type Statement } from "bun:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Row = Record<string, unknown>;

function prepared(statement: Statement, params: unknown[]) {
  const meta = (changes: number, lastRowId: number) => ({
    changes,
    last_row_id: lastRowId,
    duration: 0,
    rows_read: 0,
    rows_written: changes,
    size_after: 0,
    changed_db: changes > 0,
  });

  return {
    bind(...next: unknown[]) {
      return prepared(statement, next);
    },
    async all() {
      const results = statement.all(...(params as never[])) as Row[];
      return { success: true, results, meta: meta(0, 0) };
    },
    async run() {
      const result = statement.run(...(params as never[]));
      return {
        success: true,
        results: [] as Row[],
        meta: meta(result.changes, Number(result.lastInsertRowid)),
      };
    },
    async raw() {
      return statement.values(...(params as never[])) as unknown[][];
    },
    async first(column?: string) {
      const row = statement.get(...(params as never[])) as Row | null;
      if (!row) return null;
      return column === undefined ? row : (row[column] ?? null);
    },
  };
}

export interface TestDatabase {
  binding: D1Database;
  close(): void;
}

/** Every migration in `apps/web/migrations`, in filename order. */
function migrationStatements(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .flatMap((file) =>
      readFileSync(path.join(migrationsDir, file), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
}

export function createTestDatabase(repoRoot: string): TestDatabase {
  const sqlite = new Sqlite(":memory:");
  // D1 enforces foreign keys; SQLite does not unless asked. Matching it here is what
  // makes a missing user in a test a failure rather than an orphan row.
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const statement of migrationStatements(
    path.join(repoRoot, "apps/web/migrations"),
  )) {
    sqlite.exec(statement);
  }

  const client = {
    prepare(query: string) {
      return prepared(sqlite.prepare(query), []);
    },
    async batch(statements: Array<{ all(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      return results;
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 0, duration: 0 };
    },
    async dump() {
      throw new Error("dump() is not implemented in the test D1 shim");
    },
    withSession() {
      throw new Error("withSession() is not implemented in the test D1 shim");
    },
  };

  return {
    binding: client as unknown as D1Database,
    close: () => sqlite.close(),
  };
}
