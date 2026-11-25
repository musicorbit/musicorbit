import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  FinalizeUploadBatchResponse,
  StartUploadBatchResponse,
  UploadFileResponse,
} from "@musicorbit/shared";
import type { ActivityLogService } from "../services/activityLog.js";
import { getRequestUser } from "../services/authHelpers.js";
import { ImporterError, type LibraryImporter } from "../services/importer.js";
import { sanitizeLayoutSegment } from "../services/libraryLayout.js";
import { SUPPORTED_AUDIO_EXTENSIONS } from "../services/scanner.js";

export const MAX_UPLOAD_FILE_BYTES = 500 * 1024 * 1024; // 500 MB per file (supports 24-bit/192kHz FLAC)

const ALLOWED_EXTRA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".lrc"]);
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ...SUPPORTED_AUDIO_EXTENSIONS,
  ...ALLOWED_EXTRA_EXTENSIONS,
]);

const batchIdParamSchema = z.object({
  batchId: z.string().regex(/^[a-f0-9-]{16,64}$/i, "Invalid upload batch ID"),
});

export interface UploadRouteDeps {
  dataDir: string;
  importer: LibraryImporter;
  activityLog?: ActivityLogService;
  maxFileBytes?: number;
}

/**
 * Normalizes and validates a client-provided relative upload path so traversal attempts
 * ("../", absolute paths, null bytes, unsupported extensions) are strictly rejected.
 */
export function sanitizeUploadRelativePath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, "/").trim();
  if (!normalized || normalized.includes("\0")) return null;

  const rawSegments = normalized.split("/").filter((s) => s.length > 0 && s !== ".");
  if (rawSegments.length === 0 || rawSegments.length > 6) return null;
  if (rawSegments.some((s) => s === "..")) return null;

  const lastRaw = rawSegments[rawSegments.length - 1]!;
  const ext = path.extname(lastRaw).toLowerCase();
  if (!ext || !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return null;
  }

  const baseName = sanitizeLayoutSegment(path.basename(lastRaw, ext), "track");
  const safeDirs = rawSegments
    .slice(0, -1)
    .map((dir) => sanitizeLayoutSegment(dir, "Album"))
    .filter(Boolean);

  return path.join(...safeDirs, `${baseName}${ext}`);
}

async function countFilesRecursive(dir: string): Promise<number> {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await countFilesRecursive(full);
    } else if (entry.isFile()) {
      total += 1;
    }
  }
  return total;
}

