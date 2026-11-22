import { config } from "./config.js";
import { buildServer } from "./server.js";

async function start(): Promise<void> {
  const { app } = await buildServer(config);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down MusicOrbit API...");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      { port: config.port, musicDir: config.musicDir, dbPath: config.dbPath },
      "MusicOrbit API listening",
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
