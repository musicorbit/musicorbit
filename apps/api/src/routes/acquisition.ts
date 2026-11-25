import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type {
  AcquisitionStatusResponse,
  DownloadsListResponse,
  SoulseekSearchResultsResponse,
  SoulseekSearchSummary,
} from "@musicorbit/shared";
import { SlskdError, type SlskdClient } from "../services/acquisition/slskd.js";
import { requireAdmin, requireSoulseekAccess } from "../services/authHelpers.js";

export interface AcquisitionRouteDeps {
  slskdClient: SlskdClient;
  onDownloadEnqueued?: (
    userId: number,
    slskdUsername: string,
    files: Array<{ filename: string; size?: number }>,
  ) => void;
  userOwnsSlskdFile?: (
    userId: number,
    slskdUsername: string,
    remoteFilename: string,
  ) => boolean;
}

const startSearchBodySchema = z.object({
  query: z.string().trim().min(1).max(200),
});

const searchIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const enqueueBodySchema = z.object({
  username: z.string().trim().min(1).max(200),
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        size: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(200),
});

const removeDownloadParamSchema = z.object({
  username: z.string().min(1),
  id: z.string().min(1),
});

function handleSlskdError(reply: FastifyReply, err: unknown) {
  if (err instanceof SlskdError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  throw err;
}

export async function registerAcquisitionRoutes(
  app: FastifyInstance,
  deps: AcquisitionRouteDeps,
): Promise<void> {
  const { slskdClient, onDownloadEnqueued, userOwnsSlskdFile } = deps;

  // Report whether slskd is configured and reachable (never exposes API keys)
  app.get("/api/acquisition/status", async (): Promise<AcquisitionStatusResponse> => {
    return slskdClient.getStatus();
  });

  // Start a new Soulseek search via slskd (requires Soulseek permission)
  app.post(
    "/api/acquisition/search",
    async (request, reply): Promise<SoulseekSearchSummary> => {
      if (!requireSoulseekAccess(request, reply)) return reply as never;
      const parsed = startSearchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Please provide a search query." });
      }
      try {
        const result = await slskdClient.startSearch(parsed.data.query);
        reply.code(201);
        return result;
      } catch (err) {
        return handleSlskdError(reply, err);
      }
    },
  );

  // Poll search state and return grouped, FLAC-prioritized release folders
  app.get(
    "/api/acquisition/search/:id",
    async (request, reply): Promise<SoulseekSearchResultsResponse> => {
      if (!requireSoulseekAccess(request, reply)) return reply as never;
      const parsed = searchIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid search ID." });
      }
      try {
        return await slskdClient.getSearchResults(parsed.data.id);
      } catch (err) {
        return handleSlskdError(reply, err);
      }
    },
  );

  // Stop & remove a search from slskd
  app.delete("/api/acquisition/search/:id", async (request, reply) => {
    if (!requireSoulseekAccess(request, reply)) return;
    const parsed = searchIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid search ID." });
    }
    try {
      await slskdClient.deleteSearch(parsed.data.id);
      return reply.code(204).send();
    } catch (err) {
      return handleSlskdError(reply, err);
    }
  });

  // Enqueue one or more files (a single song or a whole album folder) on slskd
  app.post("/api/acquisition/downloads", async (request, reply) => {
    const user = requireSoulseekAccess(request, reply);
    if (!user) return;

    const parsed = enqueueBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid download request payload." });
    }
    try {
      await slskdClient.enqueueDownloads(parsed.data.username, parsed.data.files);
      onDownloadEnqueued?.(user.id, parsed.data.username, parsed.data.files);
      return reply.code(202).send({
        queued: parsed.data.files.length,
        username: parsed.data.username,
      });
    } catch (err) {
      return handleSlskdError(reply, err);
    }
  });

  // List active, completed, and failed downloads from slskd (filtered per user for non-admins)
  app.get(
    "/api/acquisition/downloads",
    async (request, reply): Promise<DownloadsListResponse> => {
      const user = requireSoulseekAccess(request, reply);
      if (!user) return reply as never;

      try {
        const list = await slskdClient.listDownloads();
        if (user.role === "admin" || !userOwnsSlskdFile) {
          return list;
        }
        const filtered = list.transfers.filter((t) =>
          userOwnsSlskdFile(user.id, t.username, t.filename),
        );
        return {
          activeCount: filtered.filter((t) => t.isActive).length,
          completedCount: filtered.filter((t) => t.isCompleted).length,
          failedCount: filtered.filter((t) => t.isFailed).length,
          transfers: filtered,
        };
      } catch (err) {
        return handleSlskdError(reply, err);
      }
    },
  );

  // Clear all completed downloads (Admin only since slskd history is shared)
  app.delete("/api/acquisition/downloads/completed", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      await slskdClient.clearCompletedDownloads();
      return reply.code(204).send();
    } catch (err) {
      return handleSlskdError(reply, err);
    }
  });

  // Cancel / remove a single transfer
  app.delete("/api/acquisition/downloads/:username/:id", async (request, reply) => {
    const user = requireSoulseekAccess(request, reply);
    if (!user) return;
    const parsed = removeDownloadParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid transfer parameters." });
    }
    try {
      if (user.role !== "admin" && userOwnsSlskdFile) {
        const list = await slskdClient.listDownloads();
        const target = list.transfers.find(
          (t) => t.username === parsed.data.username && t.id === parsed.data.id,
        );
        if (!target || !userOwnsSlskdFile(user.id, target.username, target.filename)) {
          return reply.code(404).send({ error: "Transfer not found." });
        }
      }
      await slskdClient.removeDownload(parsed.data.username, parsed.data.id);
      return reply.code(204).send();
    } catch (err) {
      return handleSlskdError(reply, err);
    }
  });
}
