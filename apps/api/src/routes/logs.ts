import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ActivityLogCategory,
  ActivityLogLevel,
  ActivityLogsResponse,
} from "@musicorbit/shared";
import type { ActivityLogService } from "../services/activityLog.js";

export interface LogRouteDeps {
  activityLog: ActivityLogService;
}

const listLogsQuerySchema = z.object({
  level: z.enum(["info", "success", "warn", "error"]).optional(),
  category: z
    .enum(["scanner", "importer", "watcher", "playlist", "metadata", "acquisition", "system"])
    .optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function registerLogRoutes(
  app: FastifyInstance,
  deps: LogRouteDeps,
): Promise<void> {
  const { activityLog } = deps;

  app.get("/api/system/logs", async (request): Promise<ActivityLogsResponse> => {
    const parsed = listLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return activityLog.list();
    }
    return activityLog.list({
      level: parsed.data.level as ActivityLogLevel | undefined,
      category: parsed.data.category as ActivityLogCategory | undefined,
      search: parsed.data.q,
      limit: parsed.data.limit,
    });
  });

  app.get("/api/system/logs/export", async (_request, reply) => {
    const text = activityLog.exportPlainText(2000);
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header("Content-Type", "text/plain; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="musicorbit-${stamp}.log"`);
    return reply.send(text);
  });

  app.delete("/api/system/logs", async (_request, reply) => {
    const cleared = activityLog.clear();
    return reply.code(200).send({ cleared });
  });
}
