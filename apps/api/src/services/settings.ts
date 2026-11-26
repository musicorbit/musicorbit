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
  LibraryLayoutPreset,
  LibraryOrganizationSettings,
  MultiDiscStyle,
  PlaylistSyncSettings,
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
  playlistSyncEnabled: "playlist_sync_enabled",
  playlistSyncDir: "playlist_sync_dir",
  layoutPreset: "org_layout_preset",
  includeTrackNumber: "org_include_track_number",
  multiDiscStyle: "org_multi_disc_style",
  autoOrganizeLibrary: "org_auto_organize_library",
  slskdUrl: "slskd_url",
  slskdApiKey: "slskd_api_key",
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
  defaultSlskdUrl?: string | null;
  defaultSlskdApiKey?: string | null;
}

export interface SlskdConfigState {
  url: string | null;
  apiKey: string | null;
  hasApiKey: boolean;
  source: "ui" | "env" | "none";
}

export interface SlskdConfigUpdateInput {
  url?: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
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

export interface PlaylistSyncUpdateInput {
  enabled?: boolean;
  playlistsDir?: string;
}

export interface LibraryOrganizationUpdateInput {
  layoutPreset?: LibraryLayoutPreset;
  includeYearInAlbumFolder?: boolean;
  includeTrackNumber?: boolean;
  multiDiscStyle?: MultiDiscStyle;
  autoOrganizeLibrary?: boolean;
}

/**
 * Persists runtime-configurable settings (music directory + post-processing + playlist sync)
 * in SQLite so users can configure everything in the UI without editing .env or restarting.
 */
export class SettingsService {
  private readonly dbContext: DbContext;
  private readonly defaultMusicDir: string;
  private readonly defaultDownloadsDir: string;
  private readonly defaultAutoImportThreshold: number;
  private readonly defaultSlskdUrl: string | null;
  private readonly defaultSlskdApiKey: string | null;
  private readonly rawValues = new Map<string, string>();
  private getWatcherStatusFn: () => InboxWatcherStatus;

  constructor(deps: SettingsServiceDeps) {
    this.dbContext = deps.dbContext;
    this.defaultMusicDir = path.resolve(deps.defaultMusicDir);
    this.defaultDownloadsDir = path.resolve(deps.defaultDownloadsDir);
    this.defaultAutoImportThreshold = deps.defaultAutoImportThreshold ?? 85;
    this.defaultSlskdUrl = deps.defaultSlskdUrl ? deps.defaultSlskdUrl.replace(/\/+$/, "") : null;
    this.defaultSlskdApiKey = deps.defaultSlskdApiKey?.trim() || null;
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

  private normalizeSlskdUrl(raw: string | null | undefined): string | null {
    const trimmed = raw?.trim() ?? "";
    if (!trimmed) return null;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new SettingsError("Invalid slskd URL. Expected e.g. http://localhost:5030", 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SettingsError("slskd URL must start with http:// or https://", 400);
    }
    return parsed.toString().replace(/\/+$/, "");
  }

  getSlskdConfig(): SlskdConfigState {
    const hasUiUrl = this.rawValues.has(KEYS.slskdUrl);
    const hasUiKey = this.rawValues.has(KEYS.slskdApiKey);

    if (hasUiUrl || hasUiKey) {
      const uiUrl = this.rawValues.get(KEYS.slskdUrl)?.trim() || null;
      const uiKey = this.rawValues.get(KEYS.slskdApiKey)?.trim() || null;
      return {
        url: uiUrl,
        apiKey: uiUrl ? uiKey : null,
        hasApiKey: Boolean(uiUrl && uiKey),
        source: uiUrl ? "ui" : "none",
      };
    }

    if (this.defaultSlskdUrl) {
      return {
        url: this.defaultSlskdUrl,
        apiKey: this.defaultSlskdApiKey,
        hasApiKey: Boolean(this.defaultSlskdApiKey),
        source: "env",
      };
    }

    return {
      url: null,
      apiKey: null,
      hasApiKey: false,
      source: "none",
    };
  }

  updateSlskdConfig(input: SlskdConfigUpdateInput): SlskdConfigState {
    const current = this.getSlskdConfig();
    const nextUrl =
      input.url !== undefined ? this.normalizeSlskdUrl(input.url) : current.url;

    let nextKey = current.apiKey;
    if (!nextUrl || input.clearApiKey) {
      nextKey = null;
    } else if (typeof input.apiKey === "string" && input.apiKey.trim().length > 0) {
      nextKey = input.apiKey.trim();
    }

    // Store empty string explicitly so UI clearing overrides any .env fallback
    this.saveSetting(KEYS.slskdUrl, nextUrl ?? "");
    this.saveSetting(KEYS.slskdApiKey, nextKey ?? "");
    return this.getSlskdConfig();
  }

  getPrimaryAdminId(): number {
    const row = this.dbContext.sqlite
      .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    return row?.id ?? 1;
  }

  getUserMusicDir(userId?: number): string {
    if (userId === undefined) return this.getMusicDir();
    const row = this.dbContext.sqlite
      .prepare("SELECT music_dir AS musicDir, role FROM users WHERE id = ?")
      .get(userId) as { musicDir: string | null; role: string } | undefined;
    if (row?.musicDir) {
      return path.resolve(row.musicDir);
    }
    return this.getMusicDir();
  }

  private readUserSettingMap(userId: number): Map<string, string> {
    const rows = this.dbContext.sqlite
      .prepare("SELECT key, value FROM user_settings WHERE user_id = ?")
      .all(userId) as Array<{ key: string; value: string }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.key, r.value);
    }
    return map;
  }

