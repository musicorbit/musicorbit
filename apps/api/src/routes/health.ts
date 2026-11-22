import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { count } from "drizzle-orm";
import type { HealthResponse } from "@musicorbit/shared";
import type { AppConfig } from "../config.js";
import type { DbContext } from "../db/index.js";
import { albums, tracks } from "../db/schema.js";

export interface HealthRouteDeps {
  config: AppConfig;
  dbContext: DbContext;
  getMusicDir?: () => string;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthRouteDeps,
): Promise<void> {
  app.get("/api/health", async (): Promise<HealthResponse> => {
    const { config, dbContext } = deps;
    const activeMusicDir = deps.getMusicDir ? deps.getMusicDir() : config.musicDir;

    let dbConnected = false;
    let artistCount = 0;
    let albumCount = 0;
    let trackCount = 0;

    try {
      // Count album artists so the count matches the Artists directory
      // (track-only featured artists don't inflate the library artist count).
      const artistRow = dbContext.sqlite
        .prepare("SELECT COUNT(DISTINCT artist_id) AS value FROM albums")
        .get() as { value: number } | undefined;
      const [al] = await dbContext.db.select({ value: count() }).from(albums);
      const [t] = await dbContext.db.select({ value: count() }).from(tracks);
      artistCount = artistRow?.value ?? 0;
      albumCount = al?.value ?? 0;
      trackCount = t?.value ?? 0;
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
        path: dbContext.dbPath,
      },
      musicDir: {
        path: activeMusicDir,
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
