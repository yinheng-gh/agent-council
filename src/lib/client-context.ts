import { AsyncLocalStorage } from "node:async_hooks";

export interface ClientContext {
  platform: string;
  model: string;
}

export const clientContext = new AsyncLocalStorage<ClientContext>();

export function getClientDefaults(): ClientContext {
  const store = clientContext.getStore();
  return {
    platform: store?.platform || "",
    model: store?.model || "",
  };
}
