import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  BrowseDirectoriesResponse,
  OrganizeApplyResponse,
  OrganizePreviewResponse,
  PlaylistSyncRunResult,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import type { ActivityLogService } from "../services/activityLog.js";
import { getRequestUser, requireAdmin } from "../services/authHelpers.js";
import type { InboxWatcher } from "../services/inboxWatcher.js";
import type { LibraryOrganizer } from "../services/libraryOrganizer.js";
import type { PlaylistSyncService } from "../services/playlistSync.js";
import type { LibraryScanner } from "../services/scanner.js";
import { SettingsError, type SettingsService } from "../services/settings.js";

function isPathInsideOrEqual(target: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface SettingsRouteDeps {
  settingsService: SettingsService;
  scanner: LibraryScanner;
  inboxWatcher?: InboxWatcher;
  libraryOrganizer?: LibraryOrganizer;
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

const updateLibraryOrganizationBodySchema = z.object({
  layoutPreset: z.enum(["artist_album_track", "artist_track", "flat", "keep_existing"]).optional(),
  includeYearInAlbumFolder: z.boolean().optional(),
  includeTrackNumber: z.boolean().optional(),
  multiDiscStyle: z.enum(["prefix", "subfolder"]).optional(),
  autoOrganizeLibrary: z.boolean().optional(),
});

const applyOrganizeBodySchema = z
  .object({
    trackIds: z.array(z.number().int().positive()).optional(),
  })
  .optional();

export async function registerSettingsRoutes(
  app: FastifyInstance,
  deps: SettingsRouteDeps,
): Promise<void> {
  const { settingsService, scanner, inboxWatcher, libraryOrganizer, playlistSync, activityLog } =
    deps;

  app.get("/api/system/settings", async (request): Promise<SystemSettingsResponse> => {
    const user = getRequestUser(request);
    return settingsService.getSettings(user.id);
  });

  app.get(
    "/api/system/browse-dirs",
    async (request, reply): Promise<BrowseDirectoriesResponse> => {
      if (!requireAdmin(request, reply)) return reply as never;
      const parsed = browseQuerySchema.safeParse(request.query);
      const rawPath = parsed.success ? parsed.data.path : undefined;
      return settingsService.browseDirectories(rawPath);
    },
  );

  app.put(
    "/api/system/music-dir",
    async (request, reply): Promise<SystemSettingsResponse> => {
      const admin = requireAdmin(request, reply);
      if (!admin) return reply as never;

      const parsed = updateMusicDirBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Please provide a valid folder path." });
      }

      try {
        const updated = settingsService.setMusicDir(parsed.data.path);
        activityLog?.info("system", `Music directory changed to ${updated.musicDir}`, {
          userId: admin.id,
          scanNow: parsed.data.scanNow,
        });
        if (parsed.data.scanNow) {
          scanner.startScan({ force: false, userId: admin.id });
        }
        return settingsService.getSettings(admin.id);
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
      const admin = requireAdmin(request, reply);
      if (!admin) return reply as never;

      const parsed = updatePostProcessingBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid post-processing settings." });
      }

      try {
        settingsService.updatePostProcessing(parsed.data);
        inboxWatcher?.syncWithSettings();
        const updated = settingsService.getSettings(admin.id);
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
      const user = getRequestUser(request);
      const parsed = updatePlaylistSyncBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid playlist sync settings." });
      }

      // Non-admin users may only sync playlists inside their own music directory
      if (user.role !== "admin" && parsed.data.playlistsDir !== undefined) {
        const userMusicDir = settingsService.getUserMusicDir(user.id);
        if (!isPathInsideOrEqual(parsed.data.playlistsDir, userMusicDir)) {
          return reply.code(403).send({
            error: "Playlists sync folder must stay inside your personal music library directory.",
          });
        }
      }

      try {
        const updated = settingsService.updatePlaylistSync(parsed.data, user.id);
        activityLog?.info(
          "system",
          `Playlist .m3u8 sync ${updated.playlistSync.enabled ? "enabled" : "disabled"}`,
          { userId: user.id, playlistsDir: updated.playlistSync.playlistsDir },
        );
        if (updated.playlistSync.enabled && playlistSync) {
          await playlistSync.syncAllPlaylists(false, user.id);
        }
        return settingsService.getSettings(user.id);
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
    async (request, reply): Promise<PlaylistSyncRunResult> => {
      const user = getRequestUser(request);
      if (!playlistSync) {
        return reply.code(503).send({ error: "Playlist sync service is unavailable." });
      }
      return playlistSync.syncAllPlaylists(true, user.id);
    },
  );

  app.put(
    "/api/system/library-organization",
    async (request, reply): Promise<SystemSettingsResponse> => {
      const user = getRequestUser(request);
      const parsed = updateLibraryOrganizationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid library organization settings." });
      }

      settingsService.updateLibraryOrganization(parsed.data, user.id);
      inboxWatcher?.syncWithSettings();
      const updated = settingsService.getSettings(user.id);
      activityLog?.info("organizer", "Library organization settings updated", {
        userId: user.id,
        ...updated.libraryOrganization,
      });
      return updated;
    },
  );

  app.get(
    "/api/system/library-organization/preview",
    async (request, reply): Promise<OrganizePreviewResponse> => {
      const user = getRequestUser(request);
      if (!libraryOrganizer) {
        return reply.code(503).send({ error: "Library organizer is unavailable." });
      }
      return libraryOrganizer.preview({ userId: user.id });
    },
  );

  app.post(
    "/api/system/library-organization/apply",
    async (request, reply): Promise<OrganizeApplyResponse> => {
      const user = getRequestUser(request);
      if (!libraryOrganizer) {
        return reply.code(503).send({ error: "Library organizer is unavailable." });
      }
      const parsed = applyOrganizeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid organize apply options." });
      }
      return libraryOrganizer.apply({ userId: user.id, trackIds: parsed.data?.trackIds });
    },
  );
}
