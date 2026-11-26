import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * Serves the built Vite SPA from WEB_DIST_DIR in single-container production/Docker mode.
 * Leaves /api/* routes untouched and falls back to index.html for client-side routes.
 */
export async function registerStaticWeb(
  app: FastifyInstance,
  webDistDir: string,
): Promise<void> {
  const resolvedRoot = path.resolve(webDistDir);
  const indexHtml = path.join(resolvedRoot, "index.html");
  if (!fs.existsSync(indexHtml)) {
    app.log.warn({ webDistDir: resolvedRoot }, "WEB_DIST_DIR index.html not found; skipping static UI serving");
    return;
  }

  app.get("/*", async (request, reply) => {
    const urlPath = (request.url.split("?")[0] ?? "/").replace(/^\/+/, "");
    if (urlPath.startsWith("api/") || urlPath.startsWith("rest/")) {
      return reply.code(404).send({ error: "API route not found" });
    }

    const candidate = path.resolve(resolvedRoot, urlPath || "index.html");
    const isContained =
      candidate === resolvedRoot || candidate.startsWith(`${resolvedRoot}${path.sep}`);

    if (isContained && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      reply.header("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
      if (urlPath.startsWith("assets/")) {
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        reply.header("Cache-Control", "no-cache");
      }
      return reply.send(fs.createReadStream(candidate));
    }

    // SPA fallback
    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Cache-Control", "no-cache");
    return reply.send(fs.createReadStream(indexHtml));
  });
}
