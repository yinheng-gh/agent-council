import "dotenv/config";
import { app } from "./app";
import { logger } from "./lib/logger";

const port = Number(process.env.PORT ?? 6000);

logger.info(`Server starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255,
};

