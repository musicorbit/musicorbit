import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ImportM3u8Response,
  PlaylistDetailResponse,
  PlaylistSummary,
  TrackSummary,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";

export interface PlaylistRouteDeps {
  dbContext: DbContext;
  musicDir: string;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const removeTrackParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  trackId: z.coerce.number().int().positive(),
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

const importM3u8BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().min(1).max(2_000_000),
});

interface PlaylistRow {
  id: number;
  name: string;
  description: string;
  trackCount: number;
  totalDurationSeconds: number;
  coverAlbumId: number | null;
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

function toPlaylistSummary(row: PlaylistRow): PlaylistSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackCount: row.trackCount,
    totalDurationSeconds: row.totalDurationSeconds,
    coverAlbumId: row.coverAlbumId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function normalizeMatch(val: string): string {
  return val
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

export async function registerPlaylistRoutes(
  app: FastifyInstance,
  deps: PlaylistRouteDeps,
): Promise<void> {
  const { dbContext, musicDir } = deps;
  const { sqlite } = dbContext;

  const selectPlaylistSummary = (playlistId: number): PlaylistSummary | null => {
    const row = sqlite
      .prepare(
        `
        SELECT
          p.id,
          p.name,
          p.description,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          COUNT(pt.id) AS trackCount,
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
        WHERE p.id = ?
        GROUP BY p.id
      `,
      )
      .get(playlistId) as PlaylistRow | undefined;

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

  // List all playlists
  app.get("/api/playlists", async (): Promise<PlaylistSummary[]> => {
    const rows = sqlite
      .prepare(
        `
        SELECT
          p.id,
          p.name,
          p.description,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          COUNT(pt.id) AS trackCount,
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
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `,
      )
      .all() as PlaylistRow[];

    return rows.map(toPlaylistSummary);
  });

  // Create playlist
  app.post("/api/playlists", async (request, reply): Promise<PlaylistSummary> => {
    const parsed = createPlaylistBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Playlist name is required." });
    }

    const now = Date.now();
    const res = sqlite
      .prepare(
        "INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(parsed.data.name, parsed.data.description, now, now);

    const created = selectPlaylistSummary(Number(res.lastInsertRowid))!;
    reply.code(201);
    return created;
  });

  // Playlist detail + ordered tracks
  app.get("/api/playlists/:id", async (request, reply): Promise<PlaylistDetailResponse> => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }

    const playlist = selectPlaylistSummary(parsed.data.id);
    if (!playlist) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    return {
      playlist,
      tracks: selectPlaylistTracks(parsed.data.id),
    };
  });

  // Rename / update description
  app.patch("/api/playlists/:id", async (request, reply): Promise<PlaylistSummary> => {
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }
    const parsedBody = updatePlaylistBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid playlist update payload" });
    }

    const existing = selectPlaylistSummary(parsedId.data.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const now = Date.now();
    sqlite
      .prepare("UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(
        parsedBody.data.name ?? existing.name,
        parsedBody.data.description ?? existing.description,
        now,
        parsedId.data.id,
      );

    return selectPlaylistSummary(parsedId.data.id)!;
  });

