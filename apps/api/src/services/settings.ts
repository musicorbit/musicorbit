import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  BrowseDirectoriesResponse,
  DirectoryEntry,
  DuplicatePolicy,
  ImportFileAction,
  InboxWatcherStatus,
  PostProcessingSettings,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";

const KEYS = {
  musicDir: "music_dir",
  downloadsDir: "downloads_dir",
  fileAction: "pp_file_action",
  duplicatePolicy: "pp_duplicate_policy",
  autoWatchEnabled: "pp_auto_watch_enabled",
  autoWatchIntervalSeconds: "pp_auto_watch_interval_seconds",
  autoImportThreshold: "pp_auto_import_threshold",
  includeYearInAlbumFolder: "pp_include_year_in_album_folder",
  autoEmbedCoverArt: "pp_auto_embed_cover_art",
  autoFetchLyrics: "pp_auto_fetch_lyrics",
} as const;

export class SettingsError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "SettingsError";
    this.statusCode = statusCode;
  }
}

function expandHomeDir(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function validateReadableDirectory(rawPath: string): string {
  const expanded = expandHomeDir(rawPath);
  if (!expanded) {
    throw new SettingsError("Please provide a folder path.", 400);
  }

  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved)) {
    throw new SettingsError(`Directory does not exist: ${resolved}`, 400);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new SettingsError(`Cannot access directory: ${resolved}`, 400);
  }

  if (!stat.isDirectory()) {
    throw new SettingsError(`Path is not a directory: ${resolved}`, 400);
  }

  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    throw new SettingsError(`Directory is not readable: ${resolved}`, 403);
  }

  return resolved;
}

export interface SettingsServiceDeps {
  dbContext: DbContext;
  defaultMusicDir: string;
  defaultDownloadsDir: string;
  defaultAutoImportThreshold?: number;
}

export interface PostProcessingUpdateInput {
  downloadsDir?: string;
  fileAction?: ImportFileAction;
  duplicatePolicy?: DuplicatePolicy;
  autoWatchEnabled?: boolean;
  autoWatchIntervalSeconds?: number;
  autoImportThreshold?: number;
  includeYearInAlbumFolder?: boolean;
  autoEmbedCoverArt?: boolean;
  autoFetchLyrics?: boolean;
}

/**
 * Persists runtime-configurable settings (music directory + post-processing options)
 * in SQLite so users can configure everything in the UI without editing .env or restarting.
 */
export class SettingsService {
  private readonly dbContext: DbContext;
  private readonly defaultMusicDir: string;
  private readonly defaultDownloadsDir: string;
  private readonly defaultAutoImportThreshold: number;
  private readonly rawValues = new Map<string, string>();
  private getWatcherStatusFn: () => InboxWatcherStatus;

  constructor(deps: SettingsServiceDeps) {
    this.dbContext = deps.dbContext;
    this.defaultMusicDir = path.resolve(deps.defaultMusicDir);
    this.defaultDownloadsDir = path.resolve(deps.defaultDownloadsDir);
    this.defaultAutoImportThreshold = deps.defaultAutoImportThreshold ?? 85;
    this.getWatcherStatusFn = () => ({
      enabled: this.getPostProcessingSettings().autoWatchEnabled,
      running: false,
      intervalSeconds: this.getPostProcessingSettings().autoWatchIntervalSeconds,
      lastCheckAt: null,
      lastError: null,
      lastResult: null,
    });
    this.loadFromDb();
  }

  setWatcherStatusProvider(fn: () => InboxWatcherStatus): void {
    this.getWatcherStatusFn = fn;
  }

  private loadFromDb(): void {
    const rows = this.dbContext.sqlite
      .prepare("SELECT key, value FROM settings")
      .all() as Array<{ key: string; value: string }>;
    this.rawValues.clear();
    for (const row of rows) {
      this.rawValues.set(row.key, row.value);
    }
  }

