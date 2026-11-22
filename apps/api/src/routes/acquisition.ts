import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type {
  AcquisitionStatusResponse,
  DownloadsListResponse,
  SoulseekSearchResultsResponse,
  SoulseekSearchSummary,
} from "@musicorbit/shared";
import { SlskdError, type SlskdClient } from "../services/acquisition/slskd.js";

export interface AcquisitionRouteDeps {
  slskdClient: SlskdClient;
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
  const { slskdClient } = deps;

  // Report whether slskd is configured and reachable (never exposes API keys)
  app.get("/api/acquisition/status", async (): Promise<AcquisitionStatusResponse> => {
    return slskdClient.getStatus();
  });

  // Start a new Soulseek search via slskd
  app.post(
    "/api/acquisition/search",
    async (request, reply): Promise<SoulseekSearchSummary> => {
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
    const parsed = enqueueBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid download request payload." });
    }
    try {
      await slskdClient.enqueueDownloads(parsed.data.username, parsed.data.files);
      return reply.code(202).send({
        queued: parsed.data.files.length,
        username: parsed.data.username,
      });
    } catch (err) {
      return handleSlskdError(reply, err);
    }
  });

  // List active, completed, and failed downloads from slskd
  app.get(
    "/api/acquisition/downloads",
    async (_request, reply): Promise<DownloadsListResponse> => {
      try {
        return await slskdClient.listDownloads();
      } catch (err) {
        return handleSlskdError(reply, err);
      }
    },
  );

  // Clear all completed downloads
  app.delete("/api/acquisition/downloads/completed", async (_request, reply) => {
    try {
      await slskdClient.clearCompletedDownloads();
      return reply.code(204).send();
    } catch (err) {
      return handleSlskdError(reply, err);
    }
  });

  // Cancel / remove a single transfer
  app.delete("/api/acquisition/downloads/:username/:id", async (request, reply) => {
    const parsed = removeDownloadParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid transfer parameters." });
    }
    try {
      await slskdClient.removeDownload(parsed.data.username, parsed.data.id);
      return reply.code(204).send();
    } catch (err) {
      return handleSlskdError(reply, err);
    }
  });
}
