import { z } from "zod";
import { buildDatabaseGuideMarkdown } from "../lib/db-guide";
import { executeSql } from "../lib/db";
import { logger } from "../lib/logger";
import { mcpServer } from "../lib/mcp-server";

mcpServer.registerTool(
  "sql",
  {
    title: "Execute SQL",
    description:
      "Execute one SQL statement against the SQLite database. Supports query and write operations.",
    inputSchema: {
      sql: z.string().min(1).describe("The SQL statement to execute"),
    },
  },
  async ({ sql }) => {
    try {
      logger.info("[MCP][sql] Executing SQL", { preview: sql.slice(0, 120) });
      const result = await executeSql(sql);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                data: result,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error("[MCP][sql] SQL execution failed", error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

mcpServer.registerTool(
  "db_guide",
  {
    title: "Database Guide",
    description:
      "Get current database structure (tables, columns, indexes) generated from live SQLite metadata.",
  },
  async () => {
    try {
      const markdown = await buildDatabaseGuideMarkdown();
      return {
        content: [{ type: "text", text: markdown }],
      };
    } catch (error) {
      logger.error("[MCP][db_guide] Build guide failed", error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

