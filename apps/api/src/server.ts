import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { initDatabase, type DbContext } from "./db/index.js";
import { registerAcquisitionRoutes } from "./routes/acquisition.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { registerMediaRoutes } from "./routes/media.js";
import { SlskdClient } from "./services/acquisition/slskd.js";
import { ArtistImageService } from "./services/artistImages.js";
import { LibraryScanner } from "./services/scanner.js";

export interface ServerHandle {
  app: FastifyInstance;
  dbContext: DbContext;
  scanner: LibraryScanner;
  artistImageService: ArtistImageService;
  slskdClient: SlskdClient;
}

export interface BuildServerOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Builds and configures the Fastify server without binding to a port.
 * Separating buildServer() from listen() makes the API easy to test.
 */
export async function buildServer(
  config: AppConfig,
  options?: BuildServerOptions,
): Promise<ServerHandle> {
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
  const artistImageService = new ArtistImageService({
    dbContext,
    artistImagesDir: config.artistImagesDir,
    enabled: config.fetchArtistImages,
    logger: app.log,
    fetchImpl: options?.fetchImpl,
  });
  const slskdClient = new SlskdClient({
    baseUrl: config.slskdUrl,
    apiKey: config.slskdApiKey,
    fetchImpl: options?.fetchImpl,
  });

  await registerHealthRoutes(app, { config, dbContext });
  await registerLibraryRoutes(app, { dbContext, scanner });
  await registerMediaRoutes(app, {
    dbContext,
    coversDir: config.coversDir,
    artistImagesDir: config.artistImagesDir,
    artistImageService,
  });
  await registerAcquisitionRoutes(app, { slskdClient });

  // Cleanly close SQLite when Fastify shuts down
  app.addHook("onClose", async () => {
    dbContext.sqlite.close();
  });

  return { app, dbContext, scanner, artistImageService, slskdClient };
}
