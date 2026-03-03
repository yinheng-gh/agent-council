import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../db/schema";

const dbFileName = process.env.DB_FILE_NAME ?? "./data/agent-council.db";
const resolvedDbPath = resolve(process.cwd(), dbFileName);

mkdirSync(dirname(resolvedDbPath), { recursive: true });

const sqlite = new Database(resolvedDbPath);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
export { sqlite };

export default db;

export async function executeSql(sqlStatement: string) {
  const trimmed = sqlStatement.trim().toLowerCase();
  if (
    trimmed.startsWith("select") ||
    trimmed.startsWith("with") ||
    trimmed.startsWith("pragma") ||
    trimmed.startsWith("explain")
  ) {
    return await db.all(sql.raw(sqlStatement));
  }

  return await db.run(sql.raw(sqlStatement));
}
