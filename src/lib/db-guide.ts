import { executeSql } from "./db";

interface TableRow {
  name: string;
}

interface ColumnRow {
  cid: number;
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: 0 | 1;
}

interface IndexRow {
  seq: number;
  name: string;
  unique: 0 | 1;
  origin: string;
  partial: 0 | 1;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string;
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

export async function buildDatabaseGuideMarkdown(): Promise<string> {
  const tableSql = `
SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
ORDER BY name;
`;

  const tableRows = asRows<TableRow>(await executeSql(tableSql));

  const lines: string[] = [];
  lines.push("# Database Guide");
  lines.push("");
  lines.push(
    "本指南由运行时 SQLite 元数据动态生成。若 `schema.ts` 变更，请先执行 `bun run db:push` 保持数据库结构同步。"
  );
  lines.push("");

  if (tableRows.length === 0) {
    lines.push("当前数据库中没有业务表。");
    return lines.join("\n");
  }

  lines.push("## Tables");
  lines.push("");

  for (const table of tableRows) {
    const safeTableName = escapeSqlString(table.name);
    const columns = asRows<ColumnRow>(
      await executeSql(`PRAGMA table_info('${safeTableName}')`)
    );
    const indexes = asRows<IndexRow>(
      await executeSql(`PRAGMA index_list('${safeTableName}')`)
    );

    lines.push(`### ${table.name}`);
    lines.push("");
    lines.push("| column | type | not null | default | primary key |");
    lines.push("|---|---|---|---|---|");
    for (const column of columns) {
      lines.push(
        `| ${column.name} | ${column.type || "(empty)"} | ${column.notnull === 1 ? "YES" : "NO"} | ${column.dflt_value ?? "(null)"} | ${column.pk === 1 ? "YES" : "NO"} |`
      );
    }
    lines.push("");

    if (indexes.length === 0) {
      lines.push("Indexes: none");
      lines.push("");
      continue;
    }

    lines.push("Indexes:");
    for (const index of indexes) {
      const safeIndexName = escapeSqlString(index.name);
      const indexColumns = asRows<IndexInfoRow>(
        await executeSql(`PRAGMA index_info('${safeIndexName}')`)
      );
      const columnNames = indexColumns
        .sort((a, b) => a.seqno - b.seqno)
        .map((row) => row.name)
        .join(", ");
      const indexType = index.unique === 1 ? "UNIQUE" : "NON-UNIQUE";

      lines.push(`- ${index.name} (${indexType}) -> ${columnNames}`);
    }
    lines.push("");
  }

  lines.push("## SQL Notes");
  lines.push("");
  lines.push("- 时间字段统一存储为 UTC ISO 字符串。");
  lines.push("- 建议更新后使用 `SELECT` 复查结果。");
  lines.push("- 示例：`SELECT * FROM council_topics ORDER BY created_at DESC LIMIT 20`");

  return lines.join("\n");
}

