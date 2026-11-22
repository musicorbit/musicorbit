import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  BrowseDirectoriesResponse,
  DirectoryEntry,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";

const MUSIC_DIR_KEY = "music_dir";

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

export interface SettingsServiceDeps {
  dbContext: DbContext;
  defaultMusicDir: string;
  downloadsDir: string;
}

/**
 * Persists runtime-configurable settings (starting with the active music directory)
 * in SQLite so users can change folders via the UI without editing .env or restarting.
 */
export class SettingsService {
  private readonly dbContext: DbContext;
  private readonly defaultMusicDir: string;
  private readonly downloadsDir: string;
  private cachedMusicDir: string | null = null;

  constructor(deps: SettingsServiceDeps) {
    this.dbContext = deps.dbContext;
    this.defaultMusicDir = path.resolve(deps.defaultMusicDir);
    this.downloadsDir = path.resolve(deps.downloadsDir);
    this.loadFromDb();
  }

  private loadFromDb(): void {
    const row = this.dbContext.sqlite
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(MUSIC_DIR_KEY) as { value: string } | undefined;
    this.cachedMusicDir = row?.value ? path.resolve(row.value) : null;
  }

  getMusicDir(): string {
    return this.cachedMusicDir ?? this.defaultMusicDir;
  }

  isMusicDirOverridden(): boolean {
    return this.cachedMusicDir !== null && this.cachedMusicDir !== this.defaultMusicDir;
  }

  getSettings(): SystemSettingsResponse {
    const musicDir = this.getMusicDir();
    return {
      musicDir,
      defaultMusicDir: this.defaultMusicDir,
      musicDirExists: fs.existsSync(musicDir) && fs.statSync(musicDir).isDirectory(),
      isOverridden: this.isMusicDirOverridden(),
      downloadsDir: this.downloadsDir,
    };
  }

  setMusicDir(rawPath: string): SystemSettingsResponse {
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

    const now = Date.now();
    this.dbContext.sqlite
      .prepare(
        `
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      )
      .run(MUSIC_DIR_KEY, resolved, now);

    this.cachedMusicDir = resolved;
    return this.getSettings();
  }

  async browseDirectories(rawPath?: string): Promise<BrowseDirectoriesResponse> {
    const activeMusicDir = this.getMusicDir();
    const homeDir = os.homedir();

    // Build handy shortcut buttons that actually exist on this host
    const candidateQuickPaths: Array<{ label: string; path: string }> = [
      { label: "Current Music Dir", path: activeMusicDir },
      { label: "Home", path: homeDir },
      { label: "Music", path: path.join(homeDir, "Music") },
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
