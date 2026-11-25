import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@musicorbit/shared";
import type { AppConfig } from "../config.js";
import type { DbContext } from "../db/index.js";

export interface HealthRouteDeps {
  config: AppConfig;
  dbContext: DbContext;
  getMusicDir?: () => string;
  getUserMusicDir?: (userId: number) => string;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthRouteDeps,
): Promise<void> {
  app.get("/api/health", async (request): Promise<HealthResponse> => {
    const { config, dbContext } = deps;
    const authUser = request.authUser;
    const activeMusicDir =
      authUser && deps.getUserMusicDir
        ? deps.getUserMusicDir(authUser.id)
        : deps.getMusicDir
          ? deps.getMusicDir()
          : config.musicDir;

    let dbConnected = false;
    let artistCount = 0;
    let albumCount = 0;
    let trackCount = 0;

    try {
      if (authUser) {
        // Count album artists for the authenticated user so it matches their Artists directory
        const artistRow = dbContext.sqlite
          .prepare("SELECT COUNT(DISTINCT artist_id) AS value FROM albums WHERE user_id = ?")
          .get(authUser.id) as { value: number } | undefined;
        const albumRow = dbContext.sqlite
          .prepare("SELECT COUNT(*) AS value FROM albums WHERE user_id = ?")
          .get(authUser.id) as { value: number } | undefined;
        const trackRow = dbContext.sqlite
          .prepare("SELECT COUNT(*) AS value FROM tracks WHERE user_id = ?")
          .get(authUser.id) as { value: number } | undefined;
        artistCount = artistRow?.value ?? 0;
        albumCount = albumRow?.value ?? 0;
        trackCount = trackRow?.value ?? 0;
      } else {
        // Unauthenticated health probe (e.g., Docker HEALTHCHECK): verify DB connectivity without exposing user counts
        dbContext.sqlite.prepare("SELECT 1").get();
      }
      dbConnected = true;
    } catch (err) {
      app.log.error({ err }, "Database health check failed");
    }

    const musicDirExists = fs.existsSync(activeMusicDir);

    return {
      status: dbConnected ? "ok" : "degraded",
      service: "musicorbit",
      version: config.version,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database: {
        connected: dbConnected,
        path: authUser?.role === "admin" ? dbContext.dbPath : "",
      },
      musicDir: {
        path: authUser ? activeMusicDir : "",
        exists: musicDirExists,
      },
      counts: {
        artists: artistCount,
        albums: albumCount,
        tracks: trackCount,
      },
    };
  });
}
