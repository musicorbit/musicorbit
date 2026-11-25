import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AlbumDetailResponse,
  AlbumSummary,
  AlbumTracklistResponse,
  ArtistDetailResponse,
  ArtistSummary,
  DeleteLibraryItemsResponse,
  ScanStatusResponse,
  TrackSummary,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { ActivityLogService } from "../services/activityLog.js";
import type { AlbumTracklistService } from "../services/albumTracklist.js";
import { getRequestUser } from "../services/authHelpers.js";
import { getSidecarLrcPath } from "../services/lyrics.js";
import type { PlaylistSyncService } from "../services/playlistSync.js";
import type { LibraryScanner } from "../services/scanner.js";

const OS_JUNK_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const COVER_ART_FILES = new Set([
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "cover.webp",
  "folder.jpg",
  "folder.jpeg",
  "folder.png",
  "front.jpg",
  "front.jpeg",
  "front.png",
]);

function isInsideDir(filePath: string, rootDir: string): boolean {
  const rel = path.relative(path.resolve(rootDir), path.resolve(filePath));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isRemovableLeftoverFile(name: string, allowCoverArt: boolean): boolean {
  const lower = name.toLowerCase();
  if (OS_JUNK_FILES.has(lower) || lower.startsWith("._")) return true;
  return allowCoverArt && COVER_ART_FILES.has(lower);
}

async function removeEmptyDirsUpTo(
  startDir: string,
  stopAt: string,
  allowCoverArtInFirstDir = false,
): Promise<void> {
  let current = path.resolve(startDir);
  const boundary = path.resolve(stopAt);
  let isFirst = true;

  while (current !== boundary && current.startsWith(`${boundary}${path.sep}`)) {
    try {
      const entries = await fsp.readdir(current, { withFileTypes: true });
      const allowCovers = isFirst && allowCoverArtInFirstDir;
      const nonRemovable = entries.filter(
        (e) => !(e.isFile() && isRemovableLeftoverFile(e.name, allowCovers)),
      );
      if (nonRemovable.length > 0) break;

      for (const leftover of entries) {
        if (leftover.isFile() && isRemovableLeftoverFile(leftover.name, allowCovers)) {
          await fsp.unlink(path.join(current, leftover.name)).catch(() => {});
        }
      }

      await fsp.rmdir(current);
      current = path.dirname(current);
      isFirst = false;
    } catch {
      break;
    }
  }
}

export interface LibraryRouteDeps {
  dbContext: DbContext;
  scanner: LibraryScanner;
  albumTracklistService?: AlbumTracklistService;
  getUserMusicDir?: (userId: number) => string;
  playlistSync?: PlaylistSyncService;
  activityLog?: ActivityLogService;
}

const triggerScanBodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional();

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const tracklistQuerySchema = z.object({
  releaseId: z
    .string()
    .trim()
    .regex(/^(?:deezer:\d+|mb:[a-f0-9-]+)$/i, "Invalid releaseId")
    .optional(),
  refresh: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
});

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  artistId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  includeTrackOnly: z.coerce.boolean().optional(),
});

interface ArtistRow {
  id: number;
  name: string;
  sortName: string;
  imageHash: string | null;
  fallbackAlbumId: number | null;
  albumCount: number;
  trackCount: number;
}

