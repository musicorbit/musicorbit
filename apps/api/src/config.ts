import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root is three levels up from apps/api/src/config.ts
const REPO_ROOT = path.resolve(__dirname, "../../..");

// Load .env from repo root if present (Docker/production can also inject env vars directly)
const rootEnvPath = path.join(REPO_ROOT, ".env");
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

const booleanDefaultTrue = z
  .enum(["true", "false", "1", "0"])
  .default("true")
  .transform((v) => v === "true" || v === "1");

const booleanDefaultFalse = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v.replace(/\/+$/, "") : null));

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4410),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  MUSIC_DIR: z.string().min(1).default("./sample-music"),
  DATA_DIR: z.string().min(1).default("./data"),
  DOWNLOADS_DIR: z.string().min(1).default("./downloads"),
  AUTO_IMPORT_THRESHOLD: z.coerce.number().int().min(0).max(100).default(85),
  FETCH_ARTIST_IMAGES: booleanDefaultTrue,
  CHECK_UPDATES: booleanDefaultTrue,
  AUTH_ENABLED: booleanDefaultTrue,
  WEB_DIST_DIR: optionalString,
  SLSKD_URL: optionalUrl,
  SLSKD_API_KEY: optionalString,
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

function readPackageVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.trim().length > 0) {
      return pkg.version.trim();
    }
  } catch {
    // Fall back to default version below
  }
  return "0.1.0";
}

export const config = {
  port: parsed.data.PORT,
  host: parsed.data.HOST,
  logLevel: parsed.data.LOG_LEVEL,
  musicDir: resolveFromRoot(parsed.data.MUSIC_DIR),
  dataDir: resolveFromRoot(parsed.data.DATA_DIR),
  downloadsDir: resolveFromRoot(parsed.data.DOWNLOADS_DIR),
  autoImportThreshold: parsed.data.AUTO_IMPORT_THRESHOLD,
  dbPath: path.join(resolveFromRoot(parsed.data.DATA_DIR), "musicorbit.db"),
  coversDir: path.join(resolveFromRoot(parsed.data.DATA_DIR), "covers"),
  artistImagesDir: path.join(resolveFromRoot(parsed.data.DATA_DIR), "artist-images"),
  fetchArtistImages: parsed.data.FETCH_ARTIST_IMAGES,
  checkUpdates: parsed.data.CHECK_UPDATES,
  authEnabled: parsed.data.AUTH_ENABLED,
  webDistDir: parsed.data.WEB_DIST_DIR ? resolveFromRoot(parsed.data.WEB_DIST_DIR) : null,
  slskdUrl: parsed.data.SLSKD_URL,
  slskdApiKey: parsed.data.SLSKD_API_KEY,
  version: readPackageVersion(),
} as const;

export type AppConfig = Omit<typeof config, "checkUpdates"> & {
  checkUpdates?: boolean;
};
