import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ImportM3u8Response,
  MissingTrackBatchJobStatus,
  PlaylistDetailResponse,
  PlaylistImportFormat,
  PlaylistMissingTrack,
  PlaylistSummary,
  RecheckMissingTracksResponse,
  TrackSummary,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { ActivityLogService } from "../services/activityLog.js";
import { SlskdError, type SlskdClient } from "../services/acquisition/slskd.js";
import { getRequestUser, requireSoulseekAccess } from "../services/authHelpers.js";
import type { PlaylistBatchSearchService } from "../services/playlistBatchSearch.js";
import type { PlaylistSyncService } from "../services/playlistSync.js";
import {
  buildLibraryTrackMatcher,
  parseCsvPlaylist,
  parseM3u8Playlist,
  type LocalLibraryTrack,
} from "../services/playlistImport.js";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const MAX_PLAYLIST_COVER_BYTES = 5 * 1024 * 1024;

function detectImageExtension(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  // GIF: GIF8
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "gif";
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export interface PlaylistRouteDeps {
  dbContext: DbContext;
  musicDir: string;
  getMusicDir?: () => string;
  getUserMusicDir?: (userId: number) => string;
  coversDir: string;
  slskdClient?: SlskdClient;
  batchSearchService?: PlaylistBatchSearchService;
  playlistSync?: PlaylistSyncService;
  activityLog?: ActivityLogService;
  onDownloadEnqueued?: (
    userId: number,
    slskdUsername: string,
    files: Array<{ filename: string; size?: number }>,
  ) => void;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const removeTrackParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  trackId: z.coerce.number().int().positive(),
});

const missingTrackParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  missingId: z.coerce.number().int().positive(),
});

const createPlaylistBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(""),
});

const updatePlaylistBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
});

const addTracksBodySchema = z.object({
  trackIds: z.array(z.number().int().positive()).min(1).max(500),
});

const reorderBodySchema = z.object({
  trackIds: z.array(z.number().int().positive()),
});

const importPlaylistBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().min(1).max(5_000_000),
  format: z.enum(["m3u8", "csv"]).optional(),
});

const startBatchSearchBodySchema = z
  .object({
    missingTrackIds: z.array(z.number().int().positive()).max(500).optional(),
    concurrency: z.number().int().min(1).max(3).optional(),
  })
  .optional()
  .default({});

const downloadMissingCandidateBodySchema = z.object({
  username: z.string().trim().min(1).max(200),
  filename: z.string().min(1),
  size: z.number().int().min(0),
});

const coverFromAlbumBodySchema = z.object({
  albumId: z.number().int().positive(),
});

interface PlaylistRow {
  id: number;
  name: string;
  description: string;
  trackCount: number;
  missingCount: number;
  totalDurationSeconds: number;
  coverAlbumId: number | null;
  coverHash: string | null;
  createdAt: number;
  updatedAt: number;
}

interface TrackRow {
  id: number;
  title: string;
  albumId: number;
  albumTitle: string;
  artistId: number;
  artistName: string;
  trackNumber: number | null;
  discNumber: number | null;
  durationSeconds: number | null;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  filePath: string;
}

interface MissingTrackRow {
  id: number;
  playlistId: number;
  position: number;
  title: string;
  artist: string;
  album: string | null;
  status: string;
}

function toPlaylistSummary(row: PlaylistRow): PlaylistSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackCount: row.trackCount,
    missingCount: row.missingCount,
    totalDurationSeconds: row.totalDurationSeconds,
    coverAlbumId: row.coverAlbumId,
    coverHash: row.coverHash,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function toMissingTrack(row: MissingTrackRow): PlaylistMissingTrack {
  return {
    id: row.id,
    playlistId: row.playlistId,
    position: row.position,
    title: row.title,
    artist: row.artist,
    album: row.album,
    status: row.status === "queued" ? "queued" : "missing",
  };
}

