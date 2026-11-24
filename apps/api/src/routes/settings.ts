import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  BrowseDirectoriesResponse,
  PlaylistSyncRunResult,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import type { ActivityLogService } from "../services/activityLog.js";
import type { InboxWatcher } from "../services/inboxWatcher.js";
import type { PlaylistSyncService } from "../services/playlistSync.js";
import type { LibraryScanner } from "../services/scanner.js";
import { SettingsError, type SettingsService } from "../services/settings.js";

export interface SettingsRouteDeps {
  settingsService: SettingsService;
  scanner: LibraryScanner;
  inboxWatcher?: InboxWatcher;
  playlistSync?: PlaylistSyncService;
  activityLog?: ActivityLogService;
}

const browseQuerySchema = z.object({
  path: z.string().optional(),
});

const updateMusicDirBodySchema = z.object({
  path: z.string().trim().min(1).max(1000),
  scanNow: z.boolean().optional().default(true),
});

const updatePostProcessingBodySchema = z.object({
  downloadsDir: z.string().trim().min(1).max(1000).optional(),
  fileAction: z.enum(["move", "copy"]).optional(),
  duplicatePolicy: z.enum(["upgrade", "review", "skip"]).optional(),
  autoWatchEnabled: z.boolean().optional(),
  autoWatchIntervalSeconds: z.number().int().min(15).max(3600).optional(),
  autoImportThreshold: z.number().int().min(50).max(100).optional(),
  includeYearInAlbumFolder: z.boolean().optional(),
  autoEmbedCoverArt: z.boolean().optional(),
  autoFetchLyrics: z.boolean().optional(),
});

const updatePlaylistSyncBodySchema = z.object({
  enabled: z.boolean().optional(),
  playlistsDir: z.string().trim().min(1).max(1000).optional(),
});

export async function registerSettingsRoutes(
  app: FastifyInstance,
  deps: SettingsRouteDeps,
): Promise<void> {
  const { settingsService, scanner, inboxWatcher, playlistSync, activityLog } = deps;

  app.get("/api/system/settings", async (): Promise<SystemSettingsResponse> => {
    return settingsService.getSettings();
  });

  app.get(
    "/api/system/browse-dirs",
    async (request): Promise<BrowseDirectoriesResponse> => {
      const parsed = browseQuerySchema.safeParse(request.query);
      const rawPath = parsed.success ? parsed.data.path : undefined;
      return settingsService.browseDirectories(rawPath);
    },
  );

  app.put(
    "/api/system/music-dir",
    async (request, reply): Promise<SystemSettingsResponse> => {
      const parsed = updateMusicDirBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Please provide a valid folder path." });
      }

      try {
        const updated = settingsService.setMusicDir(parsed.data.path);
        activityLog?.info("system", `Music directory changed to ${updated.musicDir}`, {
          scanNow: parsed.data.scanNow,
        });
        if (parsed.data.scanNow) {
          scanner.startScan({ force: false });
        }
        return updated;
      } catch (err) {
        if (err instanceof SettingsError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.put(
    "/api/system/post-processing",
    async (request, reply): Promise<SystemSettingsResponse> => {
      const parsed = updatePostProcessingBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid post-processing settings." });
      }

      try {
        settingsService.updatePostProcessing(parsed.data);
        inboxWatcher?.syncWithSettings();
        const updated = settingsService.getSettings();
        activityLog?.info("system", "Post-processing settings updated", {
          downloadsDir: updated.postProcessing.downloadsDir,
          fileAction: updated.postProcessing.fileAction,
          duplicatePolicy: updated.postProcessing.duplicatePolicy,
          autoWatchEnabled: updated.postProcessing.autoWatchEnabled,
        });
        return updated;
      } catch (err) {
        if (err instanceof SettingsError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.put(
    "/api/system/playlist-sync",
    async (request, reply): Promise<SystemSettingsResponse> => {
      const parsed = updatePlaylistSyncBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid playlist sync settings." });
      }

      try {
        const updated = settingsService.updatePlaylistSync(parsed.data);
        activityLog?.info(
          "system",
          `Playlist .m3u8 sync ${updated.playlistSync.enabled ? "enabled" : "disabled"}`,
          { playlistsDir: updated.playlistSync.playlistsDir },
        );
        if (updated.playlistSync.enabled && playlistSync) {
          await playlistSync.syncAllPlaylists();
        }
        return settingsService.getSettings();
      } catch (err) {
        if (err instanceof SettingsError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/api/system/playlist-sync/run",
    async (_request, reply): Promise<PlaylistSyncRunResult> => {
      if (!playlistSync) {
        return reply.code(503).send({ error: "Playlist sync service is unavailable." });
      }
      return playlistSync.syncAllPlaylists(true);
    },
  );
}
