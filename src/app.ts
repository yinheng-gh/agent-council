import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { mcpRoutes } from "./routes/mcp";

export const app = new Hono();

app.use("*", cors());
app.use("*", honoLogger());

app.get("/", (c) =>
  c.json({
    status: "ok",
    message: "agent-council server is running",
  })
);

app.route("/mcp", mcpRoutes);

