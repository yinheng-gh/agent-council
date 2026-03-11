import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId?: string;
  requestHash?: string;
  method?: string;
  toolName?: string;
  argumentsHash?: string;
  batchSize?: number;
}

export interface ClientContext {
  platform: string;
  model: string;
  request?: RequestContext;
}

export const clientContext = new AsyncLocalStorage<ClientContext>();

export function getClientDefaults(): ClientContext {
  const store = clientContext.getStore();
  return {
    platform: store?.platform || "",
    model: store?.model || "",
  };
}

export function getRequestContext(): RequestContext | undefined {
  return clientContext.getStore()?.request;
}
