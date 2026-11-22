import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { initDatabase, type DbContext } from "./db/index.js";
import { registerAcquisitionRoutes } from "./routes/acquisition.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerPlaylistRoutes } from "./routes/playlists.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerStaticWeb } from "./routes/staticWeb.js";
import { SlskdClient } from "./services/acquisition/slskd.js";
import { ArtistImageService } from "./services/artistImages.js";
import { LibraryImporter } from "./services/importer.js";
import { MetadataLookupService } from "./services/metadataLookup.js";
import { MusicBrainzClient } from "./services/musicbrainz.js";
import { PlaylistBatchSearchService } from "./services/playlistBatchSearch.js";
import { LibraryScanner } from "./services/scanner.js";
import { SettingsService } from "./services/settings.js";

export interface ServerHandle {
  app: FastifyInstance;
  dbContext: DbContext;
  settingsService: SettingsService;
  scanner: LibraryScanner;
  artistImageService: ArtistImageService;
  slskdClient: SlskdClient;
  musicBrainz: MusicBrainzClient;
  importer: LibraryImporter;
  batchSearchService: PlaylistBatchSearchService;
}

export interface BuildServerOptions {
  fetchImpl?: typeof fetch;
  musicBrainzRateLimitMs?: number;
  batchSearchStaggerMs?: number;
  batchSearchPollMs?: number;
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
    credentials: true,
  });

  const dbContext = initDatabase(config.dbPath);
  const settingsService = new SettingsService({
    dbContext,
    defaultMusicDir: config.musicDir,
    downloadsDir: config.downloadsDir,
  });
  const getMusicDir = () => settingsService.getMusicDir();

  const scanner = new LibraryScanner({
    dbContext,
    musicDir: config.musicDir,
    getMusicDir,
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
  const metadataLookup = new MetadataLookupService({
    fetchImpl: options?.fetchImpl,
    mbRateLimitMs: options?.musicBrainzRateLimitMs,
  });
  const importer = new LibraryImporter({
    dbContext,
    musicDir: config.musicDir,
    getMusicDir,
    downloadsDir: config.downloadsDir,
    autoImportThreshold: config.autoImportThreshold,
    musicBrainz,
    scanner,
    logger: app.log,
  });
  const batchSearchService = new PlaylistBatchSearchService({
    slskdClient,
    staggerMs: options?.batchSearchStaggerMs,
    pollIntervalMs: options?.batchSearchPollMs,
  });

  // Register auth routes & optional onRequest protection hook before protected routes
  await registerAuthRoutes(app, { dbContext, authEnabled: config.authEnabled });

  await registerHealthRoutes(app, { config, dbContext, getMusicDir });
  await registerSettingsRoutes(app, { settingsService, scanner });
  await registerLibraryRoutes(app, { dbContext, scanner });
  await registerMediaRoutes(app, {
    dbContext,
    coversDir: config.coversDir,
    artistImagesDir: config.artistImagesDir,
    artistImageService,
  });
  await registerAcquisitionRoutes(app, { slskdClient });
  await registerImportRoutes(app, { importer, musicBrainz });
  await registerMetadataRoutes(app, {
    dbContext,
    scanner,
    metadataLookup,
    fetchImpl: options?.fetchImpl,
  });
  await registerPlaylistRoutes(app, {
    dbContext,
    musicDir: config.musicDir,
    getMusicDir,
    coversDir: config.coversDir,
    slskdClient,
    batchSearchService,
  });

  // Serve production frontend bundle when WEB_DIST_DIR is configured (e.g. Docker)
  if (config.webDistDir) {
    await registerStaticWeb(app, config.webDistDir);
  }

  // Cleanly close SQLite when Fastify shuts down
  app.addHook("onClose", async () => {
    dbContext.sqlite.close();
  });

  return {
    app,
    dbContext,
    settingsService,
    scanner,
    artistImageService,
    slskdClient,
    musicBrainz,
    importer,
    batchSearchService,
  };
}