interface AlbumRow {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  year: number | null;
  genre: string | null;
  coverHash: string | null;
  trackCount: number;
  totalDurationSeconds: number;
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

export async function registerLibraryRoutes(
  app: FastifyInstance,
  deps: LibraryRouteDeps,
): Promise<void> {
  const { dbContext, scanner, albumTracklistService, getUserMusicDir, playlistSync, activityLog } =
    deps;
  const { sqlite } = dbContext;

  const deleteTracksAndCleanup = async (
    userId: number,
    targetTracks: Array<{ id: number; title: string; albumId: number; filePath: string }>,
    allowCoverArtCleanup: boolean,
  ): Promise<{
    deletedTrackIds: number[];
    filesDeleted: number;
    albumRemoved: boolean;
    affectedPlaylistIds: number[];
  }> => {
    const userMusicDir = getUserMusicDir ? path.resolve(getUserMusicDir(userId)) : null;
    const trackIds = targetTracks.map((t) => t.id);
    const affectedAlbumIds = Array.from(new Set(targetTracks.map((t) => t.albumId)));

    // Record affected playlists BEFORE deleting tracks (ON DELETE CASCADE removes playlist_tracks rows)
    const affectedPlaylistIdsSet = new Set<number>();
    const findPlaylistsStmt = sqlite.prepare(
      "SELECT DISTINCT playlist_id AS playlistId FROM playlist_tracks WHERE track_id = ?",
    );
    for (const tid of trackIds) {
      const rows = findPlaylistsStmt.all(tid) as Array<{ playlistId: number }>;
      for (const r of rows) affectedPlaylistIdsSet.add(r.playlistId);
    }

    // Delete audio files + paired .lrc sidecars safely inside the user's own musicDir
    let filesDeleted = 0;
    const parentDirsToClean = new Set<string>();

    for (const t of targetTracks) {
      const resolved = path.resolve(t.filePath);
      if (userMusicDir && !isInsideDir(resolved, userMusicDir)) {
        continue;
      }

      if (fs.existsSync(resolved)) {
        await fsp.unlink(resolved).catch(() => {});
        filesDeleted += 1;
      }

      const sidecarLrc = getSidecarLrcPath(resolved);
      if ((!userMusicDir || isInsideDir(sidecarLrc, userMusicDir)) && fs.existsSync(sidecarLrc)) {
        await fsp.unlink(sidecarLrc).catch(() => {});
      }

      parentDirsToClean.add(path.dirname(resolved));
    }

    // Remove track rows and prune any orphaned albums & artists for this user in a single transaction
    const nowMs = Date.now();
    const deleteTrackStmt = sqlite.prepare("DELETE FROM tracks WHERE id = ? AND user_id = ?");
    const countAlbumTracksStmt = sqlite.prepare(
      "SELECT COUNT(*) AS cnt FROM tracks WHERE album_id = ? AND user_id = ?",
    );
    const deleteAlbumStmt = sqlite.prepare("DELETE FROM albums WHERE id = ? AND user_id = ?");
    const touchPlaylistStmt = sqlite.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?");

    let albumRemoved = false;

    const tx = sqlite.transaction(() => {
      for (const tid of trackIds) {
        deleteTrackStmt.run(tid, userId);
      }

      for (const alId of affectedAlbumIds) {
        const remaining = (countAlbumTracksStmt.get(alId, userId) as { cnt: number }).cnt;
        if (remaining === 0) {
          deleteAlbumStmt.run(alId, userId);
          albumRemoved = true;
        }
      }

      // Prune orphaned artists belonging to this user that no longer have any albums or tracks
      sqlite
        .prepare(
          `
          DELETE FROM artists
          WHERE user_id = ?
            AND id NOT IN (SELECT DISTINCT artist_id FROM albums WHERE user_id = ?)
            AND id NOT IN (SELECT DISTINCT artist_id FROM tracks WHERE user_id = ?)
        `,
        )
        .run(userId, userId, userId);

      for (const plId of affectedPlaylistIdsSet) {
        touchPlaylistStmt.run(nowMs, plId);
      }
    });
    tx();

    // Clean up now-empty parent album/artist folders strictly inside the user's musicDir
    if (userMusicDir) {
      for (const dir of parentDirsToClean) {
        await removeEmptyDirsUpTo(dir, userMusicDir, allowCoverArtCleanup || albumRemoved);
      }
    }

    const affectedPlaylistIds = Array.from(affectedPlaylistIdsSet);
    if (playlistSync && affectedPlaylistIds.length > 0) {
      for (const plId of affectedPlaylistIds) {
        await playlistSync.syncPlaylist(plId).catch(() => {});
      }
    }

    return {
      deletedTrackIds: trackIds,
      filesDeleted,
      albumRemoved,
      affectedPlaylistIds,
    };
  };

  // Trigger an incremental (or forced full) library scan in the background for this user
  app.post("/api/library/scan", async (request, reply): Promise<ScanStatusResponse> => {
    const user = getRequestUser(request);
    const parsed = triggerScanBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      throw new Error("Invalid scan options");
    }

    const result = scanner.startScan({ force: parsed.data?.force, userId: user.id });
    reply.code(result.started ? 202 : 409);
    return result.status;
  });

  // Poll live scan progress or inspect the most recent scan job for this user
  app.get("/api/library/scan/status", async (request): Promise<ScanStatusResponse> => {
    const user = getRequestUser(request);
    return scanner.getStatus(user.id);
  });

