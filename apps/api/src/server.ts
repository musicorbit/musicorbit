import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { initDatabase, type DbContext } from "./db/index.js";
import { registerAcquisitionRoutes } from "./routes/acquisition.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerLyricsRoutes } from "./routes/lyrics.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerPlaylistRoutes } from "./routes/playlists.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerStaticWeb } from "./routes/staticWeb.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { SlskdClient } from "./services/acquisition/slskd.js";
import { ActivityLogService } from "./services/activityLog.js";
import { AlbumTracklistService } from "./services/albumTracklist.js";
import { ArtistImageService } from "./services/artistImages.js";
import { LibraryImporter } from "./services/importer.js";
import { InboxWatcher } from "./services/inboxWatcher.js";
import { LibraryOrganizer } from "./services/libraryOrganizer.js";
import { LyricsService } from "./services/lyrics.js";
import { MetadataLookupService } from "./services/metadataLookup.js";
import { MusicBrainzClient } from "./services/musicbrainz.js";
import { PlaylistBatchSearchService } from "./services/playlistBatchSearch.js";
import { PlaylistSyncService } from "./services/playlistSync.js";
import { LibraryScanner } from "./services/scanner.js";
import { SettingsService } from "./services/settings.js";

export interface ServerHandle {
  app: FastifyInstance;
  dbContext: DbContext;
  activityLog: ActivityLogService;
  settingsService: SettingsService;
  scanner: LibraryScanner;
  artistImageService: ArtistImageService;
  slskdClient: SlskdClient;
  musicBrainz: MusicBrainzClient;
  importer: LibraryImporter;
  libraryOrganizer: LibraryOrganizer;
  lyricsService: LyricsService;
  inboxWatcher: InboxWatcher;
  batchSearchService: PlaylistBatchSearchService;
  playlistSync: PlaylistSyncService;
}

export interface BuildServerOptions {
  fetchImpl?: typeof fetch;
  musicBrainzRateLimitMs?: number;
  batchSearchStaggerMs?: number;
  batchSearchPollMs?: number;
  lyricsBatchDelayMs?: number;
  maxUploadFileBytes?: number;
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
  const activityLog = new ActivityLogService({
    dbContext,
    logger: app.log,
  });
  const settingsService = new SettingsService({
    dbContext,
    defaultMusicDir: config.musicDir,
    defaultDownloadsDir: config.downloadsDir,
    defaultAutoImportThreshold: config.autoImportThreshold,
  });
  const getMusicDir = () => settingsService.getMusicDir();

  const scanner = new LibraryScanner({
    dbContext,
    musicDir: config.musicDir,
    getMusicDir,
    coversDir: config.coversDir,
    activityLog,
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
  const albumTracklistService = new AlbumTracklistService({
    dbContext,
    musicBrainz,
    fetchImpl: options?.fetchImpl,
  });
  const metadataLookup = new MetadataLookupService({
    fetchImpl: options?.fetchImpl,
    mbRateLimitMs: options?.musicBrainzRateLimitMs,
  });
  const batchSearchService = new PlaylistBatchSearchService({
    slskdClient,
    staggerMs: options?.batchSearchStaggerMs,
    pollIntervalMs: options?.batchSearchPollMs,
  });
  const playlistSync = new PlaylistSyncService({
    dbContext,
    settingsService,
    activityLog,
  });
  const libraryOrganizer = new LibraryOrganizer({
    dbContext,
    settingsService,
    playlistSync,
    activityLog,
    logger: app.log,
  });
  const lyricsService = new LyricsService({
    dbContext,
    activityLog,
    logger: app.log,
    fetchImpl: options?.fetchImpl,
    batchDelayMs: options?.lyricsBatchDelayMs,
  });
  scanner.setOnTracksAdded((addedTrackIds) => {
    if (settingsService.getPostProcessingSettings().autoFetchLyrics) {
      lyricsService.startBatchFetch({ trackIds: addedTrackIds });
    }
  });
  const importer = new LibraryImporter({
    dbContext,
    musicDir: config.musicDir,
    getMusicDir,
    downloadsDir: config.downloadsDir,
    dataDir: config.dataDir,
    autoImportThreshold: config.autoImportThreshold,
    getPostProcessingSettings: () => settingsService.getPostProcessingSettings(),
    getLibraryOrganizationSettings: () => settingsService.getLibraryOrganizationSettings(),
    musicBrainz,
    metadataLookup,
    lyricsService,
    batchSearchService,
    playlistSync,
    activityLog,
    fetchImpl: options?.fetchImpl,
    scanner,
    logger: app.log,
  });
  const inboxWatcher = new InboxWatcher({
    importer,
    settingsService,
    organizer: libraryOrganizer,
    lyricsService,
    scanner,
    activityLog,
    logger: app.log,
  });
  settingsService.setWatcherStatusProvider(() => inboxWatcher.getStatus());
  inboxWatcher.syncWithSettings();

  activityLog.info("system", `MusicOrbit v${config.version} started`, {
    musicDir: getMusicDir(),
    downloadsDir: settingsService.getDownloadsDir(),
  });

  // Register auth routes & optional onRequest protection hook before protected routes
  await registerAuthRoutes(app, { dbContext, authEnabled: config.authEnabled });

  await registerHealthRoutes(app, { config, dbContext, getMusicDir });
  await registerSettingsRoutes(app, {
    settingsService,
    scanner,
    inboxWatcher,
    libraryOrganizer,
    playlistSync,
    activityLog,
  });
  await registerLogRoutes(app, { activityLog });
  await registerLyricsRoutes(app, { lyricsService });
  await registerLibraryRoutes(app, { dbContext, scanner, albumTracklistService });
  await registerMediaRoutes(app, {
    dbContext,
    coversDir: config.coversDir,
    artistImagesDir: config.artistImagesDir,
    artistImageService,
  });
  await registerAcquisitionRoutes(app, { slskdClient });
  await registerImportRoutes(app, { importer, musicBrainz, metadataLookup });
  await registerUploadRoutes(app, {
    dataDir: config.dataDir,
    importer,
    activityLog,
    maxFileBytes: options?.maxUploadFileBytes,
  });
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
    playlistSync,
    activityLog,
  });

  // Serve production frontend bundle when WEB_DIST_DIR is configured (e.g. Docker)
  if (config.webDistDir) {
    await registerStaticWeb(app, config.webDistDir);
  }

  // Cleanly stop watcher & close SQLite when Fastify shuts down
  app.addHook("onClose", async () => {
    inboxWatcher.stop();
    dbContext.sqlite.close();
  });

  return {
    app,
    dbContext,
    activityLog,
    settingsService,
    scanner,
    artistImageService,
    slskdClient,
    musicBrainz,
    importer,
    libraryOrganizer,
    lyricsService,
    inboxWatcher,
    batchSearchService,
    playlistSync,
  };
}