function detectFormat(content: string, explicit?: PlaylistImportFormat): PlaylistImportFormat {
  if (explicit) return explicit;
  const firstLine = content.replace(/^\uFEFF/, "").trimStart().split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.startsWith("#EXTM3U") || firstLine.startsWith("#EXTINF")) {
    return "m3u8";
  }
  const lower = firstLine.toLowerCase();
  if (lower.includes(",") && (lower.includes("track") || lower.includes("artist") || lower.includes("title"))) {
    return "csv";
  }
  return "m3u8";
}

export async function registerPlaylistRoutes(
  app: FastifyInstance,
  deps: PlaylistRouteDeps,
): Promise<void> {
  const { dbContext, coversDir, slskdClient, batchSearchService, playlistSync, activityLog, onDownloadEnqueued } = deps;
  const getMusicDir = deps.getMusicDir ?? (() => deps.musicDir);
  const getUserMusicDir = (userId: number) =>
    deps.getUserMusicDir ? deps.getUserMusicDir(userId) : getMusicDir();
  const { sqlite } = dbContext;

  const selectPlaylistSummary = (playlistId: number, userId: number): PlaylistSummary | null => {
    const row = sqlite
      .prepare(
        `
        SELECT
          p.id,
          p.name,
          p.description,
          p.cover_hash AS coverHash,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          COUNT(pt.id) AS trackCount,
          (
            SELECT COUNT(*)
            FROM playlist_missing_tracks pmt
            WHERE pmt.playlist_id = p.id
          ) AS missingCount,
          COALESCE(SUM(t.duration_seconds), 0) AS totalDurationSeconds,
          (
            SELECT al.id
            FROM playlist_tracks pt2
            JOIN tracks t2 ON t2.id = pt2.track_id
            JOIN albums al ON al.id = t2.album_id
            WHERE pt2.playlist_id = p.id AND al.cover_hash IS NOT NULL
            ORDER BY pt2.position ASC
            LIMIT 1
          ) AS coverAlbumId
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
        LEFT JOIN tracks t ON t.id = pt.track_id
        WHERE p.id = ? AND p.user_id = ?
        GROUP BY p.id
      `,
      )
      .get(playlistId, userId) as PlaylistRow | undefined;

    return row ? toPlaylistSummary(row) : null;
  };

  const selectPlaylistTracks = (playlistId: number): TrackSummary[] => {
    return sqlite
      .prepare(
        `
        SELECT
          t.id,
          t.title,
          t.album_id AS albumId,
          al.title AS albumTitle,
          t.artist_id AS artistId,
          ar.name AS artistName,
          t.track_number AS trackNumber,
          t.disc_number AS discNumber,
          t.duration_seconds AS durationSeconds,
          t.codec,
          t.bitrate,
          t.sample_rate AS sampleRate,
          t.file_path AS filePath
        FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        JOIN albums al ON al.id = t.album_id
        JOIN artists ar ON ar.id = t.artist_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position ASC, pt.id ASC
      `,
      )
      .all(playlistId) as TrackRow[];
  };

  const selectMissingTracks = (playlistId: number): PlaylistMissingTrack[] => {
    const rows = sqlite
      .prepare(
        `
        SELECT
          id,
          playlist_id AS playlistId,
          position,
          title,
          artist,
          album,
          status
        FROM playlist_missing_tracks
        WHERE playlist_id = ?
        ORDER BY position ASC, id ASC
      `,
      )
      .all(playlistId) as MissingTrackRow[];
    return rows.map(toMissingTrack);
  };

  const selectAllLibraryTracks = (userId: number): LocalLibraryTrack[] => {
    return sqlite
      .prepare(
        `
        SELECT t.id, t.title, ar.name AS artistName, t.file_path AS filePath
        FROM tracks t
        JOIN artists ar ON ar.id = t.artist_id
        WHERE t.user_id = ?
      `,
      )
      .all(userId) as LocalLibraryTrack[];
  };

  // List all playlists for this user
  app.get("/api/playlists", async (request): Promise<PlaylistSummary[]> => {
    const user = getRequestUser(request);
    const rows = sqlite
      .prepare(
        `
        SELECT
          p.id,
          p.name,
          p.description,
          p.cover_hash AS coverHash,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          COUNT(pt.id) AS trackCount,
          (
            SELECT COUNT(*)
            FROM playlist_missing_tracks pmt
            WHERE pmt.playlist_id = p.id
          ) AS missingCount,
          COALESCE(SUM(t.duration_seconds), 0) AS totalDurationSeconds,
          (
            SELECT al.id
            FROM playlist_tracks pt2
            JOIN tracks t2 ON t2.id = pt2.track_id
            JOIN albums al ON al.id = t2.album_id
            WHERE pt2.playlist_id = p.id AND al.cover_hash IS NOT NULL
            ORDER BY pt2.position ASC
            LIMIT 1
          ) AS coverAlbumId
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
        LEFT JOIN tracks t ON t.id = pt.track_id
        WHERE p.user_id = ?
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `,
      )
      .all(user.id) as PlaylistRow[];

    return rows.map(toPlaylistSummary);
  });

  // Create playlist
  app.post("/api/playlists", async (request, reply): Promise<PlaylistSummary> => {
    const user = getRequestUser(request);
    const parsed = createPlaylistBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Playlist name is required." });
    }

    const now = Date.now();
    const res = sqlite
      .prepare(
        "INSERT INTO playlists (user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(user.id, parsed.data.name, parsed.data.description, now, now);

    const createdId = Number(res.lastInsertRowid);
    await playlistSync?.syncPlaylist(createdId);
    const created = selectPlaylistSummary(createdId, user.id)!;
    reply.code(201);
    return created;
  });

  // Playlist detail + ordered tracks + missing tracks
  app.get("/api/playlists/:id", async (request, reply): Promise<PlaylistDetailResponse> => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }

    const playlist = selectPlaylistSummary(parsed.data.id, user.id);
    if (!playlist) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    return {
      playlist,
      tracks: selectPlaylistTracks(parsed.data.id),
      missingTracks: selectMissingTracks(parsed.data.id),
    };
  });

  // Rename / update description
  app.patch("/api/playlists/:id", async (request, reply): Promise<PlaylistSummary> => {
    const user = getRequestUser(request);
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }
    const parsedBody = updatePlaylistBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid playlist update payload" });
    }

    const existing = selectPlaylistSummary(parsedId.data.id, user.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const now = Date.now();
    sqlite
      .prepare("UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(
        parsedBody.data.name ?? existing.name,
        parsedBody.data.description ?? existing.description,
        now,
        parsedId.data.id,
        user.id,
      );

    await playlistSync?.syncPlaylist(parsedId.data.id);
    return selectPlaylistSummary(parsedId.data.id, user.id)!;
  });

  // Delete playlist
  app.delete("/api/playlists/:id", async (request, reply) => {
    const user = getRequestUser(request);
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }
    const existingRow = sqlite
      .prepare("SELECT name, synced_filename AS syncedFilename FROM playlists WHERE id = ? AND user_id = ?")
      .get(parsedId.data.id, user.id) as { name: string; syncedFilename: string | null } | undefined;

    if (!existingRow) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    batchSearchService?.cancel(parsedId.data.id);
    sqlite.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(parsedId.data.id, user.id);
    await playlistSync?.deleteSyncedPlaylist(
      existingRow.syncedFilename ?? null,
      existingRow.name,
      user.id,
    );
    return reply.code(204).send();
  });

  // Add tracks to playlist
  app.post("/api/playlists/:id/tracks", async (request, reply): Promise<PlaylistDetailResponse> => {
    const user = getRequestUser(request);
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }
    const parsedBody = addTracksBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Provide at least one track ID" });
    }

    const existing = selectPlaylistSummary(parsedId.data.id, user.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const maxPosRow = sqlite
      .prepare("SELECT COALESCE(MAX(position), -1) AS maxPos FROM playlist_tracks WHERE playlist_id = ?")
      .get(parsedId.data.id) as { maxPos: number };
    let nextPos = maxPosRow.maxPos + 1;

    const now = Date.now();
    const insertStmt = sqlite.prepare(
      "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
    );
    const existsTrackStmt = sqlite.prepare("SELECT id FROM tracks WHERE id = ? AND user_id = ?");

    const tx = sqlite.transaction((trackIds: number[]) => {
      for (const tid of trackIds) {
        if (!existsTrackStmt.get(tid, user.id)) continue;
        insertStmt.run(parsedId.data.id, tid, nextPos, now);
        nextPos += 1;
      }
      sqlite.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, parsedId.data.id);
    });
    tx(parsedBody.data.trackIds);
    await playlistSync?.syncPlaylist(parsedId.data.id);

    return {
      playlist: selectPlaylistSummary(parsedId.data.id, user.id)!,
      tracks: selectPlaylistTracks(parsedId.data.id),
      missingTracks: selectMissingTracks(parsedId.data.id),
    };
  });

  // Remove a track from playlist
  app.delete("/api/playlists/:id/tracks/:trackId", async (request, reply) => {
    const user = getRequestUser(request);
    const parsed = removeTrackParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid parameters" });
    }

    const existing = selectPlaylistSummary(parsed.data.id, user.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const row = sqlite
      .prepare(
        "SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? ORDER BY position ASC LIMIT 1",
      )
      .get(parsed.data.id, parsed.data.trackId) as { id: number } | undefined;

    if (!row) {
      return reply.code(404).send({ error: "Track not found in playlist" });
    }

    sqlite.prepare("DELETE FROM playlist_tracks WHERE id = ?").run(row.id);
    sqlite
      .prepare("UPDATE playlists SET updated_at = ? WHERE id = ?")
      .run(Date.now(), parsed.data.id);
    await playlistSync?.syncPlaylist(parsed.data.id);

    return {
      playlist: selectPlaylistSummary(parsed.data.id, user.id)!,
      tracks: selectPlaylistTracks(parsed.data.id),
      missingTracks: selectMissingTracks(parsed.data.id),
    };
  });

  // Reorder tracks inside a playlist
  app.put("/api/playlists/:id/tracks/reorder", async (request, reply) => {
    const user = getRequestUser(request);
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }
    const parsedBody = reorderBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid trackIds order" });
    }

    const existing = selectPlaylistSummary(parsedId.data.id, user.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const now = Date.now();
    const existsTrackStmt = sqlite.prepare("SELECT id FROM tracks WHERE id = ? AND user_id = ?");
    const tx = sqlite.transaction((trackIds: number[]) => {
      sqlite.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(parsedId.data.id);
      const insertStmt = sqlite.prepare(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
      );
      let pos = 0;
      for (const tid of trackIds) {
        if (!existsTrackStmt.get(tid, user.id)) continue;
        insertStmt.run(parsedId.data.id, tid, pos, now);
        pos += 1;
      }
      sqlite.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, parsedId.data.id);
    });
    tx(parsedBody.data.trackIds);
    await playlistSync?.syncPlaylist(parsedId.data.id);

    return {
      playlist: selectPlaylistSummary(parsedId.data.id, user.id)!,
      tracks: selectPlaylistTracks(parsedId.data.id),
      missingTracks: selectMissingTracks(parsedId.data.id),
    };
  });

  // Export playlist as standard #EXTM3U (.m3u8) compatible with Navidrome, Symfonium, VLC
  app.get("/api/playlists/:id/export.m3u8", async (request, reply) => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }

    const playlist = selectPlaylistSummary(parsed.data.id, user.id);
    if (!playlist) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const activeMusicDir = getUserMusicDir(user.id);
    const tracks = selectPlaylistTracks(parsed.data.id);
    const lines = ["#EXTM3U", `#PLAYLIST:${playlist.name}`];
    for (const track of tracks) {
      const secs = track.durationSeconds ? Math.round(track.durationSeconds) : -1;
      lines.push(`#EXTINF:${secs},${track.artistName} - ${track.title}`);
      const relPath = path.relative(activeMusicDir, track.filePath).split(path.sep).join("/");
      lines.push(relPath);
    }

    const safeFileName = playlist.name.replace(/[^a-zA-Z0-9._ -]/g, "_").trim() || "playlist";
    reply.header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${safeFileName}.m3u8"`);
    return reply.send(`${lines.join("\n")}\n`);
  });

  // Import an .m3u8 or .csv (Exportify / Spotify / generic) playlist
  app.post("/api/playlists/import", async (request, reply): Promise<ImportM3u8Response> => {
    const user = getRequestUser(request);
    const parsed = importPlaylistBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Provide a playlist name and .m3u8 or .csv content." });
    }

    const format = detectFormat(parsed.data.content, parsed.data.format);
    const entries =
      format === "csv"
        ? parseCsvPlaylist(parsed.data.content)
        : parseM3u8Playlist(parsed.data.content);

    if (entries.length === 0) {
      return reply.code(400).send({
        error:
          format === "csv"
            ? "Could not find any tracks in that CSV. Make sure it has a Track Name / Title column (e.g. from exportify.net)."
            : "Could not find any track entries in that .m3u8 file.",
      });
    }

    const matcher = buildLibraryTrackMatcher(selectAllLibraryTracks(user.id), getUserMusicDir(user.id));
    const matchedIds: number[] = [];
    const missingEntries: Array<{ position: number; title: string; artist: string; album: string | null; rawLabel: string }> = [];

    entries.forEach((entry, idx) => {
      const matchedId = matcher.match(entry);
      if (matchedId !== null) {
        matchedIds.push(matchedId);
      } else {
        missingEntries.push({
          position: idx,
          title: entry.title,
          artist: entry.artist,
          album: entry.album,
          rawLabel: entry.rawLabel,
        });
      }
    });

    const now = Date.now();
    const desc = format === "csv" ? "Imported from CSV" : "Imported from M3U8";
    const res = sqlite
      .prepare(
        "INSERT INTO playlists (user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(user.id, parsed.data.name, desc, now, now);
    const playlistId = Number(res.lastInsertRowid);

    const insertTrackStmt = sqlite.prepare(
      "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
    );
    const insertMissingStmt = sqlite.prepare(
      "INSERT INTO playlist_missing_tracks (playlist_id, position, title, artist, album, status, created_at) VALUES (?, ?, ?, ?, ?, 'missing', ?)",
    );

    const tx = sqlite.transaction(() => {
      matchedIds.forEach((tid, idx) => insertTrackStmt.run(playlistId, tid, idx, now));
      for (const m of missingEntries) {
        insertMissingStmt.run(playlistId, m.position, m.title, m.artist, m.album, now);
      }
    });
    tx();

    const missingTracks = selectMissingTracks(playlistId);
    await playlistSync?.syncPlaylist(playlistId);
    activityLog?.success(
      "playlist",
      `Imported ${format.toUpperCase()} playlist "${parsed.data.name}": ${matchedIds.length} matched, ${missingTracks.length} missing`,
      { userId: user.id, playlistId, format, matchedCount: matchedIds.length, missingCount: missingTracks.length },
    );
    reply.code(201);
    return {
      playlist: selectPlaylistSummary(playlistId, user.id)!,
      format,
      matchedCount: matchedIds.length,
      missingCount: missingTracks.length,
      unmatchedEntries: missingEntries.slice(0, 50).map((m) => m.rawLabel),
      missingTracks,
    };
  });

  // Re-check missing tracks against the current user's local library
  app.post(
    "/api/playlists/:id/recheck-missing",
    async (request, reply): Promise<RecheckMissingTracksResponse> => {
      const user = getRequestUser(request);
      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid playlist ID" });
      }
      const existing = selectPlaylistSummary(parsedId.data.id, user.id);
      if (!existing) {
        return reply.code(404).send({ error: "Playlist not found" });
      }

      const missing = selectMissingTracks(parsedId.data.id);
      const matcher = buildLibraryTrackMatcher(
        selectAllLibraryTracks(user.id),
        getUserMusicDir(user.id),
      );

      const maxPosRow = sqlite
        .prepare("SELECT COALESCE(MAX(position), -1) AS maxPos FROM playlist_tracks WHERE playlist_id = ?")
        .get(parsedId.data.id) as { maxPos: number };
      let nextPos = maxPosRow.maxPos + 1;
      const now = Date.now();
      let newlyMatchedCount = 0;

      const insertTrackStmt = sqlite.prepare(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
      );
      const deleteMissingStmt = sqlite.prepare("DELETE FROM playlist_missing_tracks WHERE id = ?");

      const tx = sqlite.transaction(() => {
        for (const item of missing) {
          const matchId = matcher.match({
            title: item.title,
            artist: item.artist,
            album: item.album,
            rawLabel: `${item.artist} - ${item.title}`,
          });
          if (matchId !== null) {
            insertTrackStmt.run(parsedId.data.id, matchId, nextPos, now);
            deleteMissingStmt.run(item.id);
            batchSearchService?.removeTrackFromJob(parsedId.data.id, item.id);
            nextPos += 1;
            newlyMatchedCount += 1;
          }
        }
        if (newlyMatchedCount > 0) {
          sqlite
            .prepare("UPDATE playlists SET updated_at = ? WHERE id = ?")
            .run(now, parsedId.data.id);
        }
      });
      tx();

      if (newlyMatchedCount > 0) {
        await playlistSync?.syncPlaylist(parsedId.data.id);
      }

      const remaining = selectMissingTracks(parsedId.data.id);
      return {
        playlist: selectPlaylistSummary(parsedId.data.id, user.id)!,
        newlyMatchedCount,
        remainingMissingCount: remaining.length,
        tracks: selectPlaylistTracks(parsedId.data.id),
        missingTracks: remaining,
      };
    },
  );

  // Dismiss a missing track from a playlist
  app.delete("/api/playlists/:id/missing/:missingId", async (request, reply) => {
    const user = getRequestUser(request);
    const parsed = missingTrackParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid parameters" });
    }
    const existing = selectPlaylistSummary(parsed.data.id, user.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }
    const res = sqlite
      .prepare("DELETE FROM playlist_missing_tracks WHERE id = ? AND playlist_id = ?")
      .run(parsed.data.missingId, parsed.data.id);
    if (res.changes === 0) {
      return reply.code(404).send({ error: "Missing track not found" });
    }
    batchSearchService?.removeTrackFromJob(parsed.data.id, parsed.data.missingId);
    return {
      playlist: selectPlaylistSummary(parsed.data.id, user.id)!,
      tracks: selectPlaylistTracks(parsed.data.id),
      missingTracks: selectMissingTracks(parsed.data.id),
    };
  });

  // Start a rate-limited batch Soulseek search across missing tracks (requires Soulseek permission)
  app.post(
    "/api/playlists/:id/missing/search-batch",
    async (request, reply): Promise<MissingTrackBatchJobStatus> => {
      const user = requireSoulseekAccess(request, reply);
      if (!user) return reply as never;

      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid playlist ID" });
      }
      const parsedBody = startBatchSearchBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: "Invalid batch search parameters" });
      }
      if (!slskdClient || !batchSearchService) {
        return reply.code(503).send({ error: "Soulseek batch search is unavailable." });
      }
      if (!slskdClient.isConfigured) {
        return reply.code(503).send({
          error: "slskd is not configured. Set SLSKD_URL and SLSKD_API_KEY in .env first.",
        });
      }

      const existing = selectPlaylistSummary(parsedId.data.id, user.id);
      if (!existing) {
        return reply.code(404).send({ error: "Playlist not found" });
      }

      let targets = selectMissingTracks(parsedId.data.id);
      if (parsedBody.data.missingTrackIds && parsedBody.data.missingTrackIds.length > 0) {
        const allow = new Set(parsedBody.data.missingTrackIds);
        targets = targets.filter((t) => allow.has(t.id));
      }

      if (targets.length === 0) {
        return reply.code(400).send({ error: "No missing tracks to search." });
      }

      const status = batchSearchService.startBatch(
        parsedId.data.id,
        targets,
        parsedBody.data.concurrency,
      );
      reply.code(202);
      return status;
    },
  );

  // Poll live per-song batch search progress
  app.get(
    "/api/playlists/:id/missing/search-batch",
    async (request, reply): Promise<MissingTrackBatchJobStatus> => {
      const user = requireSoulseekAccess(request, reply);
      if (!user) return reply as never;
      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid playlist ID" });
      }
      if (!selectPlaylistSummary(parsedId.data.id, user.id)) {
        return reply.code(404).send({ error: "Playlist not found" });
      }
      if (!batchSearchService) {
        return reply.code(503).send({ error: "Soulseek batch search is unavailable." });
      }
      return batchSearchService.getStatus(parsedId.data.id);
    },
  );

  // Cancel an active batch search
  app.delete(
    "/api/playlists/:id/missing/search-batch",
    async (request, reply): Promise<MissingTrackBatchJobStatus> => {
      const user = requireSoulseekAccess(request, reply);
      if (!user) return reply as never;
      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid playlist ID" });
      }
      if (!selectPlaylistSummary(parsedId.data.id, user.id)) {
        return reply.code(404).send({ error: "Playlist not found" });
      }
      if (!batchSearchService) {
        return reply.code(503).send({ error: "Soulseek batch search is unavailable." });
      }
      return batchSearchService.cancel(parsedId.data.id);
    },
  );

  // Enqueue a chosen Soulseek file for a missing track and mark it as queued
  app.post("/api/playlists/:id/missing/:missingId/download", async (request, reply) => {
    const user = requireSoulseekAccess(request, reply);
    if (!user) return;

    const parsedParams = missingTrackParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid parameters" });
    }
    const parsedBody = downloadMissingCandidateBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid download candidate" });
    }
    if (!slskdClient || !slskdClient.isConfigured) {
      return reply.code(503).send({
        error: "slskd is not configured. Set SLSKD_URL and SLSKD_API_KEY in .env first.",
      });
    }

    if (!selectPlaylistSummary(parsedParams.data.id, user.id)) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const row = sqlite
      .prepare("SELECT id FROM playlist_missing_tracks WHERE id = ? AND playlist_id = ?")
      .get(parsedParams.data.missingId, parsedParams.data.id) as { id: number } | undefined;
    if (!row) {
      return reply.code(404).send({ error: "Missing track not found" });
    }

    try {
      await slskdClient.enqueueDownloads(parsedBody.data.username, [
        { filename: parsedBody.data.filename, size: parsedBody.data.size },
      ]);
    } catch (err) {
      if (err instanceof SlskdError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }

    onDownloadEnqueued?.(user.id, parsedBody.data.username, [
      { filename: parsedBody.data.filename, size: parsedBody.data.size },
    ]);

    sqlite
      .prepare("UPDATE playlist_missing_tracks SET status = 'queued' WHERE id = ?")
      .run(parsedParams.data.missingId);
    batchSearchService?.markTrackQueued(parsedParams.data.id, parsedParams.data.missingId);
    activityLog?.info(
      "acquisition",
      `Queued download for @${user.username} from @${parsedBody.data.username}: ${path.basename(parsedBody.data.filename)}`,
      {
        userId: user.id,
        playlistId: parsedParams.data.id,
        username: parsedBody.data.username,
        filename: parsedBody.data.filename,
      },
    );

    return reply.code(202).send({
      queued: true,
      missingTrackId: parsedParams.data.missingId,
    });
  });

  // Serve a playlist's custom cover image
  app.get("/api/playlists/:id/cover", async (request, reply) => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }

    const row = sqlite
      .prepare("SELECT cover_hash AS coverHash FROM playlists WHERE id = ? AND user_id = ?")
      .get(parsed.data.id, user.id) as { coverHash: string | null } | undefined;

    if (!row || !row.coverHash) {
      return reply.code(404).send({ error: "Custom playlist cover not set" });
    }

    const safeFileName = path.basename(row.coverHash);
    const fullPath = path.join(coversDir, safeFileName);
    if (!fs.existsSync(fullPath)) {
      return reply.code(404).send({ error: "Playlist cover file missing on disk" });
    }

    const ext = path.extname(safeFileName).toLowerCase();
    reply.header("Content-Type", IMAGE_MIME_BY_EXT[ext] ?? "image/jpeg");
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(fullPath));
  });

  // Upload a custom cover image for a playlist (raw image/* binary body up to 5 MB)
  app.put("/api/playlists/:id/cover", async (request, reply): Promise<PlaylistSummary> => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }

    const existing = selectPlaylistSummary(parsed.data.id, user.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply
        .code(400)
        .send({ error: "Expected raw image bytes with an image/* Content-Type." });
    }

    if (body.length > MAX_PLAYLIST_COVER_BYTES) {
      return reply.code(400).send({ error: "Image exceeds the 5 MB size limit." });
    }

    const ext = detectImageExtension(body);
    if (!ext) {
      return reply
        .code(400)
        .send({ error: "Unsupported image format. Please upload a JPG, PNG, WebP, or GIF image." });
    }

    await fsp.mkdir(coversDir, { recursive: true });
    const hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
    const fileName = `pl_${hash}.${ext}`;
    const destPath = path.join(coversDir, fileName);
    if (!fs.existsSync(destPath)) {
      await fsp.writeFile(destPath, body);
    }

    const now = Date.now();
    sqlite
      .prepare("UPDATE playlists SET cover_hash = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(fileName, now, parsed.data.id, user.id);

    return selectPlaylistSummary(parsed.data.id, user.id)!;
  });

  // Set a playlist's cover image from an existing library album's artwork (owned by this user)
  app.post(
    "/api/playlists/:id/cover/from-album",
    async (request, reply): Promise<PlaylistSummary> => {
      const user = getRequestUser(request);
      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid playlist ID" });
      }
      const parsedBody = coverFromAlbumBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: "Please provide a valid album ID." });
      }

      const existing = selectPlaylistSummary(parsedId.data.id, user.id);
      if (!existing) {
        return reply.code(404).send({ error: "Playlist not found" });
      }

      const albumRow = sqlite
        .prepare("SELECT cover_hash AS coverHash FROM albums WHERE id = ? AND user_id = ?")
        .get(parsedBody.data.albumId, user.id) as { coverHash: string | null } | undefined;

      if (!albumRow || !albumRow.coverHash) {
        return reply.code(404).send({ error: "That album does not have cover artwork." });
      }

      const safeAlbumCover = path.basename(albumRow.coverHash);
      if (!fs.existsSync(path.join(coversDir, safeAlbumCover))) {
        return reply.code(404).send({ error: "Album cover file not found on disk." });
      }

      const now = Date.now();
      sqlite
        .prepare("UPDATE playlists SET cover_hash = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(safeAlbumCover, now, parsedId.data.id, user.id);

      return selectPlaylistSummary(parsedId.data.id, user.id)!;
    },
  );

  // Clear custom playlist cover (reverts to automatic first-track album artwork)
  app.delete("/api/playlists/:id/cover", async (request, reply): Promise<PlaylistSummary> => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }

    const existing = selectPlaylistSummary(parsed.data.id, user.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const now = Date.now();
    sqlite
      .prepare("UPDATE playlists SET cover_hash = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(now, parsed.data.id, user.id);

    return selectPlaylistSummary(parsed.data.id, user.id)!;
  });
}
