import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  BrowseDirectoriesResponse,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import type { LibraryScanner } from "../services/scanner.js";
import { SettingsError, type SettingsService } from "../services/settings.js";

export interface SettingsRouteDeps {
  settingsService: SettingsService;
  scanner: LibraryScanner;
}

const browseQuerySchema = z.object({
  path: z.string().optional(),
});

const updateMusicDirBodySchema = z.object({
  path: z.string().trim().min(1).max(1000),
  scanNow: z.boolean().optional().default(true),
});

export async function registerSettingsRoutes(
  app: FastifyInstance,
  deps: SettingsRouteDeps,
): Promise<void> {
  const { settingsService, scanner } = deps;

  app.get("/api/system/settings", async (): Promise<SystemSettingsResponse> => {
    return settingsService.getSettings();
  });

  app.get(
    "/api/system/browse-dirs",
    async (request): Promise<BrowseDirectoriesResponse> => {
      const parsed = browseQuerySchema.safeParse(request.query);
      const rawPath = parsed.success ? parsed.data.path : undefined;
      return settingsService.browseDirectories(rawPath);
    },
  );

  app.put(
    "/api/system/music-dir",
    async (request, reply): Promise<SystemSettingsResponse> => {
      const parsed = updateMusicDirBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Please provide a valid folder path." });
      }

      try {
        const updated = settingsService.setMusicDir(parsed.data.path);
        if (parsed.data.scanNow) {
          scanner.startScan({ force: false });
        }
        return updated;
      } catch (err) {
        if (err instanceof SettingsError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
