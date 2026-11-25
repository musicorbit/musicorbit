import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type {
  ApplyImportResponse,
  BulkImportFolderResponse,
  ImportItemStatus,
  ImportsListResponse,
  InboxScanResult,
  MusicBrainzReleaseCandidate,
  MusicBrainzReleaseDetail,
  RetagAlbumResponse,
  TrackMetadataSuggestion,
} from "@musicorbit/shared";
import { ImporterError, type LibraryImporter } from "../services/importer.js";
import type { MetadataLookupService } from "../services/metadataLookup.js";
import type { MusicBrainzClient } from "../services/musicbrainz.js";

export interface ImportRouteDeps {
  importer: LibraryImporter;
  musicBrainz: MusicBrainzClient;
  metadataLookup?: MetadataLookupService;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const mbidParamSchema = z.object({
  mbid: z.string().trim().min(8).max(64),
});

const listImportsQuerySchema = z.object({
  status: z.enum(["needs_review", "imported", "failed", "dismissed"]).optional(),
});

const mbSearchQuerySchema = z.object({
  artist: z.string().trim().optional(),
  album: z.string().trim().optional(),
  trackCount: z.coerce.number().int().positive().optional(),
});

const trackLookupQuerySchema = z.object({
  provider: z.enum(["deezer", "musicbrainz"]).default("deezer"),
  title: z.string().trim().optional(),
  artist: z.string().trim().optional(),
  album: z.string().trim().optional(),
});

const applyTaggingBodySchema = z.object({
  artist: z.string().trim().min(1),
  album: z.string().trim().min(1),
  year: z.number().int().min(1800).max(2200).nullable(),
  genre: z.string().trim().nullable().optional(),
  mbid: z.string().trim().nullable().optional(),
  artistMbid: z.string().trim().nullable().optional(),
  coverArtUrl: z.string().trim().nullable().optional(),
  duplicateResolution: z.enum(["policy", "replace", "keep_both", "skip"]).optional(),
  tracks: z
    .array(
      z.object({
        filePath: z.string().min(1),
        title: z.string().trim().min(1),
        artist: z.string().trim().optional(),
        trackNumber: z.number().int().positive().nullable(),
        discNumber: z.number().int().positive().nullable(),
        recordingMbid: z.string().trim().nullable().optional(),
      }),
    )
    .min(1),
});

const bulkImportBodySchema = z.object({
  sourceDir: z.string().trim().min(1).max(1000),
  fileAction: z.enum(["copy", "move"]).default("copy"),
});

function handleImporterError(reply: FastifyReply, err: unknown) {
  if (err instanceof ImporterError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  throw err;
}

export async function registerImportRoutes(
  app: FastifyInstance,
  deps: ImportRouteDeps,
): Promise<void> {
  const { importer, musicBrainz, metadataLookup } = deps;

  // Lookup individual track suggestions (Deezer / MusicBrainz) for Review Queue items
  app.get(
    "/api/imports/lookup-track",
    async (request, reply): Promise<TrackMetadataSuggestion[]> => {
      if (!metadataLookup) {
        return reply.code(503).send({ error: "Track metadata lookup is unavailable." });
      }
      const parsed = trackLookupQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid lookup parameters." });
      }
      if (!parsed.data.title && !parsed.data.artist) {
        return reply.code(400).send({ error: "Provide at least a title or artist." });
      }
      try {
        return await metadataLookup.lookup({
          provider: parsed.data.provider,
          title: parsed.data.title,
          artist: parsed.data.artist,
          album: parsed.data.album,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Track lookup failed";
        return reply.code(502).send({ error: msg });
      }
    },
  );

  // List Review Queue & import history
  app.get("/api/imports", async (request): Promise<ImportsListResponse> => {
    const query = listImportsQuerySchema.parse(request.query);
    return importer.listItems(query.status as ImportItemStatus | undefined);
  });

  // Scan DOWNLOADS_DIR for completed downloads, auto-import confident matches, queue the rest
  app.post("/api/imports/scan", async (): Promise<InboxScanResult> => {
    return importer.scanInbox();
  });

  // One-off bulk import from an external folder into MUSIC_DIR using the post-processing pipeline
  app.post(
    "/api/imports/bulk-folder",
    async (request, reply): Promise<BulkImportFolderResponse> => {
      const parsed = bulkImportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Please provide a valid source folder path." });
      }
      try {
        return await importer.importExternalFolder(parsed.data.sourceDir, parsed.data.fileAction);
      } catch (err) {
        return handleImporterError(reply, err);
      }
    },
  );

  // Apply chosen MusicBrainz release or manual tags to a Review Queue item & move to library
  app.post(
    "/api/imports/:id/apply",
    async (request, reply): Promise<ApplyImportResponse> => {
      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid import ID" });
      }
      const parsedBody = applyTaggingBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({
          error: "Invalid tagging payload",
          details: parsedBody.error.flatten().fieldErrors,
        });
      }
      try {
        return await importer.applyImport(parsedId.data.id, parsedBody.data);
      } catch (err) {
        return handleImporterError(reply, err);
      }
    },
  );

  // Dismiss an inbox review item without deleting files on disk
  app.post("/api/imports/:id/dismiss", async (request, reply) => {
    const parsedId = idParamSchema.safeParse(request.params);
    if (!parsedId.success) {
      return reply.code(400).send({ error: "Invalid import ID" });
    }
    try {
      importer.dismissImport(parsedId.data.id);
      return reply.code(200).send({ id: parsedId.data.id, status: "dismissed" });
    } catch (err) {
      return handleImporterError(reply, err);
    }
  });

  // Search MusicBrainz releases (used by both Review Queue & "Fix Tags" on existing albums)
  app.get(
    "/api/musicbrainz/search",
    async (request, reply): Promise<MusicBrainzReleaseCandidate[]> => {
      const query = mbSearchQuerySchema.parse(request.query);
      if (!query.artist && !query.album) {
        return reply.code(400).send({ error: "Provide at least an artist or album query." });
      }
      try {
        return await musicBrainz.searchReleases(query);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "MusicBrainz search failed";
        return reply.code(502).send({ error: msg });
      }
    },
  );

  // Fetch full MusicBrainz release tracklist
  app.get(
    "/api/musicbrainz/releases/:mbid",
    async (request, reply): Promise<MusicBrainzReleaseDetail> => {
      const parsed = mbidParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid MusicBrainz release ID" });
      }
      try {
        return await musicBrainz.getReleaseDetail(parsed.data.mbid);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "MusicBrainz lookup failed";
        return reply.code(502).send({ error: msg });
      }
    },
  );

  // "Fix This Album" — retag an already-imported library album in place and re-index
  app.post(
    "/api/albums/:id/retag",
    async (request, reply): Promise<RetagAlbumResponse> => {
      const parsedId = idParamSchema.safeParse(request.params);
      if (!parsedId.success) {
        return reply.code(400).send({ error: "Invalid album ID" });
      }
      const parsedBody = applyTaggingBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({
          error: "Invalid tagging payload",
          details: parsedBody.error.flatten().fieldErrors,
        });
      }
      try {
        return await importer.retagExistingAlbum(parsedId.data.id, parsedBody.data);
      } catch (err) {
        return handleImporterError(reply, err);
      }
    },
  );
}
