import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  LyricsBatchJobStatus,
  LyricsLibraryStatsResponse,
  TrackLyricsResponse,
} from "@musicorbit/shared";
import type { LyricsService } from "../services/lyrics.js";

export interface LyricsRouteDeps {
  lyricsService: LyricsService;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const lyricsQuerySchema = z.object({
  refresh: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
});

const fetchMissingBodySchema = z
  .object({
    retryNotFound: z.boolean().optional(),
  })
  .optional();

export async function registerLyricsRoutes(
  app: FastifyInstance,
  deps: LyricsRouteDeps,
): Promise<void> {
  const { lyricsService } = deps;

  // Fetch (or return cached / sidecar / embedded) synced + plain lyrics for a track
  app.get("/api/tracks/:id/lyrics", async (request, reply): Promise<TrackLyricsResponse> => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }
    const parsedQuery = lyricsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    const res = await lyricsService.getTrackLyrics(parsedParams.data.id, {
      refresh: parsedQuery.data.refresh,
    });
    if (!res) {
      return reply.code(404).send({ error: "Track not found" });
    }
    return res;
  });

  // Coverage stats + live batch fetch job progress
  app.get("/api/system/lyrics/status", async (): Promise<LyricsLibraryStatsResponse> => {
    return lyricsService.getStats();
  });

  // Start background batch fetch for tracks missing synced lyrics
  app.post(
    "/api/system/lyrics/fetch-missing",
    async (request, reply): Promise<LyricsBatchJobStatus> => {
      const parsed = fetchMissingBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const status = lyricsService.startBatchFetch({
        retryNotFound: parsed.data?.retryNotFound,
      });
      reply.code(status.state === "running" ? 202 : 200);
      return status;
    },
  );

  // Cancel an active background batch fetch
  app.post("/api/system/lyrics/cancel", async (): Promise<LyricsBatchJobStatus> => {
    return lyricsService.cancelBatchFetch();
  });
}
