import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { initDatabase, type DbContext } from "./db/index.js";
import { registerAcquisitionRoutes } from "./routes/acquisition.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { SlskdClient } from "./services/acquisition/slskd.js";
import { ArtistImageService } from "./services/artistImages.js";
import { LibraryImporter } from "./services/importer.js";
import { MusicBrainzClient } from "./services/musicbrainz.js";
import { LibraryScanner } from "./services/scanner.js";

export interface ServerHandle {
  app: FastifyInstance;
  dbContext: DbContext;
  scanner: LibraryScanner;
  artistImageService: ArtistImageService;
  slskdClient: SlskdClient;
  musicBrainz: MusicBrainzClient;
  importer: LibraryImporter;
}

export interface BuildServerOptions {
  fetchImpl?: typeof fetch;
  musicBrainzRateLimitMs?: number;
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
  const musicBrainz = new MusicBrainzClient({
    fetchImpl: options?.fetchImpl,
    rateLimitMs: options?.musicBrainzRateLimitMs,
  });
  const importer = new LibraryImporter({
    dbContext,
    musicDir: config.musicDir,
    downloadsDir: config.downloadsDir,
    autoImportThreshold: config.autoImportThreshold,
    musicBrainz,
    scanner,
    logger: app.log,
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
  await registerImportRoutes(app, { importer, musicBrainz });
  await registerMetadataRoutes(app, { dbContext, scanner });

  // Cleanly close SQLite when Fastify shuts down
  app.addHook("onClose", async () => {
    dbContext.sqlite.close();
  });

  return {
    app,
    dbContext,
    scanner,
    artistImageService,
    slskdClient,
    musicBrainz,
    importer,
  };
}
