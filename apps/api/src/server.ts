import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { initDatabase, type DbContext } from "./db/index.js";
import { registerHealthRoutes } from "./routes/health.js";

export interface ServerHandle {
  app: FastifyInstance;
  dbContext: DbContext;
}

/**
 * Builds and configures the Fastify server without binding to a port.
 * Separating buildServer() from listen() makes the API easy to test later.
 */
export async function buildServer(config: AppConfig): Promise<ServerHandle> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await app.register(cors, {
    origin: true,
  });

  const dbContext = initDatabase(config.dbPath);

  await registerHealthRoutes(app, { config, dbContext });

  // Cleanly close SQLite when Fastify shuts down
  app.addHook("onClose", async () => {
    dbContext.sqlite.close();
  });

  return { app, dbContext };
}
