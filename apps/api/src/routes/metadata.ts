import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TrackMetadataResponse } from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import { MAX_ARTIST_IMAGE_BYTES } from "../services/artistImages.js";
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
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
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
  const { dbContext, scanner } = deps;
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
}