  // Delete playlist
  app.delete("/api/playlists/:id", async (request, reply) => {
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }
    const res = sqlite.prepare("DELETE FROM playlists WHERE id = ?").run(parsedId.data.id);
    if (res.changes === 0) {
      return reply.code(404).send({ error: "Playlist not found" });
    }
    return reply.code(204).send();
  });

  // Add tracks to playlist
  app.post("/api/playlists/:id/tracks", async (request, reply): Promise<PlaylistDetailResponse> => {
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }
    const parsedBody = addTracksBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Provide at least one track ID" });
    }

    const existing = selectPlaylistSummary(parsedId.data.id);
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
    const existsTrackStmt = sqlite.prepare("SELECT id FROM tracks WHERE id = ?");

    const tx = sqlite.transaction((trackIds: number[]) => {
      for (const tid of trackIds) {
        if (!existsTrackStmt.get(tid)) continue;
        insertStmt.run(parsedId.data.id, tid, nextPos, now);
        nextPos += 1;
      }
      sqlite.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, parsedId.data.id);
    });
    tx(parsedBody.data.trackIds);

    return {
      playlist: selectPlaylistSummary(parsedId.data.id)!,
      tracks: selectPlaylistTracks(parsedId.data.id),
    };
  });

  // Remove a track from playlist
  app.delete("/api/playlists/:id/tracks/:trackId", async (request, reply) => {
    const parsed = removeTrackParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid parameters" });
    }

    // Remove the first matching occurrence and re-compact positions cleanly
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

    return {
      playlist: selectPlaylistSummary(parsed.data.id)!,
      tracks: selectPlaylistTracks(parsed.data.id),
    };
  });

  // Reorder tracks inside a playlist
  app.put("/api/playlists/:id/tracks/reorder", async (request, reply) => {
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }
    const parsedBody = reorderBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid trackIds order" });
    }

    const existing = selectPlaylistSummary(parsedId.data.id);
    if (!existing) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const now = Date.now();
    const tx = sqlite.transaction((trackIds: number[]) => {
      sqlite.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(parsedId.data.id);
      const insertStmt = sqlite.prepare(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
      );
      trackIds.forEach((tid, idx) => {
        insertStmt.run(parsedId.data.id, tid, idx, now);
      });
      sqlite.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, parsedId.data.id);
    });
    tx(parsedBody.data.trackIds);

    return {
      playlist: selectPlaylistSummary(parsedId.data.id)!,
      tracks: selectPlaylistTracks(parsedId.data.id),
    };
  });

  // Export playlist as standard #EXTM3U (.m3u8) compatible with Navidrome, Symfonium, VLC
  app.get("/api/playlists/:id/export.m3u8", async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist ID" });
    }

    const playlist = selectPlaylistSummary(parsed.data.id);
    if (!playlist) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const tracks = selectPlaylistTracks(parsed.data.id);
    const lines = ["#EXTM3U", `#PLAYLIST:${playlist.name}`];
    for (const track of tracks) {
      const secs = track.durationSeconds ? Math.round(track.durationSeconds) : -1;
      lines.push(`#EXTINF:${secs},${track.artistName} - ${track.title}`);
      const relPath = path.relative(musicDir, track.filePath).split(path.sep).join("/");
      lines.push(relPath);
    }

    const safeFileName = playlist.name.replace(/[^a-zA-Z0-9._ -]/g, "_").trim() || "playlist";
    reply.header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${safeFileName}.m3u8"`);
    return reply.send(`${lines.join("\n")}\n`);
  });

  // Import an .m3u8 playlist, matching entries by relative path, filename, or #EXTINF Artist - Title
  app.post("/api/playlists/import", async (request, reply): Promise<ImportM3u8Response> => {
    const parsed = importM3u8BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Provide a playlist name and .m3u8 content." });
    }

    const allTracks = sqlite
      .prepare(
        `
        SELECT t.id, t.title, ar.name AS artistName, t.file_path AS filePath
        FROM tracks t
        JOIN artists ar ON ar.id = t.artist_id
      `,
      )
      .all() as Array<{ id: number; title: string; artistName: string; filePath: string }>;

    const byRelPath = new Map<string, number>();
    const byBasename = new Map<string, number>();
    const byArtistTitle = new Map<string, number>();

    for (const t of allTracks) {
      const rel = path.relative(musicDir, t.filePath).split(path.sep).join("/").toLowerCase();
      byRelPath.set(rel, t.id);
      byBasename.set(path.basename(t.filePath).toLowerCase(), t.id);
      byArtistTitle.set(normalizeMatch(`${t.artistName} ${t.title}`), t.id);
    }

    const rawLines = parsed.data.content.split(/\r?\n/);
    const matchedIds: number[] = [];
    const unmatchedEntries: string[] = [];
    let pendingExtinf: string | null = null;

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("#EXTINF:")) {
        const commaIdx = line.indexOf(",");
        pendingExtinf = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : null;
        continue;
      }
      if (line.startsWith("#")) continue;

      const normalizedLine = line.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
      const base = path.posix.basename(normalizedLine);

      let matchedId = byRelPath.get(normalizedLine) ?? byBasename.get(base);
      if (matchedId === undefined && pendingExtinf) {
        matchedId = byArtistTitle.get(normalizeMatch(pendingExtinf));
      }

      if (matchedId !== undefined) {
        matchedIds.push(matchedId);
      } else {
        unmatchedEntries.push(pendingExtinf || line);
      }
      pendingExtinf = null;
    }

    const now = Date.now();
    const res = sqlite
      .prepare(
        "INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(parsed.data.name, "Imported from M3U8", now, now);
    const playlistId = Number(res.lastInsertRowid);

    const insertStmt = sqlite.prepare(
      "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
    );
    const tx = sqlite.transaction((ids: number[]) => {
      ids.forEach((tid, idx) => insertStmt.run(playlistId, tid, idx, now));
    });
    tx(matchedIds);

    reply.code(201);
    return {
      playlist: selectPlaylistSummary(playlistId)!,
      matchedCount: matchedIds.length,
      unmatchedEntries: unmatchedEntries.slice(0, 50),
    };
  });
}
