import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  LyricsBatchJobStatus,
  LyricsLibraryStatsResponse,
  TrackLyricsResponse,
} from "@musicorbit/shared";
import { getRequestUser } from "../services/authHelpers.js";
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
    const user = getRequestUser(request);
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid track ID" });
    }
    const parsedQuery = lyricsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    const res = await lyricsService.getTrackLyrics(parsedParams.data.id, {
      userId: user.id,
      refresh: parsedQuery.data.refresh,
    });
    if (!res) {
      return reply.code(404).send({ error: "Track not found" });
    }
    return res;
  });

  // Coverage stats + live batch fetch job progress for the authenticated user
  app.get("/api/system/lyrics/status", async (request): Promise<LyricsLibraryStatsResponse> => {
    const user = getRequestUser(request);
    return lyricsService.getStats(user.id);
  });

  // Start background batch fetch for tracks missing synced lyrics in this user's library
  app.post(
    "/api/system/lyrics/fetch-missing",
    async (request, reply): Promise<LyricsBatchJobStatus> => {
      const user = getRequestUser(request);
      const parsed = fetchMissingBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const status = lyricsService.startBatchFetch({
        userId: user.id,
        retryNotFound: parsed.data?.retryNotFound,
      });
      reply.code(status.state === "running" ? 202 : 200);
      return status;
    },
  );

  // Cancel an active background batch fetch for this user
  app.post("/api/system/lyrics/cancel", async (request): Promise<LyricsBatchJobStatus> => {
    const user = getRequestUser(request);
    return lyricsService.cancelBatchFetch(user.id);
  });
}
