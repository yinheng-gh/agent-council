import { createHash } from "node:crypto";

interface JsonRpcRequestMessage {
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface ToolCallParams {
  name?: string;
  arguments?: unknown;
}

export interface RequestMessageSummary {
  requestId?: string;
  method: string;
  toolName?: string;
  argumentsHash?: string;
}

export interface McpRequestMeta {
  requestHash: string;
  batchSize: number;
  summaries: RequestMessageSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}

export function hashValue(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

export function shortHash(hash?: string, length = 12): string | undefined {
  return hash ? hash.slice(0, length) : undefined;
}

function getToolSummary(message: JsonRpcRequestMessage): RequestMessageSummary | null {
  if (typeof message.method !== "string") {
    return null;
  }

  const summary: RequestMessageSummary = {
    requestId:
      message.id === undefined || message.id === null ? undefined : String(message.id),
    method: message.method,
  };

  if (message.method !== "tools/call" || !isRecord(message.params)) {
    return summary;
  }

  const params = message.params as ToolCallParams;
  summary.toolName = typeof params.name === "string" ? params.name : undefined;
  summary.argumentsHash = hashValue(params.arguments ?? null);

  return summary;
}

export function parseMcpRequestMeta(input: {
  platform: string;
  model: string;
  parsedBody: unknown;
}): McpRequestMeta {
  const messages = Array.isArray(input.parsedBody)
    ? input.parsedBody
    : [input.parsedBody];

  const summaries = messages
    .filter(isRecord)
    .map((message) => getToolSummary(message as JsonRpcRequestMessage))
    .filter((summary): summary is RequestMessageSummary => summary !== null);

  return {
    requestHash: hashValue({
      platform: input.platform,
      model: input.model,
      body: input.parsedBody,
    }),
    batchSize: messages.length,
    summaries,
  };
}