  // List album artists (by default) with album & track counts for this user.
  // Passing ?includeTrackOnly=true also includes artists who only appear on individual tracks.
  app.get("/api/artists", async (request): Promise<ArtistSummary[]> => {
    const user = getRequestUser(request);
    const query = listQuerySchema.parse(request.query);
    const conditions: string[] = ["ar.user_id = ?"];
    const params: unknown[] = [user.id];

    if (!query.includeTrackOnly) {
      conditions.push("EXISTS (SELECT 1 FROM albums al WHERE al.artist_id = ar.id AND al.user_id = ?)");
      params.push(user.id);
    }
    if (query.q) {
      conditions.push("lower(ar.name) LIKE ?");
      params.push(`%${query.q.toLowerCase()}%`);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const sql = `
      SELECT
        ar.id,
        ar.name,
        ar.sort_name AS sortName,
        ar.image_hash AS imageHash,
        (
          SELECT al.id
          FROM albums al
          WHERE al.artist_id = ar.id AND al.user_id = ar.user_id AND al.cover_hash IS NOT NULL
          ORDER BY COALESCE(al.year, 0) DESC, al.id ASC
          LIMIT 1
        ) AS fallbackAlbumId,
        (SELECT COUNT(*) FROM albums al WHERE al.artist_id = ar.id AND al.user_id = ar.user_id) AS albumCount,
        (
          SELECT COUNT(DISTINCT t.id)
          FROM tracks t
          JOIN albums al ON al.id = t.album_id
          WHERE t.user_id = ar.user_id AND (t.artist_id = ar.id OR al.artist_id = ar.id)
        ) AS trackCount
      FROM artists ar
      ${whereClause}
      ORDER BY lower(ar.sort_name) ASC
    `;

    const rows = sqlite.prepare(sql).all(...params) as ArtistRow[];
    return rows;
  });

  // Artist detail + albums + tracks (strictly scoped to current user)
  app.get("/api/artists/:id", async (request, reply): Promise<ArtistDetailResponse> => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid artist ID" });
    }

    const artist = sqlite
      .prepare(
        `
        SELECT
          ar.id,
          ar.name,
          ar.sort_name AS sortName,
          ar.image_hash AS imageHash,
          (
            SELECT al.id
            FROM albums al
            WHERE al.artist_id = ar.id AND al.user_id = ar.user_id AND al.cover_hash IS NOT NULL
            ORDER BY COALESCE(al.year, 0) DESC, al.id ASC
            LIMIT 1
          ) AS fallbackAlbumId,
          (SELECT COUNT(*) FROM albums al WHERE al.artist_id = ar.id AND al.user_id = ar.user_id) AS albumCount,
          (
            SELECT COUNT(DISTINCT t.id)
            FROM tracks t
            JOIN albums al ON al.id = t.album_id
            WHERE t.user_id = ar.user_id AND (t.artist_id = ar.id OR al.artist_id = ar.id)
          ) AS trackCount
        FROM artists ar
        WHERE ar.id = ? AND ar.user_id = ?
      `,
      )
      .get(parsed.data.id, user.id) as ArtistRow | undefined;

    if (!artist) {
      return reply.code(404).send({ error: "Artist not found" });
    }

    const artistAlbums = sqlite
      .prepare(
        `
        SELECT
          al.id,
          al.title,
          al.artist_id AS artistId,
          ar.name AS artistName,
          al.year,
          al.genre,
          al.cover_hash AS coverHash,
          COUNT(t.id) AS trackCount,
          COALESCE(SUM(t.duration_seconds), 0) AS totalDurationSeconds
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        LEFT JOIN tracks t ON t.album_id = al.id
        WHERE al.artist_id = ? AND al.user_id = ?
        GROUP BY al.id
        ORDER BY COALESCE(al.year, 9999) ASC, lower(al.title) ASC
      `,
      )
      .all(parsed.data.id, user.id) as AlbumRow[];

    const artistTracks = sqlite
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
        FROM tracks t
        JOIN albums al ON al.id = t.album_id
        JOIN artists ar ON ar.id = t.artist_id
        WHERE t.user_id = ? AND (t.artist_id = ? OR al.artist_id = ?)
        ORDER BY lower(al.title) ASC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, lower(t.title) ASC
      `,
      )
      .all(user.id, parsed.data.id, parsed.data.id) as TrackRow[];

    return { artist, albums: artistAlbums, tracks: artistTracks };
  });

  // List albums with optional search (?q=) or artist filter (?artistId=) for this user
  app.get("/api/albums", async (request): Promise<AlbumSummary[]> => {
    const user = getRequestUser(request);
    const query = listQuerySchema.parse(request.query);
    const conditions: string[] = ["al.user_id = ?"];
    const params: unknown[] = [user.id];

    if (query.artistId !== undefined) {
      conditions.push("al.artist_id = ?");
      params.push(query.artistId);
    }
    if (query.q) {
      conditions.push("(lower(al.title) LIKE ? OR lower(ar.name) LIKE ?)");
      const like = `%${query.q.toLowerCase()}%`;
      params.push(like, like);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const rows = sqlite
      .prepare(
        `
        SELECT
          al.id,
          al.title,
          al.artist_id AS artistId,
          ar.name AS artistName,
          al.year,
          al.genre,
          al.cover_hash AS coverHash,
          COUNT(t.id) AS trackCount,
          COALESCE(SUM(t.duration_seconds), 0) AS totalDurationSeconds
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        LEFT JOIN tracks t ON t.album_id = al.id
        ${whereClause}
        GROUP BY al.id
        ORDER BY lower(ar.sort_name) ASC, COALESCE(al.year, 9999) ASC, lower(al.title) ASC
      `,
      )
      .all(...params) as AlbumRow[];

    return rows;
  });

  // Album detail + ordered tracks (strictly scoped to current user)
  app.get("/api/albums/:id", async (request, reply): Promise<AlbumDetailResponse> => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid album ID" });
    }

    const album = sqlite
      .prepare(
        `
        SELECT
          al.id,
          al.title,
          al.artist_id AS artistId,
          ar.name AS artistName,
          al.year,
          al.genre,
          al.cover_hash AS coverHash,
          COUNT(t.id) AS trackCount,
          COALESCE(SUM(t.duration_seconds), 0) AS totalDurationSeconds
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        LEFT JOIN tracks t ON t.album_id = al.id
        WHERE al.id = ? AND al.user_id = ?
        GROUP BY al.id
      `,
      )
      .get(parsed.data.id, user.id) as AlbumRow | undefined;

    if (!album) {
      return reply.code(404).send({ error: "Album not found" });
    }

    const albumTracks = sqlite
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
        FROM tracks t
        JOIN albums al ON al.id = t.album_id
        JOIN artists ar ON ar.id = t.artist_id
        WHERE t.album_id = ? AND t.user_id = ?
        ORDER BY COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, lower(t.title) ASC
      `,
      )
      .all(parsed.data.id, user.id) as TrackRow[];