async function cleanupEmptyStagingDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) return;
  const remaining = await countFilesRecursive(dir);
  if (remaining === 0) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  deps: UploadRouteDeps,
): Promise<void> {
  const uploadsRoot = path.resolve(deps.dataDir, "uploads");
  const maxFileBytes = deps.maxFileBytes ?? MAX_UPLOAD_FILE_BYTES;
  const { importer, activityLog } = deps;

  const resolveBatchDir = (userId: number, batchId: string): string | null => {
    const userRoot = path.resolve(uploadsRoot, `user-${userId}`);
    const candidate = path.resolve(userRoot, batchId);
    if (!candidate.startsWith(`${userRoot}${path.sep}`)) return null;
    return candidate;
  };

  // Start a new per-user upload batch session under DATA_DIR/uploads/user-<id>/<batchId>
  app.post("/api/uploads/start", async (request): Promise<StartUploadBatchResponse> => {
    const user = getRequestUser(request);
    const batchId = crypto.randomUUID();
    const batchDir = path.join(uploadsRoot, `user-${user.id}`, batchId);
    await fsp.mkdir(batchDir, { recursive: true });
    return {
      batchId,
      maxFileBytes,
      allowedExtensions: Array.from(ALLOWED_UPLOAD_EXTENSIONS).sort(),
    };
  });

  // Stream a single uploaded file straight to disk without buffering into RAM
  await app.register(async (uploadScope) => {
    uploadScope.addContentTypeParser(
      "application/octet-stream",
      { bodyLimit: maxFileBytes + 1024 * 1024 },
      (_req, payload, done) => {
        done(null, payload);
      },
    );

    uploadScope.post(
      "/api/uploads/:batchId/file",
      { bodyLimit: maxFileBytes + 1024 * 1024 },
      async (request, reply): Promise<UploadFileResponse> => {
        const user = getRequestUser(request);
        const streamBody = request.body as Readable | undefined;
        const drainStream = async () => {
          if (streamBody && typeof streamBody[Symbol.asyncIterator] === "function") {
            try {
              for await (const _chunk of streamBody) {
                // Drain remaining bytes cleanly so HTTP response completes reliably
              }
            } catch {
              // Ignore stream read errors on abort
            }
          }
        };

        const parsedParams = batchIdParamSchema.safeParse(request.params);
        if (!parsedParams.success) {
          await drainStream();
          return reply.code(400).send({ error: "Invalid upload batch ID." });
        }

        const batchDir = resolveBatchDir(user.id, parsedParams.data.batchId);
        if (!batchDir || !fs.existsSync(batchDir)) {
          await drainStream();
          return reply.code(404).send({ error: "Upload session not found or already finalized." });
        }

        const contentLengthHeader = request.headers["content-length"];
        const declaredSize =
          typeof contentLengthHeader === "string"
            ? Number.parseInt(contentLengthHeader, 10)
            : Number.NaN;
        if (Number.isFinite(declaredSize) && declaredSize > maxFileBytes) {
          await drainStream();
          return reply.code(413).send({
            error: `File exceeds maximum upload size of ${Math.max(1, Math.round(maxFileBytes / (1024 * 1024)))} MB.`,
          });
        }

        const rawHeaderPath =
          (request.headers["x-upload-relative-path"] as string | undefined) ||
          (request.headers["x-upload-filename"] as string | undefined) ||
          "";

        let decodedPath = rawHeaderPath;
        try {
          decodedPath = decodeURIComponent(rawHeaderPath);
        } catch {
          decodedPath = rawHeaderPath;
        }

        const safeRel = sanitizeUploadRelativePath(decodedPath);
        if (!safeRel) {
          await drainStream();
          return reply.code(400).send({
            error:
              "Unsupported file type or invalid filename. Upload FLAC, MP3, M4A, AAC, OGG, Opus, WAV, cover art, or .lrc files.",
          });
        }

        const destPath = path.resolve(batchDir, safeRel);
        if (!destPath.startsWith(`${batchDir}${path.sep}`)) {
          await drainStream();
          return reply.code(400).send({ error: "Invalid upload path." });
        }

        await fsp.mkdir(path.dirname(destPath), { recursive: true });

        if (!streamBody || typeof streamBody[Symbol.asyncIterator] !== "function") {
          return reply.code(400).send({
            error: "Expected application/octet-stream file upload body.",
          });
        }

        let writtenBytes = 0;
        let limitExceeded = false;
        const fileHandle = await fsp.open(destPath, "w");
        try {
          for await (const rawChunk of streamBody) {
            const buf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
            writtenBytes += buf.length;
            if (writtenBytes > maxFileBytes) {
              limitExceeded = true;
              continue;
            }
            await fileHandle.write(buf);
          }
        } catch (err) {
          await fileHandle.close().catch(() => {});
          await fsp.unlink(destPath).catch(() => {});
          return reply.code(400).send({
            error: err instanceof Error ? err.message : "Upload stream failed.",
          });
        } finally {
          await fileHandle.close().catch(() => {});
        }

        if (limitExceeded) {
          await fsp.unlink(destPath).catch(() => {});
          return reply.code(413).send({
            error: `File exceeds maximum upload size of ${Math.max(1, Math.round(maxFileBytes / (1024 * 1024)))} MB.`,
          });
        }

        if (writtenBytes === 0) {
          await fsp.unlink(destPath).catch(() => {});
          return reply.code(400).send({ error: "Uploaded file is empty." });
        }

        return {
          batchId: parsedParams.data.batchId,
          relativePath: safeRel.split(path.sep).join("/"),
          sizeBytes: writtenBytes,
        };
      },
    );
  });

  // Finalize an upload batch: run MusicOrbit's post-processing, tagging, layout, lyrics & Review Queue pipeline
  app.post(
    "/api/uploads/:batchId/finalize",
    async (request, reply): Promise<FinalizeUploadBatchResponse> => {
      const user = getRequestUser(request);
      const parsedParams = batchIdParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: "Invalid upload batch ID." });
      }

      const batchDir = resolveBatchDir(user.id, parsedParams.data.batchId);
      if (!batchDir || !fs.existsSync(batchDir)) {
        return reply.code(404).send({ error: "Upload session not found." });
      }

      const uploadedFiles = await countFilesRecursive(batchDir);
      if (uploadedFiles === 0) {
        await fsp.rm(batchDir, { recursive: true, force: true }).catch(() => {});
        return reply.code(400).send({ error: "No files were uploaded in this batch." });
      }

      try {
        activityLog?.info(
          "importer",
          `Processing browser upload for @${user.username} (${uploadedFiles} ${uploadedFiles === 1 ? "file" : "files"})`,
          { userId: user.id, batchId: parsedParams.data.batchId, uploadedFiles },
        );

        const result = await importer.importExternalFolder(batchDir, "move", user.id);
        // Clean up batch folder if everything moved into MUSIC_DIR (keeps files if any await Review Queue)
        await cleanupEmptyStagingDir(batchDir);

        return {
          batchId: parsedParams.data.batchId,
          uploadedFiles,
          discoveredFolders: result.discoveredFolders,
          autoImported: result.autoImported,
          needsReview: result.needsReview,
          skipped: result.skipped,
          failed: result.failed,
        };
      } catch (err) {
        if (err instanceof ImporterError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // Cancel and delete an incomplete upload batch cleanly
  app.delete("/api/uploads/:batchId", async (request, reply) => {
    const user = getRequestUser(request);
    const parsedParams = batchIdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid upload batch ID." });
    }
    const batchDir = resolveBatchDir(user.id, parsedParams.data.batchId);
    if (batchDir && fs.existsSync(batchDir)) {
      await fsp.rm(batchDir, { recursive: true, force: true }).catch(() => {});
    }
    return { deleted: true };
  });
}
