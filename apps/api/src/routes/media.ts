import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbContext } from "../db/index.js";
import type { ArtistImageService } from "../services/artistImages.js";

export interface MediaRouteDeps {
  dbContext: DbContext;
  coversDir: string;
  artistImagesDir: string;
  artistImageService: ArtistImageService;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const AUDIO_MIME_TYPES: Record<string, string> = {
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  // Ogg-encapsulated .opus streams play reliably in browsers with audio/ogg
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a standard HTTP Range header such as:
 *   "bytes=0-1023"  -> { start: 0, end: 1023 }
 *   "bytes=1024-"   -> { start: 1024, end: fileSize - 1 }
 *   "bytes=-500"    -> last 500 bytes
 *
 * Returns null if the requested range is invalid or outside [0, fileSize - 1].
 */
function parseByteRange(rangeHeader: string, fileSize: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;

  if (!rawStart && rawEnd) {
    // Suffix byte range: last N bytes
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(rawStart!, 10);
    end = rawEnd ? Number.parseInt(rawEnd, 10) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    end = Math.min(end, fileSize - 1);
  }

  if (start < 0 || start >= fileSize || end < start) {
    return null;
  }

  return { start, end };
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  deps: MediaRouteDeps,
): Promise<void> {
  const { dbContext, coversDir, artistImagesDir, artistImageService } = deps;
  const { sqlite } = dbContext;

  /**
   * Streams an audio track by ID with HTTP 206 Partial Content support so
   * browsers can scrub/seek cleanly without downloading the entire file first.
   */
  app.get("/api/tracks/:id/stream", async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }

    const row = sqlite
      .prepare("SELECT file_path AS filePath FROM tracks WHERE id = ?")
      .get(parsed.data.id) as { filePath: string } | undefined;

    if (!row) {
      return reply.code(404).send({ error: "Track not found" });
    }

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(row.filePath);
    } catch {
      return reply.code(404).send({ error: "Audio file missing on disk" });
    }

    const fileSize = stat.size;
    const ext = path.extname(row.filePath).toLowerCase();
    const contentType = AUDIO_MIME_TYPES[ext] ?? "application/octet-stream";

    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, fileSize);
      if (!range) {
        reply.header("Content-Range", `bytes */${fileSize}`);
        return reply.code(416).send({ error: "Range Not Satisfiable" });
      }

      const chunkSize = range.end - range.start + 1;
      reply.code(206);
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "private, max-age=3600");
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${fileSize}`);
      reply.header("Content-Length", chunkSize);
      return reply.send(fs.createReadStream(row.filePath, { start: range.start, end: range.end }));
    }

    reply.code(200);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", contentType);
    reply.header("Cache-Control", "private, max-age=3600");
    reply.header("Content-Length", fileSize);
    return reply.send(fs.createReadStream(row.filePath));
  });

  /**
   * Serves cached album artwork from DATA_DIR/covers.
   * Cover filenames are content-addressed SHA-256 hashes, so long-lived immutable
   * browser caching is safe and makes scrolling large grids instant.
   */
  app.get("/api/albums/:id/cover", async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid album ID" });
    }

    const row = sqlite
      .prepare("SELECT cover_hash AS coverHash FROM albums WHERE id = ?")
      .get(parsed.data.id) as { coverHash: string | null } | undefined;

    if (!row || !row.coverHash) {
      return reply.code(404).send({ error: "Album cover not found" });
    }

    // Defensive path.basename ensures no directory traversal is possible
    const safeName = path.basename(row.coverHash);
    const fullPath = path.join(coversDir, safeName);

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      return reply.code(404).send({ error: "Cached cover file missing" });
    }

    const ext = path.extname(safeName).toLowerCase();
    const contentType = IMAGE_MIME_TYPES[ext] ?? "image/jpeg";

    reply.header("Content-Type", contentType);
    reply.header("Content-Length", stat.size);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(fullPath));
  });

  /**
   * Serves cached artist portraits from DATA_DIR/artist-images, lazily fetching
   * them once on first request when FETCH_ARTIST_IMAGES=true.
   */
  app.get("/api/artists/:id/image", async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid artist ID" });
    }

    const fileName = await artistImageService.resolveArtistImage(parsed.data.id);
    if (!fileName) {
      return reply.code(404).send({ error: "Artist portrait not found" });
    }

    const safeName = path.basename(fileName);
    const fullPath = path.join(artistImagesDir, safeName);

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      return reply.code(404).send({ error: "Cached artist portrait missing" });
    }

    const ext = path.extname(safeName).toLowerCase();
    const contentType = IMAGE_MIME_TYPES[ext] ?? "image/jpeg";

    reply.header("Content-Type", contentType);
    reply.header("Content-Length", stat.size);
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(fs.createReadStream(fullPath));
  });
}