    return { album, tracks: albumTracks };
  });

  // Lookup canonical full album tracklist (Deezer / MusicBrainz) and mark owned vs missing tracks
  app.get("/api/albums/:id/tracklist", async (request, reply): Promise<AlbumTracklistResponse> => {
    const user = getRequestUser(request);
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid album ID" });
    }
    const parsedQuery = tracklistQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: "Invalid releaseId parameter" });
    }
    if (!albumTracklistService) {
      return reply.code(503).send({ error: "Album tracklist lookup is unavailable" });
    }

    const albumRow = sqlite
      .prepare(
        `
        SELECT
          al.id,
          al.title,
          ar.name AS artistName,
          al.year,
          al.mbid
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        WHERE al.id = ? AND al.user_id = ?
      `,
      )
      .get(parsedParams.data.id, user.id) as
      | {
          id: number;
          title: string;
          artistName: string;
          year: number | null;
          mbid: string | null;
        }
      | undefined;

    if (!albumRow) {
      return reply.code(404).send({ error: "Album not found" });
    }

    const ownedTracks = sqlite
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
        FROM tracks t
        JOIN albums al ON al.id = t.album_id
        JOIN artists ar ON ar.id = t.artist_id
        WHERE t.album_id = ? AND t.user_id = ?
        ORDER BY COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, lower(t.title) ASC
      `,
      )
      .all(parsedParams.data.id, user.id) as TrackRow[];

    try {
      return await albumTracklistService.lookupAlbumTracklist(albumRow, ownedTracks, {
        releaseId: parsedQuery.data.releaseId,
        refresh: parsedQuery.data.refresh,
      });
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "Failed to fetch full album tracklist",
      });
    }
  });

  // List tracks with optional search (?q=) and limit (?limit=) for this user
  app.get("/api/tracks", async (request): Promise<TrackSummary[]> => {
    const user = getRequestUser(request);
    const query = listQuerySchema.parse(request.query);
    const limit = query.limit ?? 100;
    const params: unknown[] = [user.id];
    let whereClause = "WHERE t.user_id = ?";

    if (query.q) {
      whereClause =
        "WHERE t.user_id = ? AND (lower(t.title) LIKE ? OR lower(al.title) LIKE ? OR lower(ar.name) LIKE ?)";
      const like = `%${query.q.toLowerCase()}%`;
      params.push(like, like, like);
    }

    params.push(limit);

    const rows = sqlite
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
        FROM tracks t
        JOIN albums al ON al.id = t.album_id
        JOIN artists ar ON ar.id = t.artist_id
        ${whereClause}
        ORDER BY lower(ar.sort_name) ASC, lower(al.title) ASC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC
        LIMIT ?
      `,
      )
      .all(...params) as TrackRow[];

    return rows;
  });

  // Permanently delete a single track (audio file + paired .lrc sidecar + DB index + empty folders)
  app.delete("/api/tracks/:id", async (request, reply): Promise<DeleteLibraryItemsResponse> => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }

    const track = sqlite
      .prepare(
        `
        SELECT t.id, t.title, t.album_id AS albumId, t.file_path AS filePath, ar.name AS artistName
        FROM tracks t
        JOIN artists ar ON ar.id = t.artist_id
        WHERE t.id = ? AND t.user_id = ?
      `,
      )
      .get(parsed.data.id, user.id) as
      | { id: number; title: string; albumId: number; filePath: string; artistName: string }
      | undefined;

    if (!track) {
      return reply.code(404).send({ error: "Track not found" });
    }

    const res = await deleteTracksAndCleanup(user.id, [track], false);

    activityLog?.warn("scanner", `Deleted track "${track.artistName} — ${track.title}"`, {
      userId: user.id,
      trackId: track.id,
      filePath: track.filePath,
      filesDeleted: res.filesDeleted,
      albumRemoved: res.albumRemoved,
      playlistsUpdated: res.affectedPlaylistIds.length,
    });

    return {
      deleted: true,
      deletedTrackIds: res.deletedTrackIds,
      deletedTrackCount: res.deletedTrackIds.length,
      albumRemoved: res.albumRemoved,
      filesDeleted: res.filesDeleted,
      playlistsUpdated: res.affectedPlaylistIds.length,
    };
  });

  // Permanently delete an entire album (all its audio files + .lrc sidecars + empty folders + DB rows)
  app.delete("/api/albums/:id", async (request, reply): Promise<DeleteLibraryItemsResponse> => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid album ID" });
    }

    const album = sqlite
      .prepare(
        `
        SELECT al.id, al.title, ar.name AS artistName
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        WHERE al.id = ? AND al.user_id = ?
      `,
      )
      .get(parsed.data.id, user.id) as { id: number; title: string; artistName: string } | undefined;

    if (!album) {
      return reply.code(404).send({ error: "Album not found" });
    }

    const albumTracks = sqlite
      .prepare(
        "SELECT id, title, album_id AS albumId, file_path AS filePath FROM tracks WHERE album_id = ? AND user_id = ?",
      )
      .all(album.id, user.id) as Array<{
      id: number;
      title: string;
      albumId: number;
      filePath: string;
    }>;

    const res = await deleteTracksAndCleanup(user.id, albumTracks, true);

    // Ensure album row is removed even if it somehow had 0 tracks
    sqlite.prepare("DELETE FROM albums WHERE id = ? AND user_id = ?").run(album.id, user.id);

    activityLog?.warn(
      "scanner",
      `Deleted album "${album.artistName} — ${album.title}" (${res.deletedTrackIds.length} ${res.deletedTrackIds.length === 1 ? "track" : "tracks"})`,
      {
        userId: user.id,
        albumId: album.id,
        deletedTrackCount: res.deletedTrackIds.length,
        filesDeleted: res.filesDeleted,
        playlistsUpdated: res.affectedPlaylistIds.length,
      },
    );

    return {
      deleted: true,
      deletedTrackIds: res.deletedTrackIds,
      deletedTrackCount: res.deletedTrackIds.length,
      albumRemoved: true,
      filesDeleted: res.filesDeleted,
      playlistsUpdated: res.affectedPlaylistIds.length,
    };
  });
}
