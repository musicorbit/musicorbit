import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { PlaylistSyncRunResult } from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { ActivityLogService } from "./activityLog.js";
import type { SettingsService } from "./settings.js";

export interface M3u8TrackInput {
  title: string;
  artistName: string;
  durationSeconds: number | null;
  filePath: string;
}

/**
 * Formats a playlist as a standard UTF-8 #EXTM3U (.m3u8) document using POSIX
 * relative paths from baseDir so Navidrome, Symfonium, and Docker mounts resolve
 * every audio file reliably.
 */
export function formatM3u8Content(
  playlistName: string,
  tracks: M3u8TrackInput[],
  baseDir: string,
): string {
  const lines = ["#EXTM3U", `#PLAYLIST:${playlistName}`];
  for (const track of tracks) {
    const secs = track.durationSeconds ? Math.round(track.durationSeconds) : -1;
    lines.push(`#EXTINF:${secs},${track.artistName} - ${track.title}`);
    const relPath = path.relative(baseDir, track.filePath).split(path.sep).join("/");
    lines.push(relPath);
  }
  return `${lines.join("\n")}\n`;
}

export function sanitizePlaylistFilename(name: string, id: number): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 100);
  const base = cleaned || `playlist_${id}`;
  return `${base}.m3u8`;
}

export interface PlaylistSyncServiceDeps {
  dbContext: DbContext;
  settingsService: SettingsService;
  activityLog?: ActivityLogService;
}

/**
 * Automatically mirrors MusicOrbit SQLite playlists to .m3u8 files on disk when enabled,
 * keeping external players like Navidrome and Symfonium continuously in sync.
 */
export class PlaylistSyncService {
  private readonly dbContext: DbContext;
  private readonly settingsService: SettingsService;
  private readonly activityLog?: ActivityLogService;

  constructor(deps: PlaylistSyncServiceDeps) {
    this.dbContext = deps.dbContext;
    this.settingsService = deps.settingsService;
    this.activityLog = deps.activityLog;
  }

  private getPlaylistTracks(playlistId: number): M3u8TrackInput[] {
    return this.dbContext.sqlite
      .prepare(
        `
        SELECT
          t.title,
          ar.name AS artistName,
          t.duration_seconds AS durationSeconds,
          t.file_path AS filePath
        FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        JOIN artists ar ON ar.id = t.artist_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position ASC, pt.id ASC
      `,
      )
      .all(playlistId) as M3u8TrackInput[];
  }

  private chooseUniqueFilename(name: string, playlistId: number, userId: number): string {
    const preferred = sanitizePlaylistFilename(name, playlistId);
    const conflict = this.dbContext.sqlite
      .prepare("SELECT id FROM playlists WHERE user_id = ? AND synced_filename = ? AND id != ?")
      .get(userId, preferred, playlistId) as { id: number } | undefined;
    if (!conflict) return preferred;
    const stem = preferred.replace(/\.m3u8$/i, "");
    return `${stem}_${playlistId}.m3u8`;
  }

