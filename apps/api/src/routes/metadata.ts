import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TrackMetadataResponse, TrackMetadataSuggestion } from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import { MAX_ARTIST_IMAGE_BYTES } from "../services/artistImages.js";
import {
  isAllowedCoverArtUrl,
  type MetadataLookupService,
} from "../services/metadataLookup.js";
import type { LibraryScanner } from "../services/scanner.js";
import {
  clearEmbeddedCover,
  readFullTrackMetadata,
  writeEmbeddedCover,
  writeFullTrackMetadata,
} from "../services/tagWriter.js";

export interface MetadataRouteDeps {
  dbContext: DbContext;
  scanner: LibraryScanner;
  metadataLookup: MetadataLookupService;
  fetchImpl?: typeof fetch;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const lookupQuerySchema = z.object({
  provider: z.enum(["deezer", "musicbrainz", "lrclib"]).default("deezer"),
  title: z.string().trim().optional(),
  artist: z.string().trim().optional(),
  album: z.string().trim().optional(),
});

const coverFromUrlBodySchema = z.object({
  imageUrl: z.string().url(),
});

const nullablePosInt = z.number().int().positive().nullable();

const updateMetadataBodySchema = z.object({
  title: z.string().trim().min(1),
  artists: z.string(),
  albumArtist: z.string(),
  album: z.string(),
  trackNumber: nullablePosInt,
  trackTotal: nullablePosInt,
  discNumber: nullablePosInt,
  discTotal: nullablePosInt,
  year: z.number().int().min(1800).max(2200).nullable(),
  genres: z.string(),
  composers: z.string(),
  bpm: z.number().int().min(1).max(999).nullable(),
  grouping: z.string(),
  publisher: z.string(),
  comment: z.string(),
  lyrics: z.string(),
  musicBrainzTrackId: z.string(),
  musicBrainzReleaseId: z.string(),
  musicBrainzArtistId: z.string(),
  musicBrainzReleaseArtistId: z.string(),
});

const ALLOWED_COVER_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function registerMetadataRoutes(
  app: FastifyInstance,
  deps: MetadataRouteDeps,
): Promise<void> {
  const { dbContext, scanner, metadataLookup } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { sqlite } = dbContext;

  const lookupTrack = (id: number) =>
    sqlite
      .prepare("SELECT id, album_id AS albumId, file_path AS filePath FROM tracks WHERE id = ?")
      .get(id) as { id: number; albumId: number; filePath: string } | undefined;

  // Read every embedded tag + technical audio property directly from the file on disk
  app.get("/api/tracks/:id/metadata", async (request, reply): Promise<TrackMetadataResponse> => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }

    const row = lookupTrack(parsed.data.id);
    if (!row) {
      return reply.code(404).send({ error: "Track not found" });
    }
    if (!fs.existsSync(row.filePath)) {
      return reply.code(404).send({ error: "Audio file missing on disk" });
    }

    return readFullTrackMetadata(row.id, row.albumId, row.filePath);
  });

  // Update embedded audio metadata in place and re-index SQLite immediately
  app.put("/api/tracks/:id/metadata", async (request, reply): Promise<TrackMetadataResponse> => {
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }

    const parsedBody = updateMetadataBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "Invalid metadata fields",
        details: parsedBody.error.flatten().fieldErrors,
      });
    }

    const row = lookupTrack(parsedId.data.id);
    if (!row) {
      return reply.code(404).send({ error: "Track not found" });
    }
    if (!fs.existsSync(row.filePath)) {
      return reply.code(404).send({ error: "Audio file missing on disk" });
    }

    writeFullTrackMetadata(row.filePath, parsedBody.data);

    // Re-scan so SQLite picks up updated artist, album, title, year, genre, track numbers
    await scanner.runScan({ force: true });

    const refreshed = lookupTrack(row.id);
    return readFullTrackMetadata(row.id, refreshed?.albumId ?? row.albumId, row.filePath);
  });

  // Embed custom cover art directly inside the audio file
  app.put("/api/tracks/:id/cover", async (request, reply): Promise<TrackMetadataResponse> => {
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }

    const row = lookupTrack(parsedId.data.id);
    if (!row) {
      return reply.code(404).send({ error: "Track not found" });
    }
    if (!fs.existsSync(row.filePath)) {
      return reply.code(404).send({ error: "Audio file missing on disk" });
    }

    const rawMime = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_COVER_MIMES.has(rawMime)) {
      return reply.code(400).send({
        error: "Unsupported image format. Please upload a JPEG, PNG, WebP, or GIF image.",
      });
    }

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_ARTIST_IMAGE_BYTES) {
      return reply.code(400).send({ error: "Image must be non-empty and 5 MB or smaller." });
    }

    writeEmbeddedCover(row.filePath, new Uint8Array(body), rawMime);
    await scanner.runScan({ force: true });

    const refreshed = lookupTrack(row.id);
    return readFullTrackMetadata(row.id, refreshed?.albumId ?? row.albumId, row.filePath);
  });

  // Remove embedded cover art from the audio file
  app.delete("/api/tracks/:id/cover", async (request, reply): Promise<TrackMetadataResponse> => {
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }

    const row = lookupTrack(parsedId.data.id);
    if (!row) {
      return reply.code(404).send({ error: "Track not found" });
    }
    if (!fs.existsSync(row.filePath)) {
      return reply.code(404).send({ error: "Audio file missing on disk" });
    }

    clearEmbeddedCover(row.filePath);
    await scanner.runScan({ force: true });

    const refreshed = lookupTrack(row.id);
    return readFullTrackMetadata(row.id, refreshed?.albumId ?? row.albumId, row.filePath);
  });

  // Fetch suggested metadata from Deezer, MusicBrainz, or LRCLIB for selective field-by-field diffing
  app.get(
    "/api/tracks/:id/metadata/lookup",
    async (request, reply): Promise<TrackMetadataSuggestion[]> => {
      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid track ID" });
      }

      const row = lookupTrack(parsedId.data.id);
      if (!row) {
        return reply.code(404).send({ error: "Track not found" });
      }

      const query = lookupQuerySchema.parse(request.query);
      let title = query.title;
      let artist = query.artist;
      let album = query.album;

      if (!title && !artist && fs.existsSync(row.filePath)) {
        const current = await readFullTrackMetadata(row.id, row.albumId, row.filePath);
        title = current.tags.title;
        artist = current.tags.artists || current.tags.albumArtist;
        album = current.tags.album;
      }

      try {
        return await metadataLookup.lookup({
          provider: query.provider,
          title,
          artist,
          album,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Metadata lookup failed";
        return reply.code(502).send({ error: msg });
      }
    },
  );

  // Download cover art from an allowlisted CDN (Deezer / Cover Art Archive) and embed into the file
  app.post(
    "/api/tracks/:id/cover/from-url",
    async (request, reply): Promise<TrackMetadataResponse> => {
      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid track ID" });
      }

      const parsedBody = coverFromUrlBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: "A valid imageUrl is required." });
      }

      if (!isAllowedCoverArtUrl(parsedBody.data.imageUrl)) {
        return reply.code(400).send({
          error: "Cover URL must be an HTTPS Deezer or Cover Art Archive URL.",
        });
      }

      const row = lookupTrack(parsedId.data.id);
      if (!row) {
        return reply.code(404).send({ error: "Track not found" });
      }
      if (!fs.existsSync(row.filePath)) {
        return reply.code(404).send({ error: "Audio file missing on disk" });
      }

      const imgRes = await fetchImpl(parsedBody.data.imageUrl, {
        signal: AbortSignal.timeout(8000),
      });
      if (!imgRes.ok) {
        return reply.code(502).send({ error: `Failed to download cover (HTTP ${imgRes.status})` });
      }

      const mime = (imgRes.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!ALLOWED_COVER_MIMES.has(mime)) {
        return reply.code(400).send({ error: "Remote URL did not return a supported image." });
      }

      const bytes = new Uint8Array(await imgRes.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARTIST_IMAGE_BYTES) {
        return reply.code(400).send({ error: "Cover art must be non-empty and 5 MB or smaller." });
      }

      writeEmbeddedCover(row.filePath, bytes, mime);
      await scanner.runScan({ force: true });

      const refreshed = lookupTrack(row.id);
      return readFullTrackMetadata(row.id, refreshed?.albumId ?? row.albumId, row.filePath);
    },
  );
}