  private saveUserSetting(userId: number, key: string, value: string): void {
    const existsUser = this.dbContext.sqlite
      .prepare("SELECT id FROM users WHERE id = ?")
      .get(userId) as { id: number } | undefined;
    if (!existsUser) {
      // Single-user / AUTH_ENABLED=false mode with no users table rows: persist in global settings
      this.saveSetting(key, value);
      return;
    }
    const now = Date.now();
    this.dbContext.sqlite
      .prepare(
        `
        INSERT INTO user_settings (user_id, key, value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      )
      .run(userId, key, value, now);
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

  getPlaylistSyncSettings(userId?: number): PlaylistSyncSettings {
    const targetMusicDir = this.getUserMusicDir(userId);
    const defaultPlaylistsDir = path.join(targetMusicDir, "Playlists");

    const userMap = userId !== undefined ? this.readUserSettingMap(userId) : null;
    const useGlobalFallback = userId === undefined || userId === this.getPrimaryAdminId();

    const rawDir =
      userMap?.get(KEYS.playlistSyncDir) ??
      (useGlobalFallback ? this.rawValues.get(KEYS.playlistSyncDir) : undefined);
    const playlistsDir = rawDir ? path.resolve(rawDir) : defaultPlaylistsDir;

    const rawEnabled =
      userMap?.get(KEYS.playlistSyncEnabled) ??
      (useGlobalFallback ? this.rawValues.get(KEYS.playlistSyncEnabled) : undefined);
    const enabled = rawEnabled === "true" || rawEnabled === "1";

    let playlistsDirExists = false;
    try {
      playlistsDirExists = fs.existsSync(playlistsDir) && fs.statSync(playlistsDir).isDirectory();
    } catch {
      playlistsDirExists = false;
    }

    return {
      enabled,
      playlistsDir,
      defaultPlaylistsDir,
      playlistsDirExists,
    };
  }

  getLibraryOrganizationSettings(userId?: number): LibraryOrganizationSettings {
    const userMap = userId !== undefined ? this.readUserSettingMap(userId) : null;
    const useGlobalFallback = userId === undefined || userId === this.getPrimaryAdminId();
    const readVal = (key: string): string | undefined =>
      userMap?.get(key) ?? (useGlobalFallback ? this.rawValues.get(key) : undefined);

    const rawPreset = readVal(KEYS.layoutPreset);
    const layoutPreset: LibraryLayoutPreset =
      rawPreset === "artist_track" ||
      rawPreset === "flat" ||
      rawPreset === "keep_existing" ||
      rawPreset === "artist_album_track"
        ? rawPreset
        : "artist_album_track";

    const rawDisc = readVal(KEYS.multiDiscStyle);
    const multiDiscStyle: MultiDiscStyle = rawDisc === "subfolder" ? "subfolder" : "prefix";

    const rawYear = readVal(KEYS.includeYearInAlbumFolder);
    const includeYearInAlbumFolder = rawYear === "true" || rawYear === "1";

    const rawTrackNum = readVal(KEYS.includeTrackNumber);
    const includeTrackNumber =
      rawTrackNum === undefined ? true : rawTrackNum === "true" || rawTrackNum === "1";

    const rawAutoOrg = readVal(KEYS.autoOrganizeLibrary);
    const autoOrganizeLibrary =
      layoutPreset === "keep_existing" ? false : rawAutoOrg === "true" || rawAutoOrg === "1";

    return {
      layoutPreset,
      includeYearInAlbumFolder,
      includeTrackNumber,
      multiDiscStyle,
      autoOrganizeLibrary,
    };
  }

  listAutoOrganizeUserIds(): number[] {
    const users = this.dbContext.sqlite
      .prepare("SELECT id FROM users ORDER BY id ASC")
      .all() as Array<{ id: number }>;
    const candidateIds = users.length > 0 ? users.map((u) => u.id) : [1];
    return candidateIds.filter((uid) => {
      const org = this.getLibraryOrganizationSettings(uid);
      return org.autoOrganizeLibrary && org.layoutPreset !== "keep_existing";
    });
  }

  getSettings(userId?: number): SystemSettingsResponse {
    const musicDir = this.getUserMusicDir(userId);
    const postProcessing = this.getPostProcessingSettings();
    const libraryOrganization = this.getLibraryOrganizationSettings(userId);
    const playlistSync = this.getPlaylistSyncSettings(userId);
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
      isOverridden: userId === undefined ? this.isMusicDirOverridden() : musicDir !== this.defaultMusicDir,
      downloadsDir: postProcessing.downloadsDir,
      postProcessing,
      libraryOrganization,
      playlistSync,
      watcher: this.getWatcherStatusFn(),
    };
  }

  setMusicDir(rawPath: string, userId?: number): SystemSettingsResponse {
    const resolved = validateReadableDirectory(rawPath);
    this.saveSetting(KEYS.musicDir, resolved);
    // Keep the primary admin's user record aligned when admin changes global musicDir
    const adminId = userId ?? this.getPrimaryAdminId();
    this.dbContext.sqlite
      .prepare("UPDATE users SET music_dir = ? WHERE id = ? AND role = 'admin'")
      .run(resolved, adminId);
    return this.getSettings(userId);
  }

  updatePlaylistSync(input: PlaylistSyncUpdateInput, userId?: number): SystemSettingsResponse {
    const save = (key: string, val: string) =>
      userId !== undefined ? this.saveUserSetting(userId, key, val) : this.saveSetting(key, val);

    if (input.playlistsDir !== undefined) {
      const expanded = expandHomeDir(input.playlistsDir);
      if (!expanded) {
        throw new SettingsError("Please provide a playlists folder path.", 400);
      }
      const resolved = path.resolve(expanded);
      // Allow choosing an existing directory OR creating a new Playlists folder cleanly
      if (fs.existsSync(resolved)) {
        if (!fs.statSync(resolved).isDirectory()) {
          throw new SettingsError(`Path is not a directory: ${resolved}`, 400);
        }
      } else {
        fs.mkdirSync(resolved, { recursive: true });
      }
      save(KEYS.playlistSyncDir, resolved);
    }
    if (input.enabled !== undefined) {
      save(KEYS.playlistSyncEnabled, String(input.enabled));
    }
    return this.getSettings(userId);
  }

  updateLibraryOrganization(
    input: LibraryOrganizationUpdateInput,
    userId?: number,
  ): SystemSettingsResponse {
    const save = (key: string, val: string) =>
      userId !== undefined ? this.saveUserSetting(userId, key, val) : this.saveSetting(key, val);

    if (input.layoutPreset !== undefined) {
      save(KEYS.layoutPreset, input.layoutPreset);
      if (input.layoutPreset === "keep_existing") {
        save(KEYS.autoOrganizeLibrary, "false");
      }
    }
    if (input.includeYearInAlbumFolder !== undefined) {
      save(KEYS.includeYearInAlbumFolder, String(input.includeYearInAlbumFolder));
    }
    if (input.includeTrackNumber !== undefined) {
      save(KEYS.includeTrackNumber, String(input.includeTrackNumber));
    }
    if (input.multiDiscStyle !== undefined) {
      save(KEYS.multiDiscStyle, input.multiDiscStyle);
    }
    if (input.autoOrganizeLibrary !== undefined) {
      const effectivePreset =
        input.layoutPreset ?? this.getLibraryOrganizationSettings(userId).layoutPreset;
      save(
        KEYS.autoOrganizeLibrary,
        String(effectivePreset === "keep_existing" ? false : input.autoOrganizeLibrary),
      );
    }
    return this.getSettings(userId);
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
