import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { clientContext } from "../lib/client-context";
import { logger } from "../lib/logger";
import { mcpServer } from "../lib/mcp-server";
import { parseMcpRequestMeta, shortHash } from "../lib/request-meta";
import "./council";
import "./db-tools";

export const mcpRoutes = new Hono();
let transport: StreamableHTTPTransport | null = null;
let connectPromise: Promise<void> | null = null;

function createTransport(): StreamableHTTPTransport {
  return new StreamableHTTPTransport({
    sessionIdGenerator: undefined,
  });
}

async function ensureTransportConnected(): Promise<StreamableHTTPTransport> {
  if (mcpServer.isConnected() && transport) {
    return transport;
  }

  if (!connectPromise) {
    transport = createTransport();
    const currentTransport = transport;

    connectPromise = mcpServer
      .connect(currentTransport)
      .catch((error) => {
        if (transport === currentTransport) {
          transport = null;
        }

        throw error;
      })
      .finally(() => {
        connectPromise = null;
      });
  }

  await connectPromise;

  if (!transport) {
    throw new Error("MCP transport is not available after connect");
  }

  return transport;
}

mcpRoutes.all("/", async (c) => {
  const platform = c.req.query("platform") ?? "";
  const model = c.req.query("model") ?? "";
  const contentType = c.req.header("content-type") ?? "";
  let parsedBody: unknown;

  if (c.req.method === "POST" && contentType.includes("application/json")) {
    try {
      parsedBody = await c.req.raw.clone().json();
    } catch (error) {
      logger.warn("[MCP] Failed to parse request body preview", {
        error: error instanceof Error ? error.message : String(error),
        method: c.req.method,
        path: c.req.path,
      });
    }
  }

  const requestMeta =
    parsedBody === undefined
      ? undefined
      : parseMcpRequestMeta({ platform, model, parsedBody });

  const connectedTransport = await ensureTransportConnected();

  logger.info("[MCP] Request received", {
    method: c.req.method,
    path: c.req.path,
    platform,
    model,
    requestHash: shortHash(requestMeta?.requestHash),
    jsonrpcIds: requestMeta?.summaries.map((summary) => summary.requestId),
    rpcMethods: requestMeta?.summaries.map((summary) => summary.method),
    toolNames: requestMeta?.summaries.map((summary) => summary.toolName),
    batchSize: requestMeta?.batchSize,
  });

  const primaryRequest =
    requestMeta?.summaries.length === 1 ? requestMeta.summaries[0] : undefined;

  return clientContext.run(
    {
      platform,
      model,
      request: {
        requestId: primaryRequest?.requestId,
        requestHash: requestMeta?.requestHash,
        method: primaryRequest?.method,
        toolName: primaryRequest?.toolName,
        argumentsHash: primaryRequest?.argumentsHash,
        batchSize: requestMeta?.batchSize,
      },
    },
    () => connectedTransport.handleRequest(c, parsedBody),
  );
});
