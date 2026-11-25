import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ArtistImageCandidate, ArtistImageUpdateResponse } from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import {
  needsBrowserTranscode,
  type AudioTranscoder,
} from "../services/audioTranscoder.js";
import { getRequestUser } from "../services/authHelpers.js";
import {
  ArtistImageValidationError,
  MAX_ARTIST_IMAGE_BYTES,
  type ArtistImageService,
} from "../services/artistImages.js";

export interface MediaRouteDeps {
  dbContext: DbContext;
  coversDir: string;
  artistImagesDir: string;
  artistImageService: ArtistImageService;
  audioTranscoder?: AudioTranscoder;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const candidatesQuerySchema = z.object({
  q: z.string().trim().optional(),
});

const fromUrlBodySchema = z.object({
  imageUrl: z.string().url(),
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
  const { dbContext, coversDir, artistImagesDir, artistImageService, audioTranscoder } = deps;
  const { sqlite } = dbContext;

  // Accept raw image binary uploads up to 5 MB for PUT /api/artists/:id/image
  app.addContentTypeParser(
    ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"],
    { parseAs: "buffer", bodyLimit: MAX_ARTIST_IMAGE_BYTES },
    (_req, body, done) => {
      done(null, body);
    },
  );

  /**
   * Streams an audio track by ID with HTTP 206 Partial Content support so
   * browsers can scrub/seek cleanly without downloading the entire file first.
   * Automatically transcodes browser-unsupported codecs (e.g. ALAC .m4a) to
   * cached lossless FLAC so Chrome, Firefox, and Edge play them seamlessly.
   */
  app.get("/api/tracks/:id/stream", async (request, reply) => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }

    const row = sqlite
      .prepare("SELECT file_path AS filePath, codec FROM tracks WHERE id = ? AND user_id = ?")
      .get(parsed.data.id, user.id) as { filePath: string; codec: string | null } | undefined;

    if (!row) {
      return reply.code(404).send({ error: "Track not found" });
    }

    let streamPath = row.filePath;
    if (!fs.existsSync(streamPath)) {
      return reply.code(404).send({ error: "Audio file missing on disk" });
    }

    if (audioTranscoder && needsBrowserTranscode(row.codec, row.filePath)) {
      try {
        streamPath = await audioTranscoder.ensureBrowserPlayableFlac(row.filePath);
      } catch (err) {
        app.log.warn(
          { err, trackId: parsed.data.id, codec: row.codec },
          "Could not transcode track for browser playback; falling back to original file",
        );
      }
    }

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(streamPath);
    } catch {
      return reply.code(404).send({ error: "Audio file missing on disk" });
    }

    const fileSize = stat.size;
    const ext = path.extname(streamPath).toLowerCase();
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
      return reply.send(fs.createReadStream(streamPath, { start: range.start, end: range.end }));
    }

    reply.code(200);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", contentType);
    reply.header("Cache-Control", "private, max-age=3600");
    reply.header("Content-Length", fileSize);
    return reply.send(fs.createReadStream(streamPath));
  });

  /**
   * Serves cached album artwork from DATA_DIR/covers.
   */
  app.get("/api/albums/:id/cover", async (request, reply) => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid album ID" });
    }

    const row = sqlite
      .prepare("SELECT cover_hash AS coverHash FROM albums WHERE id = ? AND user_id = ?")
      .get(parsed.data.id, user.id) as { coverHash: string | null } | undefined;

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
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(fullPath));
  });

  /**
   * Serves cached artist portraits from DATA_DIR/artist-images, lazily fetching
   * them once on first request when FETCH_ARTIST_IMAGES=true.
   */
  app.get("/api/artists/:id/image", async (request, reply) => {
    const user = getRequestUser(request);
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid artist ID" });
    }

    const owned = sqlite
      .prepare("SELECT id FROM artists WHERE id = ? AND user_id = ?")
      .get(parsed.data.id, user.id) as { id: number } | undefined;
    if (!owned) {
      return reply.code(404).send({ error: "Artist not found" });
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
    reply.header("Cache-Control", "private, max-age=86400");
    return reply.send(fs.createReadStream(fullPath));
  });

  /**
   * Lists candidate artist portraits from Deezer so the user can manually pick
   * the right image (optionally overriding the search term with ?q=).
   */
  app.get(
    "/api/artists/:id/image/candidates",
    async (request, reply): Promise<ArtistImageCandidate[]> => {
      const user = getRequestUser(request);
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid artist ID" });
      }

      const row = sqlite
        .prepare("SELECT name FROM artists WHERE id = ? AND user_id = ?")
        .get(parsed.data.id, user.id) as { name: string } | undefined;

      if (!row) {
        return reply.code(404).send({ error: "Artist not found" });
      }

      const query = candidatesQuerySchema.parse(request.query);
      const searchTerm = query.q || row.name;
      return artistImageService.searchCandidates(searchTerm);
    },
  );

  /**
   * Uploads a custom artist portrait (raw image bytes with Content-Type: image/*).
   */
  app.put(
    "/api/artists/:id/image",
    async (request, reply): Promise<ArtistImageUpdateResponse> => {
      const user = getRequestUser(request);
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid artist ID" });
      }

      const exists = sqlite
        .prepare("SELECT id FROM artists WHERE id = ? AND user_id = ?")
        .get(parsed.data.id, user.id) as { id: number } | undefined;
      if (!exists) {
        return reply.code(404).send({ error: "Artist not found" });
      }

      const contentType = request.headers["content-type"] ?? "";
      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        return reply
          .code(400)
          .send({ error: "Expected raw image bytes with an image/* Content-Type." });
      }

      try {
        const imageHash = await artistImageService.saveUploadedImage(
          parsed.data.id,
          new Uint8Array(body),
          contentType,
        );
        return { artistId: parsed.data.id, imageHash };
      } catch (err) {
        if (err instanceof ArtistImageValidationError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  /**
   * Downloads and caches a user-chosen portrait from an allowlisted Deezer CDN URL.
   */
  app.post(
    "/api/artists/:id/image/from-url",
    async (request, reply): Promise<ArtistImageUpdateResponse> => {
      const user = getRequestUser(request);
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: "Invalid artist ID" });
      }

      const parsedBody = fromUrlBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: "A valid imageUrl is required." });
      }

      const exists = sqlite
        .prepare("SELECT id FROM artists WHERE id = ? AND user_id = ?")
        .get(parsedParams.data.id, user.id) as { id: number } | undefined;
      if (!exists) {
        return reply.code(404).send({ error: "Artist not found" });
      }

      try {
        const imageHash = await artistImageService.saveImageFromAllowedUrl(
          parsedParams.data.id,
          parsedBody.data.imageUrl,
        );
        return { artistId: parsedParams.data.id, imageHash };
      } catch (err) {
        if (err instanceof ArtistImageValidationError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  /**
   * Removes an artist's cached portrait so the UI falls back to album art / monogram.
   */
  app.delete(
    "/api/artists/:id/image",
    async (request, reply): Promise<ArtistImageUpdateResponse> => {
      const user = getRequestUser(request);
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid artist ID" });
      }

      const exists = sqlite
        .prepare("SELECT id FROM artists WHERE id = ? AND user_id = ?")
        .get(parsed.data.id, user.id) as { id: number } | undefined;
      if (!exists) {
        return reply.code(404).send({ error: "Artist not found" });
      }

      artistImageService.clearArtistImage(parsed.data.id);
      return { artistId: parsed.data.id, imageHash: null };
    },
  );
}
