import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  HistoryImportResponse,
  HomeStatsResponse,
  RecapPeriodType,
  RecapResponse,
  RecordPlayResponse,
  SaveRecapPlaylistResponse,
  SpotifyHistoryImportResponse,
  StatsRange,
} from "@musicorbit/shared";
import { getRequestUser } from "../services/authHelpers.js";
import type { ListeningStatsService } from "../services/listeningStats.js";

export interface StatsRouteDeps {
  listeningStats: ListeningStatsService;
}

const recordPlayBodySchema = z.object({
  trackId: z.coerce.number().int().positive(),
  clientName: z.string().trim().max(64).optional(),
  playedAt: z.coerce.number().int().positive().optional(),
});

const homeStatsQuerySchema = z.object({
  range: z.enum(["7d", "30d", "year", "all"]).optional().default("30d"),
});

const recapQuerySchema = z.object({
  type: z.enum(["month", "year"]).optional().default("month"),
  period: z.string().trim().max(16).optional(),
});

const saveRecapPlaylistBodySchema = z.object({
  type: z.enum(["month", "year"]),
  period: z.string().trim().min(4).max(16),
});

export async function registerStatsRoutes(
  app: FastifyInstance,
  deps: StatsRouteDeps,
): Promise<void> {
  const { listeningStats } = deps;

  app.post("/api/plays", async (request, reply): Promise<RecordPlayResponse> => {
    const user = getRequestUser(request);
    const parsed = recordPlayBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track play payload" } as never);
    }

    return listeningStats.recordPlay({
      userId: user.id,
      trackId: parsed.data.trackId,
      clientName: parsed.data.clientName ?? "MusicOrbit Web",
      source: "web",
      playedAt: parsed.data.playedAt,
    });
  });

  app.get("/api/stats/home", async (request): Promise<HomeStatsResponse> => {
    const user = getRequestUser(request);
    const parsed = homeStatsQuerySchema.safeParse(request.query);
    const range: StatsRange = parsed.success ? parsed.data.range : "30d";
    return listeningStats.getHomeStats(user.id, range);
  });

  app.get("/api/stats/recap", async (request): Promise<RecapResponse> => {
    const user = getRequestUser(request);
    const parsed = recapQuerySchema.safeParse(request.query);
    const type: RecapPeriodType = parsed.success ? parsed.data.type : "month";
    const period = parsed.success ? parsed.data.period : undefined;
    return listeningStats.getRecap(user.id, type, period);
  });

  app.post(
    "/api/stats/recap/playlist",
    async (request, reply): Promise<SaveRecapPlaylistResponse> => {
      const user = getRequestUser(request);
      const parsed = saveRecapPlaylistBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid recap playlist request" } as never);
      }

      const result = listeningStats.saveRecapAsPlaylist(
        user.id,
        parsed.data.type,
        parsed.data.period,
      );
      return reply.code(201).send(result);
    },
  );

  // Unified listening history import (Spotify JSON, Apple Music CSV, Last.fm CSV/JSON, ListenBrainz JSON/JSONL)
  app.post(
    "/api/stats/import",
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply): Promise<HistoryImportResponse> => {
      const user = getRequestUser(request);
      const body = request.body as unknown;
      if (!body || typeof body !== "object" || typeof (body as { content?: unknown }).content !== "string") {
        return reply.code(400).send({
          error:
            "Expected a listening history file payload (Spotify JSON, Apple Music CSV, Last.fm CSV/JSON, or ListenBrainz JSON/JSONL).",
        } as never);
      }

      const payload = body as { content: string; filename?: unknown; minSeconds?: unknown };
      const filename = typeof payload.filename === "string" ? payload.filename : undefined;
      const minSeconds =
        typeof payload.minSeconds === "number" && Number.isFinite(payload.minSeconds)
          ? payload.minSeconds
          : undefined;

      return listeningStats.importListeningHistory(user.id, payload.content, {
        filename,
        minSeconds,
      });
    },
  );

  app.delete("/api/stats/import", async (request): Promise<{ deletedCount: number }> => {
    const user = getRequestUser(request);
    return listeningStats.clearImportedHistory(user.id);
  });

  // Backwards-compatible Spotify JSON endpoint
  app.post(
    "/api/stats/import/spotify",
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply): Promise<SpotifyHistoryImportResponse> => {
      const user = getRequestUser(request);
      const body = request.body as unknown;

      let entries: unknown[];
      let minSeconds: number | undefined;
      if (Array.isArray(body)) {
        entries = body;
      } else if (body && typeof body === "object" && Array.isArray((body as { entries?: unknown }).entries)) {
        entries = (body as { entries: unknown[] }).entries;
        const rawMin = (body as { minSeconds?: unknown }).minSeconds;
        if (typeof rawMin === "number" && Number.isFinite(rawMin)) {
          minSeconds = rawMin;
        }
      } else {
        return reply.code(400).send({
          error:
            "Expected a Spotify JSON array (e.g. StreamingHistory_music_0.json or Streaming_History_Audio_*.json).",
        } as never);
      }

      return listeningStats.importSpotifyHistory(user.id, entries, { minSeconds });
    },
  );

  app.delete("/api/stats/import/spotify", async (request): Promise<{ deletedCount: number }> => {
    const user = getRequestUser(request);
    return listeningStats.clearImportedHistory(user.id);
  });
}
