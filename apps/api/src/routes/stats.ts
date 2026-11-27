import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  HomeStatsResponse,
  RecapPeriodType,
  RecapResponse,
  RecordPlayResponse,
  SaveRecapPlaylistResponse,
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
}
