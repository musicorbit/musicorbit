import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { initDatabase, type DbContext } from "./db/index.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { LibraryScanner } from "./services/scanner.js";

export interface ServerHandle {
  app: FastifyInstance;
  dbContext: DbContext;
  scanner: LibraryScanner;
}

/**
 * Builds and configures the Fastify server without binding to a port.
 * Separating buildServer() from listen() makes the API easy to test.
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
  const scanner = new LibraryScanner({
    dbContext,
    musicDir: config.musicDir,
    coversDir: config.coversDir,
    logger: app.log,
  });

  await registerHealthRoutes(app, { config, dbContext });
  await registerLibraryRoutes(app, { dbContext, scanner });

  // Cleanly close SQLite when Fastify shuts down
  app.addHook("onClose", async () => {
    dbContext.sqlite.close();
  });

  return { app, dbContext, scanner };
}
