import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { clientContext } from "../lib/client-context";
import { logger } from "../lib/logger";
import { mcpServer } from "../lib/mcp-server";
import "./council";
import "./db-tools";

export const mcpRoutes = new Hono();
const transport = new StreamableHTTPTransport({
  sessionIdGenerator: undefined,
});

mcpRoutes.all("/", async (c) => {
  if (!mcpServer.isConnected()) {
    await mcpServer.connect(transport);
  }

  logger.info("[MCP] Request received", {
    method: c.req.method,
    path: c.req.path,
  });

  const platform = c.req.query("platform") ?? "";
  const model = c.req.query("model") ?? "";

  return clientContext.run({ platform, model }, () => {
    return transport.handleRequest(c);
  });
});