  private saveSetting(key: string, value: string): void {
    const now = Date.now();
    this.dbContext.sqlite
      .prepare(
        `
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      )
      .run(key, value, now);
    this.rawValues.set(key, value);
  }

  private readBool(key: string, fallback: boolean): boolean {
    const raw = this.rawValues.get(key);
    if (raw === undefined) return fallback;
    return raw === "true" || raw === "1";
  }

  private readInt(key: string, fallback: number, min: number, max: number): number {
    const raw = this.rawValues.get(key);
    if (raw === undefined) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  getMusicDir(): string {
    const overridden = this.rawValues.get(KEYS.musicDir);
    return overridden ? path.resolve(overridden) : this.defaultMusicDir;
  }

  getDownloadsDir(): string {
    const overridden = this.rawValues.get(KEYS.downloadsDir);
    return overridden ? path.resolve(overridden) : this.defaultDownloadsDir;
  }

  isMusicDirOverridden(): boolean {
    const overridden = this.rawValues.get(KEYS.musicDir);
    return Boolean(overridden && path.resolve(overridden) !== this.defaultMusicDir);
  }

  getPostProcessingSettings(): PostProcessingSettings {
    const downloadsDir = this.getDownloadsDir();
    const rawAction = this.rawValues.get(KEYS.fileAction);
    const fileAction: ImportFileAction = rawAction === "copy" ? "copy" : "move";

    const rawDup = this.rawValues.get(KEYS.duplicatePolicy);
    const duplicatePolicy: DuplicatePolicy =
      rawDup === "review" || rawDup === "skip" || rawDup === "upgrade" ? rawDup : "upgrade";

    let downloadsDirExists = false;
    try {
      downloadsDirExists = fs.existsSync(downloadsDir) && fs.statSync(downloadsDir).isDirectory();
    } catch {
      downloadsDirExists = false;
    }

    return {
      downloadsDir,
      defaultDownloadsDir: this.defaultDownloadsDir,
      downloadsDirExists,
      fileAction,
      duplicatePolicy,
      autoWatchEnabled: this.readBool(KEYS.autoWatchEnabled, false),
      autoWatchIntervalSeconds: this.readInt(KEYS.autoWatchIntervalSeconds, 60, 15, 3600),
      autoImportThreshold: this.readInt(
        KEYS.autoImportThreshold,
        this.defaultAutoImportThreshold,
        50,
        100,
      ),
      includeYearInAlbumFolder: this.readBool(KEYS.includeYearInAlbumFolder, false),
      autoEmbedCoverArt: this.readBool(KEYS.autoEmbedCoverArt, true),
      autoFetchLyrics: this.readBool(KEYS.autoFetchLyrics, false),
    };
  }

  getSettings(): SystemSettingsResponse {
    const musicDir = this.getMusicDir();
    const postProcessing = this.getPostProcessingSettings();
    let musicDirExists = false;
    try {
      musicDirExists = fs.existsSync(musicDir) && fs.statSync(musicDir).isDirectory();
    } catch {
      musicDirExists = false;
    }

    return {
      musicDir,
      defaultMusicDir: this.defaultMusicDir,
      musicDirExists,
      isOverridden: this.isMusicDirOverridden(),
      downloadsDir: postProcessing.downloadsDir,
      postProcessing,
      watcher: this.getWatcherStatusFn(),
    };
  }

  setMusicDir(rawPath: string): SystemSettingsResponse {
    const resolved = validateReadableDirectory(rawPath);
    this.saveSetting(KEYS.musicDir, resolved);
    return this.getSettings();
  }

  updatePostProcessing(input: PostProcessingUpdateInput): SystemSettingsResponse {
    if (input.downloadsDir !== undefined) {
      const resolved = validateReadableDirectory(input.downloadsDir);
      this.saveSetting(KEYS.downloadsDir, resolved);
    }
    if (input.fileAction !== undefined) {
      this.saveSetting(KEYS.fileAction, input.fileAction);
    }
    if (input.duplicatePolicy !== undefined) {
      this.saveSetting(KEYS.duplicatePolicy, input.duplicatePolicy);
    }
    if (input.autoWatchEnabled !== undefined) {
      this.saveSetting(KEYS.autoWatchEnabled, String(input.autoWatchEnabled));
    }
    if (input.autoWatchIntervalSeconds !== undefined) {
      const clamped = Math.max(15, Math.min(3600, Math.round(input.autoWatchIntervalSeconds)));
      this.saveSetting(KEYS.autoWatchIntervalSeconds, String(clamped));
    }
    if (input.autoImportThreshold !== undefined) {
      const clamped = Math.max(50, Math.min(100, Math.round(input.autoImportThreshold)));
      this.saveSetting(KEYS.autoImportThreshold, String(clamped));
    }
    if (input.includeYearInAlbumFolder !== undefined) {
      this.saveSetting(KEYS.includeYearInAlbumFolder, String(input.includeYearInAlbumFolder));
    }
    if (input.autoEmbedCoverArt !== undefined) {
      this.saveSetting(KEYS.autoEmbedCoverArt, String(input.autoEmbedCoverArt));
    }
    if (input.autoFetchLyrics !== undefined) {
      this.saveSetting(KEYS.autoFetchLyrics, String(input.autoFetchLyrics));
    }

    return this.getSettings();
  }

  async browseDirectories(rawPath?: string): Promise<BrowseDirectoriesResponse> {
    const activeMusicDir = this.getMusicDir();
    const activeDownloadsDir = this.getDownloadsDir();
    const homeDir = os.homedir();

    const candidateQuickPaths: Array<{ label: string; path: string }> = [
      { label: "Current Music Dir", path: activeMusicDir },
      { label: "Downloads Watch Dir", path: activeDownloadsDir },
      { label: "Home", path: homeDir },
      { label: "Music", path: path.join(homeDir, "Music") },
      { label: "Downloads", path: path.join(homeDir, "Downloads") },
      { label: "Volumes", path: "/Volumes" },
      { label: "Media", path: "/media" },
      { label: "Mnt", path: "/mnt" },
      { label: "Root (/)", path: path.parse(homeDir).root },
    ];

    const seenQuick = new Set<string>();
    const quickPaths: Array<{ label: string; path: string }> = [];
    for (const item of candidateQuickPaths) {
      const resolved = path.resolve(item.path);
      if (seenQuick.has(resolved)) continue;
      if (fs.existsSync(resolved)) {
        try {
          if (fs.statSync(resolved).isDirectory()) {
            seenQuick.add(resolved);
            quickPaths.push({ label: item.label, path: resolved });
          }
        } catch {
          // Ignore unreadable quick path
        }
      }
    }

    let targetPath: string;
    if (rawPath && rawPath.trim()) {
      targetPath = path.resolve(expandHomeDir(rawPath));
    } else if (fs.existsSync(activeMusicDir)) {
      targetPath = activeMusicDir;
    } else {
      targetPath = homeDir;
    }

    const parent = path.dirname(targetPath);
    const parentPath = parent !== targetPath ? parent : null;

    let exists = false;
    const directories: DirectoryEntry[] = [];

    try {
      const stat = await fsp.stat(targetPath);
      if (stat.isDirectory()) {
        exists = true;
        const entries = await fsp.readdir(targetPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const full = path.join(targetPath, entry.name);
          let isDir = entry.isDirectory();
          if (!isDir && entry.isSymbolicLink()) {
            try {
              isDir = fs.statSync(full).isDirectory();
            } catch {
              isDir = false;
            }
          }
          if (isDir) {
            directories.push({ name: entry.name, path: full });
          }
        }
        directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      }
    } catch {
      exists = false;
    }

    return {
      currentPath: targetPath,
      parentPath,
      exists,
      directories,
      quickPaths,
    };
  }
}