  /**
   * Writes or updates a single playlist's .m3u8 file if playlist sync is enabled for its owner.
   * Handles renames cleanly by removing the previous .m3u8 filename.
   */
  async syncPlaylist(playlistId: number): Promise<string | null> {
    const row = this.dbContext.sqlite
      .prepare(
        "SELECT id, user_id AS userId, name, synced_filename AS syncedFilename FROM playlists WHERE id = ?",
      )
      .get(playlistId) as
      | { id: number; userId: number; name: string; syncedFilename: string | null }
      | undefined;

    if (!row) return null;

    const syncCfg = this.settingsService.getPlaylistSyncSettings(row.userId);
    if (!syncCfg.enabled) return null;

    await fsp.mkdir(syncCfg.playlistsDir, { recursive: true });
    const fileName = this.chooseUniqueFilename(row.name, row.id, row.userId);
    const destPath = path.join(syncCfg.playlistsDir, fileName);

    // If playlist was renamed, remove the previous synced file cleanly
    if (row.syncedFilename && row.syncedFilename !== fileName) {
      const oldPath = path.join(syncCfg.playlistsDir, path.basename(row.syncedFilename));
      await fsp.unlink(oldPath).catch(() => {});
    }

    const tracks = this.getPlaylistTracks(playlistId);
    const content = formatM3u8Content(row.name, tracks, syncCfg.playlistsDir);
    await fsp.writeFile(destPath, content, "utf8");

    if (row.syncedFilename !== fileName) {
      this.dbContext.sqlite
        .prepare("UPDATE playlists SET synced_filename = ? WHERE id = ?")
        .run(fileName, playlistId);
    }

    this.activityLog?.info(
      "playlist",
      `Synced playlist "${row.name}" to ${fileName} (${tracks.length} ${tracks.length === 1 ? "track" : "tracks"})`,
      { playlistId, userId: row.userId, filePath: destPath, trackCount: tracks.length },
    );

    return destPath;
  }

  /**
   * Removes a deleted playlist's synced .m3u8 file from disk if present.
   */
  async deleteSyncedPlaylist(
    syncedFilename: string | null,
    playlistName?: string,
    userId = 1,
  ): Promise<void> {
    if (!syncedFilename) return;
    const syncCfg = this.settingsService.getPlaylistSyncSettings(userId);
    if (!syncCfg.enabled) return;

    const target = path.join(syncCfg.playlistsDir, path.basename(syncedFilename));
    if (fs.existsSync(target)) {
      await fsp.unlink(target).catch(() => {});
      this.activityLog?.info(
        "playlist",
        `Removed synced playlist file ${path.basename(syncedFilename)}${playlistName ? ` ("${playlistName}")` : ""}`,
        { filePath: target, userId },
      );
    }
  }

  /**
   * Syncs every playlist belonging to userId in SQLite to that user's playlistsDir
   * (used when enabling sync, clicking Sync Now, or after post-processing).
   */
  async syncAllPlaylists(force = false, userId = 1): Promise<PlaylistSyncRunResult> {
    const syncCfg = this.settingsService.getPlaylistSyncSettings(userId);
    if (!syncCfg.enabled && !force) {
      return { syncedCount: 0, playlistsDir: syncCfg.playlistsDir, files: [] };
    }

    await fsp.mkdir(syncCfg.playlistsDir, { recursive: true });
    const rows = this.dbContext.sqlite
      .prepare(
        "SELECT id, name, synced_filename AS syncedFilename FROM playlists WHERE user_id = ? ORDER BY id ASC",
      )
      .all(userId) as Array<{ id: number; name: string; syncedFilename: string | null }>;

    const files: string[] = [];
    for (const row of rows) {
      const fileName = this.chooseUniqueFilename(row.name, row.id, userId);
      const destPath = path.join(syncCfg.playlistsDir, fileName);

      if (row.syncedFilename && row.syncedFilename !== fileName) {
        const oldPath = path.join(syncCfg.playlistsDir, path.basename(row.syncedFilename));
        await fsp.unlink(oldPath).catch(() => {});
      }

      const tracks = this.getPlaylistTracks(row.id);
      const content = formatM3u8Content(row.name, tracks, syncCfg.playlistsDir);
      await fsp.writeFile(destPath, content, "utf8");

      if (row.syncedFilename !== fileName) {
        this.dbContext.sqlite
          .prepare("UPDATE playlists SET synced_filename = ? WHERE id = ?")
          .run(fileName, row.id);
      }
      files.push(fileName);
    }

    this.activityLog?.success(
      "playlist",
      `Synced ${files.length} ${files.length === 1 ? "playlist" : "playlists"} to ${syncCfg.playlistsDir}`,
      { userId, playlistsDir: syncCfg.playlistsDir, files },
    );

    return {
      syncedCount: files.length,
      playlistsDir: syncCfg.playlistsDir,
      files,
    };
  }
}
