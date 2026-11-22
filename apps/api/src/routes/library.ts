import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AlbumDetailResponse,
  AlbumSummary,
  ArtistDetailResponse,
  ArtistSummary,
  ScanStatusResponse,
  TrackSummary,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { LibraryScanner } from "../services/scanner.js";

export interface LibraryRouteDeps {
  dbContext: DbContext;
  scanner: LibraryScanner;
}

const triggerScanBodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional();

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  artistId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

interface ArtistRow {
  id: number;
  name: string;
  sortName: string;
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
  const { dbContext, scanner } = deps;
  const { sqlite } = dbContext;

  // Trigger an incremental (or forced full) library scan in the background
  app.post("/api/library/scan", async (request, reply): Promise<ScanStatusResponse> => {
    const parsed = triggerScanBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      throw new Error("Invalid scan options");
    }

    const result = scanner.startScan({ force: parsed.data?.force });
    reply.code(result.started ? 202 : 409);
    return result.status;
  });

  // Poll live scan progress or inspect the most recent scan job
  app.get("/api/library/scan/status", async (): Promise<ScanStatusResponse> => {
    return scanner.getStatus();
  });

  // List all artists with album & track counts
  app.get("/api/artists", async (request): Promise<ArtistSummary[]> => {
    const query = listQuerySchema.parse(request.query);
    const search = query.q ? `%${query.q.toLowerCase()}%` : null;

    const sql = `
      SELECT
        ar.id,
        ar.name,
        ar.sort_name AS sortName,
        (SELECT COUNT(*) FROM albums al WHERE al.artist_id = ar.id) AS albumCount,
        (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = ar.id) AS trackCount
      FROM artists ar
      ${search ? "WHERE lower(ar.name) LIKE ?" : ""}
      ORDER BY lower(ar.sort_name) ASC
    `;

    const stmt = sqlite.prepare(sql);
    const rows = (search ? stmt.all(search) : stmt.all()) as ArtistRow[];
    return rows;
  });

  // Artist detail + albums
  app.get("/api/artists/:id", async (request, reply): Promise<ArtistDetailResponse> => {
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
          (SELECT COUNT(*) FROM albums al WHERE al.artist_id = ar.id) AS albumCount,
          (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = ar.id) AS trackCount
        FROM artists ar
        WHERE ar.id = ?
      `,
      )
      .get(parsed.data.id) as ArtistRow | undefined;

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
        WHERE al.artist_id = ?
        GROUP BY al.id
        ORDER BY COALESCE(al.year, 9999) ASC, lower(al.title) ASC
      `,
      )
      .all(parsed.data.id) as AlbumRow[];

    return { artist, albums: artistAlbums };
  });

  // List albums with optional search (?q=) or artist filter (?artistId=)
  app.get("/api/albums", async (request): Promise<AlbumSummary[]> => {
    const query = listQuerySchema.parse(request.query);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.artistId !== undefined) {
      conditions.push("al.artist_id = ?");
      params.push(query.artistId);
    }
    if (query.q) {
      conditions.push("(lower(al.title) LIKE ? OR lower(ar.name) LIKE ?)");
      const like = `%${query.q.toLowerCase()}%`;
      params.push(like, like);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
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

  // Album detail + ordered tracks
  app.get("/api/albums/:id", async (request, reply): Promise<AlbumDetailResponse> => {
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
        WHERE al.id = ?
        GROUP BY al.id
      `,
      )
      .get(parsed.data.id) as AlbumRow | undefined;

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
        WHERE t.album_id = ?
        ORDER BY COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, lower(t.title) ASC
      `,
      )
      .all(parsed.data.id) as TrackRow[];

    return { album, tracks: albumTracks };
  });

  // List tracks with optional search (?q=) and limit (?limit=)
  app.get("/api/tracks", async (request): Promise<TrackSummary[]> => {
    const query = listQuerySchema.parse(request.query);
    const limit = query.limit ?? 100;
    const params: unknown[] = [];
    let whereClause = "";

    if (query.q) {
      whereClause =
        "WHERE lower(t.title) LIKE ? OR lower(al.title) LIKE ? OR lower(ar.name) LIKE ?";
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
}
