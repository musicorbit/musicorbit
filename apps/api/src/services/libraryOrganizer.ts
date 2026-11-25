import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type {
  OrganizeApplyResponse,
  OrganizePreviewResponse,
  OrganizeTrackPlanItem,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { ActivityLogService } from "./activityLog.js";
import {
  formatTrackRelativePath,
  getMissingOrganizationTagReason,
} from "./libraryLayout.js";
import type { PlaylistSyncService } from "./playlistSync.js";
import type { SettingsService } from "./settings.js";

const OS_JUNK_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const DEFAULT_STABILITY_WINDOW_MS = 10_000;

interface IndexedTrackForOrganize {
  id: number;
  title: string;
  albumId: number;
  albumTitle: string;
  albumYear: number | null;
  albumArtistName: string;
  trackArtistName: string;
  trackNumber: number | null;
  discNumber: number | null;
  filePath: string;
}

export interface LibraryOrganizerDeps {
  dbContext: DbContext;
  settingsService: SettingsService;
  playlistSync?: PlaylistSyncService;
  activityLog?: ActivityLogService;
  logger?: FastifyBaseLogger;
}

export interface OrganizeOptions {
  trackIds?: number[];
  requireStableFiles?: boolean;
  stabilityWindowMs?: number;
}

function isOsJunkFile(name: string): boolean {
  const lower = name.toLowerCase();
  return OS_JUNK_FILES.has(lower) || lower.startsWith("._");
}

function normalizeSongKeyPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildSongDuplicateKey(artist: string, title: string): string | null {
  const normArtist = normalizeSongKeyPart(artist);
  const normTitle = normalizeSongKeyPart(title);
  if (!normArtist || !normTitle) return null;
  if (normArtist === "unknown artist" || normTitle === "untitled") return null;
  return `${normArtist}::${normTitle}`;
}

async function isEffectivelyEmptyDir(dir: string, depth = 0): Promise<boolean> {
  if (depth > 8) return false;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      if (!isOsJunkFile(entry.name)) return false;
    } else if (entry.isDirectory()) {
      const childEmpty = await isEffectivelyEmptyDir(path.join(dir, entry.name), depth + 1);
      if (!childEmpty) return false;
    } else {
      return false;
    }
  }
  return true;
}

async function deleteEffectivelyEmptyTree(dir: string, depth = 0): Promise<void> {
  if (depth > 8) return;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && isOsJunkFile(entry.name)) {
      await fsp.unlink(full).catch(() => {});
    } else if (entry.isDirectory()) {
      await deleteEffectivelyEmptyTree(full, depth + 1);
    }
  }
  await fsp.rmdir(dir);
}

function isInsideDir(filePath: string, dirPath: string): boolean {
  const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function toPosixRelative(baseDir: string, fullPath: string): string {
  return path.relative(path.resolve(baseDir), path.resolve(fullPath)).split(path.sep).join("/");
}

async function moveFileHandlingCaseAndExdev(src: string, dest: string): Promise<void> {
  const resolvedSrc = path.resolve(src);
  const resolvedDest = path.resolve(dest);
  if (resolvedSrc === resolvedDest) return;

  await fsp.mkdir(path.dirname(resolvedDest), { recursive: true });

  // Handle case-only renames on case-insensitive filesystems (macOS APFS / Windows NTFS)
  if (resolvedSrc.toLowerCase() === resolvedDest.toLowerCase()) {
    const tempPath = `${resolvedSrc}.musicorbit-rename-${Date.now()}`;
    await fsp.rename(resolvedSrc, tempPath);
    try {
      await fsp.rename(tempPath, resolvedDest);
    } catch (err) {
      await fsp.rename(tempPath, resolvedSrc).catch(() => {});
      throw err;
    }
    return;
  }

  try {
    await fsp.rename(resolvedSrc, resolvedDest);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EXDEV") {
      await fsp.copyFile(resolvedSrc, resolvedDest);
      await fsp.unlink(resolvedSrc);
    } else {
      throw err;
    }
  }
}

async function removeEmptyDirUpTo(dir: string, stopAt: string): Promise<void> {
  let current = path.resolve(dir);
  const boundary = path.resolve(stopAt);
  while (current !== boundary && current.startsWith(`${boundary}${path.sep}`)) {
    try {
      const empty = await isEffectivelyEmptyDir(current);
      if (!empty) break;
      await deleteEffectivelyEmptyTree(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

/**
 * Dry-run planner and playlist-safe executor for organizing files inside MUSIC_DIR
 * according to the user's chosen LibraryOrganizationSettings.
 */
export class LibraryOrganizer {
  private readonly dbContext: DbContext;
  private readonly settingsService: SettingsService;
  private readonly playlistSync?: PlaylistSyncService;
  private readonly activityLog?: ActivityLogService;
  private readonly logger?: FastifyBaseLogger;
  private lastSkippedLogSignature: string | null = null;

  constructor(deps: LibraryOrganizerDeps) {
    this.dbContext = deps.dbContext;
    this.settingsService = deps.settingsService;
    this.playlistSync = deps.playlistSync;
    this.activityLog = deps.activityLog;
    this.logger = deps.logger;
  }

  private loadIndexedTracks(): IndexedTrackForOrganize[] {
    return this.dbContext.sqlite
      .prepare(
        `
        SELECT
          t.id,
          t.title,
          t.album_id AS albumId,
          al.title AS albumTitle,
          al.year AS albumYear,
          alb_ar.name AS albumArtistName,
          trk_ar.name AS trackArtistName,
          t.track_number AS trackNumber,
          t.disc_number AS discNumber,
          t.file_path AS filePath
        FROM tracks t
        JOIN albums al ON al.id = t.album_id
        JOIN artists alb_ar ON alb_ar.id = al.artist_id
        JOIN artists trk_ar ON trk_ar.id = t.artist_id
        ORDER BY lower(alb_ar.sort_name) ASC, lower(al.title) ASC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, t.id ASC
      `,
      )
      .all() as IndexedTrackForOrganize[];
  }

  /**
   * Computes a non-destructive preview of every file move/skip/conflict in MUSIC_DIR.
   */
  async preview(options?: OrganizeOptions): Promise<OrganizePreviewResponse> {
    const musicDir = this.settingsService.getMusicDir();
    const orgSettings = this.settingsService.getLibraryOrganizationSettings();
    const playlistsDir = this.settingsService.getPlaylistSyncSettings().playlistsDir;
    const rows = this.loadIndexedTracks();
    const stabilityWindowMs = options?.stabilityWindowMs ?? DEFAULT_STABILITY_WINDOW_MS;
    const now = Date.now();

    // Determine multi-disc albums from indexed tracks
    const discsByAlbum = new Map<number, Set<number>>();
    for (const row of rows) {
      const set = discsByAlbum.get(row.albumId) ?? new Set<number>();
      if (row.discNumber && row.discNumber > 0) {
        set.add(row.discNumber);
      } else {
        set.add(1);
      }
      discsByAlbum.set(row.albumId, set);
    }

    const items: OrganizeTrackPlanItem[] = [];
    const plannedTargets = new Map<string, string>(); // lowercased target path -> relative path
    const claimedSongs = new Map<string, string>(); // normalized "artist::title" -> relative path

    let toMoveCount = 0;
    let alreadyOrganizedCount = 0;
    let skippedUntaggedCount = 0;
    let conflictCount = 0;

    interface PreparedTrack {
      row: IndexedTrackForOrganize;
      currentPath: string;
      currentRelativePath: string;
      stat: fs.Stats;
      missingReason: string | null;
      targetPath: string | null;
      targetRelativePath: string;
      songKey: string | null;
    }

    const prepared: PreparedTrack[] = [];

    for (const row of rows) {
      const currentPath = path.resolve(row.filePath);
      if (!isInsideDir(currentPath, musicDir)) continue;
      if (isInsideDir(currentPath, playlistsDir)) continue;

      let stat: fs.Stats;
      try {
        stat = await fsp.stat(currentPath);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }

      const currentRelativePath = toPosixRelative(musicDir, currentPath);

      if (orgSettings.layoutPreset === "keep_existing") {
        alreadyOrganizedCount += 1;
        continue;
      }

      const ext = path.extname(currentPath).toLowerCase();
      const hasMultipleDiscs = (discsByAlbum.get(row.albumId)?.size ?? 1) > 1;
      const layoutInput = {
        albumArtist: row.albumArtistName,
        trackArtist: row.trackArtistName,
        album: row.albumTitle,
        title: row.title,
        year: row.albumYear,
        trackNumber: row.trackNumber,
        discNumber: row.discNumber,
        hasMultipleDiscs,
        extension: ext,
      };

      const missingReason = getMissingOrganizationTagReason(layoutInput, orgSettings.layoutPreset);
      const relTarget = missingReason ? null : formatTrackRelativePath(layoutInput, orgSettings);
      const targetPath = relTarget ? path.resolve(musicDir, relTarget) : null;
      const targetRelativePath = targetPath
        ? toPosixRelative(musicDir, targetPath)
        : currentRelativePath;
      const songKey = buildSongDuplicateKey(
        row.trackArtistName || row.albumArtistName,
        row.title,
      );

      prepared.push({
        row,
        currentPath,
        currentRelativePath,
        stat,
        missingReason,
        targetPath,
        targetRelativePath,
        songKey,
      });
    }

    // Pass 1: Register already-organized tracks FIRST so existing library tracks always win over
    // newly dropped loose duplicates (even if the duplicate carries a slightly different edition tag).
    const pending: PreparedTrack[] = [];
    for (const entry of prepared) {
      if (!entry.missingReason && entry.targetPath && entry.currentPath === entry.targetPath) {
        alreadyOrganizedCount += 1;
        plannedTargets.set(entry.targetPath.toLowerCase(), entry.currentRelativePath);
        if (entry.songKey && !claimedSongs.has(entry.songKey)) {
          claimedSongs.set(entry.songKey, entry.currentRelativePath);
        }
      } else {
        pending.push(entry);
      }
    }

    // Pass 2: Evaluate unorganized tracks in stable creation order (oldest track ID first)
    pending.sort((a, b) => a.row.id - b.row.id);

    for (const entry of pending) {
      const { row, currentPath, currentRelativePath, stat, missingReason, targetPath, targetRelativePath, songKey } =
        entry;

      if (options?.requireStableFiles && now - stat.mtimeMs < stabilityWindowMs) {
        continue;
      }

      if (missingReason) {
        skippedUntaggedCount += 1;
        items.push({
          trackId: row.id,
          title: row.title,
          artistName: row.albumArtistName,
          albumTitle: row.albumTitle,
          currentPath,
          currentRelativePath,
          targetPath: currentPath,
          targetRelativePath: currentRelativePath,
          status: "skipped_untagged",
          reason: missingReason,
        });
        continue;
      }

      if (!targetPath) {
        alreadyOrganizedCount += 1;
        continue;
      }

      const targetKey = targetPath.toLowerCase();
      const isCaseOnlyRename = currentPath.toLowerCase() === targetKey;

      // Conflict check 1: another track in this pass already claimed the exact destination path
      if (plannedTargets.has(targetKey)) {
        conflictCount += 1;
        items.push({
          trackId: row.id,
          title: row.title,
          artistName: row.albumArtistName,
          albumTitle: row.albumTitle,
          currentPath,
          currentRelativePath,
          targetPath,
          targetRelativePath,
          status: "conflict",
          reason: `Another track in your library already uses "${targetRelativePath}".`,
        });
        continue;
      }

      // Conflict check 2: a different file already exists at the destination on disk
      if (!isCaseOnlyRename && fs.existsSync(targetPath)) {
        conflictCount += 1;
        items.push({
          trackId: row.id,
          title: row.title,
          artistName: row.albumArtistName,
          albumTitle: row.albumTitle,
          currentPath,
          currentRelativePath,
          targetPath,
          targetRelativePath,
          status: "conflict",
          reason: `Destination already exists on disk ("${targetRelativePath}").`,
        });
        continue;
      }

      // Conflict check 3: logical duplicate song (same artist + title already in library, e.g. different edition tag)
      const existingSongPath = songKey ? claimedSongs.get(songKey) : undefined;
      if (existingSongPath) {
        conflictCount += 1;
        items.push({
          trackId: row.id,
          title: row.title,
          artistName: row.albumArtistName,
          albumTitle: row.albumTitle,
          currentPath,
          currentRelativePath,
          targetPath,
          targetRelativePath,
          status: "conflict",
          reason: `Duplicate song — already in library as "${existingSongPath}".`,
        });
        continue;
      }

      plannedTargets.set(targetKey, targetRelativePath);
      if (songKey) {
        claimedSongs.set(songKey, targetRelativePath);
      }
      toMoveCount += 1;
      items.push({
        trackId: row.id,
        title: row.title,
        artistName: row.albumArtistName,
        albumTitle: row.albumTitle,
        currentPath,
        currentRelativePath,
        targetPath,
        targetRelativePath,
        status: "move",
      });
    }

    // Order preview items cleanly: moves first, then conflicts, then skipped_untagged
    const orderRank = { move: 0, conflict: 1, skipped_untagged: 2, already_organized: 3 };
    items.sort((a, b) => orderRank[a.status] - orderRank[b.status]);

    return {
      musicDir,
      layoutPreset: orgSettings.layoutPreset,
      totalTracks: toMoveCount + alreadyOrganizedCount + skippedUntaggedCount + conflictCount,
      toMoveCount,
      alreadyOrganizedCount,
      skippedUntaggedCount,
      conflictCount,
      items,
    };
  }

  /**
   * Executes all safe, non-conflicting moves in MUSIC_DIR, updates SQLite file paths
   * in-place (preserving track IDs & playlist links), cleans up empty folders, and
   * re-syncs .m3u8 playlists if enabled.
   */
  async apply(options?: OrganizeOptions): Promise<OrganizeApplyResponse> {
    const plan = await this.preview({
      requireStableFiles: options?.requireStableFiles,
      stabilityWindowMs: options?.stabilityWindowMs,
    });

    const allowedIds = options?.trackIds ? new Set(options.trackIds) : null;
    const moves = plan.items.filter(
      (item) => item.status === "move" && (!allowedIds || allowedIds.has(item.trackId)),
    );

    const updateTrackPathStmt = this.dbContext.sqlite.prepare(
      "UPDATE tracks SET file_path = ?, file_mtime_ms = ?, updated_at = ? WHERE id = ?",
    );

    let movedCount = 0;
    const errors: string[] = [];

    for (const item of moves) {
      try {
        const oldDir = path.dirname(item.currentPath);
        await moveFileHandlingCaseAndExdev(item.currentPath, item.targetPath);

        const stat = await fsp.stat(item.targetPath);
        updateTrackPathStmt.run(
          item.targetPath,
          Math.floor(stat.mtimeMs),
          Date.now(),
          item.trackId,
        );

        await removeEmptyDirUpTo(oldDir, plan.musicDir);
        movedCount += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${item.currentRelativePath}: ${msg}`);
        this.logger?.warn({ err, trackId: item.trackId }, "Failed to organize track");
      }
    }

    let playlistsResynced = false;
    if (movedCount > 0) {
      if (this.playlistSync && this.settingsService.getPlaylistSyncSettings().enabled) {
        try {
          await this.playlistSync.syncAllPlaylists();
          playlistsResynced = true;
        } catch (err) {
          this.logger?.warn({ err }, "Failed to re-sync playlists after organizing library");
        }
      }

      this.activityLog?.success(
        "organizer",
        `Organized ${movedCount} ${movedCount === 1 ? "track" : "tracks"} into "${plan.layoutPreset}" layout`,
        {
          layoutPreset: plan.layoutPreset,
          movedCount,
          skippedCount: plan.skippedUntaggedCount,
          conflictCount: plan.conflictCount,
          errorCount: errors.length,
          playlistsResynced,
        },
      );
    }

    // Surface skipped conflicts / missing-tag files once in Activity Logs so dropped files
    // that cannot be auto-organized never look mysteriously ignored
    const skippedItems = plan.items.filter(
      (i) => i.status === "conflict" || i.status === "skipped_untagged",
    );
    if (skippedItems.length > 0) {
      const signature = skippedItems
        .map((i) => `${i.status}:${i.currentRelativePath}:${i.reason ?? ""}`)
        .sort()
        .join("|");
      if (signature !== this.lastSkippedLogSignature) {
        this.lastSkippedLogSignature = signature;
        const sample = skippedItems[0]!;
        const summary =
          skippedItems.length === 1
            ? `Skipped organizing "${sample.currentRelativePath}": ${sample.reason ?? sample.status}`
            : `Skipped organizing ${skippedItems.length} files (${plan.conflictCount} conflicts, ${plan.skippedUntaggedCount} missing tags)`;
        this.activityLog?.warn("organizer", summary, {
          layoutPreset: plan.layoutPreset,
          items: skippedItems.slice(0, 15).map((i) => ({
            file: i.currentRelativePath,
            status: i.status,
            reason: i.reason,
          })),
        });
      }
    } else {
      this.lastSkippedLogSignature = null;
    }

    return {
      movedCount,
      alreadyOrganizedCount: plan.alreadyOrganizedCount,
      skippedCount: plan.skippedUntaggedCount,
      conflictCount: plan.conflictCount,
      errorCount: errors.length,
      errors,
      playlistsResynced,
    };
  }
}
