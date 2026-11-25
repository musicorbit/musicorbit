import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { parseFile } from "music-metadata";
import type { FastifyBaseLogger } from "fastify";
import type { ScanStatusResponse } from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import { albums, artists, scanJobs, tracks } from "../db/schema.js";
import type { ActivityLogService } from "./activityLog.js";

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".flac",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
]);

const FOLDER_COVER_NAMES = [
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "cover.webp",
  "folder.jpg",
  "folder.jpeg",
  "folder.png",
  "front.jpg",
  "front.jpeg",
  "front.png",
];

const IGNORED_DIRS = new Set(["@eaDir", ".Spotlight-V100", ".Trashes", "__MACOSX"]);
const MAX_RECORDED_ERRORS = 50;

interface DiscoveredFile {
  filePath: string;
  size: number;
  mtimeMs: number;
}

/**
 * Generates a sort-friendly artist name:
 * "The Beatles" -> "Beatles, The"
 */
export function makeSortName(name: string): string {
  const trimmed = name.trim();
  const match = /^(the|a|an)\s+(.+)$/i.exec(trimmed);
  if (match && match[1] && match[2]) {
    return `${match[2]}, ${match[1]}`;
  }
  return trimmed;
}

function extensionForMime(mime?: string): string {
  switch (mime?.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/jpeg":
    case "image/jpg":
    default:
      return "jpg";
  }
}

/**
 * Hashes cover bytes with SHA-256 and stores them once in coversDir.
 * Identical covers across tracks of the same album reuse the same cached file.
 */
async function cacheCoverArt(
  coversDir: string,
  bytes: Uint8Array,
  ext: string,
): Promise<string> {
  await fsp.mkdir(coversDir, { recursive: true });
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const fileName = `${hash}.${ext}`;
  const dest = path.join(coversDir, fileName);

  if (!fs.existsSync(dest)) {
    await fsp.writeFile(dest, bytes);
  }
  return fileName;
}

/**
 * Recursively discovers supported audio files under rootDir.
 */
async function discoverAudioFiles(rootDir: string): Promise<DiscoveredFile[]> {
  const found: DiscoveredFile[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
          continue;
        }
        const stat = await fsp.stat(fullPath);
        found.push({
          filePath: fullPath,
          size: stat.size,
          mtimeMs: Math.trunc(stat.mtimeMs),
        });
      }
    }
  }

  await walk(rootDir);
  found.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return found;
}

async function findFolderCover(
  dir: string,
  coversDir: string,
  dirCache: Map<string, string | null>,
): Promise<string | null> {
  if (dirCache.has(dir)) {
    return dirCache.get(dir) ?? null;
  }

  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    dirCache.set(dir, null);
    return null;
  }

  const lowerToActual = new Map<string, string>();
  for (const name of entries) {
    lowerToActual.set(name.toLowerCase(), name);
  }

  for (const candidate of FOLDER_COVER_NAMES) {
    const actual = lowerToActual.get(candidate);
    if (!actual) continue;
    try {
      const fullPath = path.join(dir, actual);
      const bytes = await fsp.readFile(fullPath);
      const ext = path.extname(actual).slice(1).toLowerCase() || "jpg";
      const normalizedExt = ext === "jpeg" ? "jpg" : ext;
      const hashName = await cacheCoverArt(coversDir, bytes, normalizedExt);
      dirCache.set(dir, hashName);
      return hashName;
    } catch {
      // Ignore unreadable cover files and keep scanning
    }
  }

  dirCache.set(dir, null);
  return null;
}

export interface LibraryScannerDeps {
  dbContext: DbContext;
  musicDir: string;
  getMusicDir?: () => string;
  coversDir: string;
  activityLog?: ActivityLogService;
  logger?: FastifyBaseLogger;
}

export class LibraryScanner {
  private readonly dbContext: DbContext;
  private readonly getMusicDirFn: () => string;
  private readonly coversDir: string;
  private readonly activityLog?: ActivityLogService;
  private readonly logger?: FastifyBaseLogger;
  private activePromise: Promise<ScanStatusResponse> | null = null;
  private currentStatus: ScanStatusResponse | null = null;
  private onTracksAddedCallback?: (addedTrackIds: number[]) => void;

  constructor(deps: LibraryScannerDeps) {
    this.dbContext = deps.dbContext;
    this.getMusicDirFn = deps.getMusicDir ?? (() => deps.musicDir);
    this.coversDir = deps.coversDir;
    this.activityLog = deps.activityLog;
    this.logger = deps.logger;
  }

  setOnTracksAdded(cb: (addedTrackIds: number[]) => void): void {
    this.onTracksAddedCallback = cb;
  }

  private get musicDir(): string {
    return this.getMusicDirFn();
  }

  /**
   * Returns live progress if a scan is running, or the latest completed scan from SQLite.
   */
  getStatus(): ScanStatusResponse {
    if (this.currentStatus) {
      return { ...this.currentStatus, errors: [...this.currentStatus.errors] };
    }

    const lastJob = this.dbContext.db
      .select()
      .from(scanJobs)
      .orderBy(desc(scanJobs.id))
      .limit(1)
      .get();

    if (!lastJob) {
      return {
        state: "idle",
        jobId: null,
        startedAt: null,
        finishedAt: null,
        filesTotal: 0,
        filesProcessed: 0,
        filesAdded: 0,
        filesUpdated: 0,
        filesSkipped: 0,
        filesRemoved: 0,
        errors: [],
      };
    }

    const state =
      lastJob.status === "completed" || lastJob.status === "failed"
        ? lastJob.status
        : "idle";

    return {
      state,
      jobId: lastJob.id,
      startedAt: lastJob.startedAt.toISOString(),
      finishedAt: lastJob.finishedAt ? lastJob.finishedAt.toISOString() : null,
      filesTotal: lastJob.filesTotal,
      filesProcessed: lastJob.filesProcessed,
      filesAdded: lastJob.filesAdded,
      filesUpdated: lastJob.filesUpdated,
      filesSkipped: lastJob.filesSkipped,
      filesRemoved: lastJob.filesRemoved,
      errors: lastJob.errorMessage ? [lastJob.errorMessage] : [],
    };
  }

  /**
   * Starts a background scan if one is not already running.
   */
  startScan(options?: { force?: boolean }): {
    started: boolean;
    status: ScanStatusResponse;
  } {
    if (this.activePromise) {
      return { started: false, status: this.getStatus() };
    }

    const promise = this.runScan(options);
    // Prevent unhandled rejection warnings when triggered fire-and-forget from an HTTP route
    promise.catch(() => {});
    return { started: true, status: this.getStatus() };
  }

  /**
   * Runs a full or incremental scan and resolves when finished.
   */
  async runScan(options?: {
    force?: boolean;
    quietIfNoChanges?: boolean;
    skipPostScanHooks?: boolean;
  }): Promise<ScanStatusResponse> {
    if (this.activePromise) {
      return this.activePromise;
    }

    const force = Boolean(options?.force);
    const quietIfNoChanges = Boolean(options?.quietIfNoChanges);
    const skipPostScanHooks = Boolean(options?.skipPostScanHooks);
    const startedAt = new Date();
    const inserted = this.dbContext.db
      .insert(scanJobs)
      .values({
        status: "running",
        startedAt,
      })
      .returning({ id: scanJobs.id })
      .get();

    const jobId = inserted.id;
    const status: ScanStatusResponse = {
      state: "running",
      jobId,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      filesTotal: 0,
      filesProcessed: 0,
      filesAdded: 0,
      filesUpdated: 0,
      filesSkipped: 0,
      filesRemoved: 0,
      errors: [],
    };
    this.currentStatus = status;

    this.activePromise = (async () => {
      try {
        if (!fs.existsSync(this.musicDir)) {
          throw new Error(`Music directory does not exist: ${this.musicDir}`);
        }

        const discovered = await discoverAudioFiles(this.musicDir);
        status.filesTotal = discovered.length;

        // Snapshot existing tracks for fast O(1) incremental diffing
        const existingRows = this.dbContext.db
          .select({
            id: tracks.id,
            filePath: tracks.filePath,
            fileSize: tracks.fileSize,
            fileMtimeMs: tracks.fileMtimeMs,
          })
          .from(tracks)
          .all();

        const existingByPath = new Map(existingRows.map((row) => [row.filePath, row]));
        const seenPaths = new Set<string>();
        const folderCoverCache = new Map<string, string | null>();
        const addedTrackIds: number[] = [];

        for (const file of discovered) {
          seenPaths.add(file.filePath);
          const existing = existingByPath.get(file.filePath);

          // Incremental skip: unchanged size + mtime means no need to re-parse audio tags
          if (
            !force &&
            existing &&
            existing.fileSize === file.size &&
            existing.fileMtimeMs === file.mtimeMs
          ) {
            status.filesSkipped += 1;
            status.filesProcessed += 1;
            continue;
          }

          try {
            const trackId = await this.indexFile(file, existing?.id ?? null, folderCoverCache);
            if (existing) {
              status.filesUpdated += 1;
            } else {
              status.filesAdded += 1;
              if (trackId !== null) addedTrackIds.push(trackId);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const rel = path.relative(this.musicDir, file.filePath);
            this.logger?.warn({ err, file: rel }, "Failed to index audio file");
            if (status.errors.length < MAX_RECORDED_ERRORS) {
              status.errors.push(`${rel}: ${msg}`);
            }
          }

          status.filesProcessed += 1;
        }

        // Prune tracks whose files were deleted or moved out of MUSIC_DIR
        const missingIds = existingRows
          .filter((row) => !seenPaths.has(row.filePath))
          .map((row) => row.id);

        if (missingIds.length > 0) {
          // Delete in chunks to stay comfortably below SQLite's bind parameter limit
          for (let i = 0; i < missingIds.length; i += 500) {
            const chunk = missingIds.slice(i, i + 500);
            this.dbContext.db.delete(tracks).where(inArray(tracks.id, chunk)).run();
          }
          status.filesRemoved = missingIds.length;
        }

        this.pruneOrphans();

        status.state = "completed";
        status.finishedAt = new Date().toISOString();
        this.persistJob(status);
        const hasChanges =
          status.filesAdded > 0 ||
          status.filesUpdated > 0 ||
          status.filesRemoved > 0 ||
          status.errors.length > 0;
        if (!quietIfNoChanges || hasChanges) {
          this.activityLog?.log(
            status.errors.length > 0 ? "warn" : "success",
            "scanner",
            `${force ? "Full" : "Library"} scan completed: ${status.filesAdded} added, ${status.filesUpdated} updated, ${status.filesRemoved} removed, ${status.filesSkipped} unchanged`,
            {
              musicDir: this.musicDir,
              total: status.filesTotal,
              added: status.filesAdded,
              updated: status.filesUpdated,
              removed: status.filesRemoved,
              skipped: status.filesSkipped,
              errors: status.errors.length,
            },
          );
        }
        if (!skipPostScanHooks && addedTrackIds.length > 0 && this.onTracksAddedCallback) {
          try {
            this.onTracksAddedCallback(addedTrackIds);
          } catch {
            // Non-fatal hook error
          }
        }
        return this.getStatus();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        status.state = "failed";
        status.finishedAt = new Date().toISOString();
        if (status.errors.length < MAX_RECORDED_ERRORS) {
          status.errors.push(msg);
        }
        this.persistJob(status, msg);
        this.activityLog?.error("scanner", `Library scan failed: ${msg}`, {
          musicDir: this.musicDir,
        });
        return this.getStatus();
      } finally {
        this.activePromise = null;
      }
    })();

    return this.activePromise;
  }

  private async indexFile(
    file: DiscoveredFile,
    existingTrackId: number | null,
    folderCoverCache: Map<string, string | null>,
  ): Promise<number | null> {
    const metadata = await parseFile(file.filePath, { duration: true });
    const { common, format } = metadata;

    const fallbackTitle = path.basename(file.filePath, path.extname(file.filePath));
    const parentDir = path.dirname(file.filePath);
    const parentFolderName = path.basename(parentDir);

    const title = common.title?.trim() || fallbackTitle;
    const trackArtistName =
      common.artist?.trim() || common.albumartist?.trim() || "Unknown Artist";
    // Group albums by Album Artist so compilations / featured tracks stay in one album
    const albumArtistName =
      common.albumartist?.trim() || common.artist?.trim() || "Unknown Artist";
    const albumTitle =
      common.album?.trim() ||
      (parentDir !== this.musicDir ? parentFolderName : "Unknown Album");

    // Extract cover art: embedded picture takes precedence over folder cover file
    let coverHash: string | null = null;
    const embeddedPicture = common.picture?.[0];
    if (embeddedPicture && embeddedPicture.data.length > 0) {
      coverHash = await cacheCoverArt(
        this.coversDir,
        embeddedPicture.data,
        extensionForMime(embeddedPicture.format),
      );
    } else {
      coverHash = await findFolderCover(parentDir, this.coversDir, folderCoverCache);
    }

    const now = new Date();
    const albumArtistId = this.upsertArtist(
      albumArtistName,
      common.musicbrainz_artistid?.[0] ?? null,
      now,
    );
    const trackArtistId =
      trackArtistName === albumArtistName
        ? albumArtistId
        : this.upsertArtist(trackArtistName, null, now);

    const year = common.year && common.year > 0 ? common.year : null;
    const genre = common.genre?.[0]?.trim() || null;
    const albumId = this.upsertAlbum(
      {
        title: albumTitle,
        artistId: albumArtistId,
        year,
        genre,
        coverHash,
        mbid: common.musicbrainz_albumid ?? null,
      },
      now,
    );

    const codec = format.codec ?? format.container ?? null;
    const bitrate = format.bitrate ? Math.round(format.bitrate) : null;
    const sampleRate = format.sampleRate ? Math.round(format.sampleRate) : null;
    const durationSeconds = format.duration ?? null;
    const trackNumber = common.track.no ?? null;
    const discNumber = common.disk.no ?? null;
    const trackMbid = common.musicbrainz_recordingid ?? null;

    if (existingTrackId !== null) {
      this.dbContext.db
        .update(tracks)
        .set({
          title,
          albumId,
          artistId: trackArtistId,
          trackNumber,
          discNumber,
          durationSeconds,
          codec,
          bitrate,
          sampleRate,
          fileSize: file.size,
          fileMtimeMs: file.mtimeMs,
          mbid: trackMbid,
          updatedAt: now,
        })
        .where(eq(tracks.id, existingTrackId))
        .run();
      return existingTrackId;
    } else {
      const inserted = this.dbContext.db
        .insert(tracks)
        .values({
          title,
          albumId,
          artistId: trackArtistId,
          trackNumber,
          discNumber,
          durationSeconds,
          codec,
          bitrate,
          sampleRate,
          filePath: file.filePath,
          fileSize: file.size,
          fileMtimeMs: file.mtimeMs,
          mbid: trackMbid,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: tracks.id })
        .get();
      return inserted?.id ?? null;
    }
  }

  private upsertArtist(name: string, mbid: string | null, now: Date): number {
    const existing = this.dbContext.db
      .select({ id: artists.id, mbid: artists.mbid })
      .from(artists)
      .where(eq(artists.name, name))
      .get();

    if (existing) {
      if (mbid && !existing.mbid) {
        this.dbContext.db
          .update(artists)
          .set({ mbid, updatedAt: now })
          .where(eq(artists.id, existing.id))
          .run();
      }
      return existing.id;
    }

    const inserted = this.dbContext.db
      .insert(artists)
      .values({
        name,
        sortName: makeSortName(name),
        mbid,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: artists.id })
      .get();

    return inserted.id;
  }

  private upsertAlbum(
    input: {
      title: string;
      artistId: number;
      year: number | null;
      genre: string | null;
      coverHash: string | null;
      mbid: string | null;
    },
    now: Date,
  ): number {
    const existing = this.dbContext.db
      .select({
        id: albums.id,
        year: albums.year,
        genre: albums.genre,
        coverHash: albums.coverHash,
        mbid: albums.mbid,
      })
      .from(albums)
      .where(and(eq(albums.artistId, input.artistId), eq(albums.title, input.title)))
      .get();

    if (existing) {
      const nextYear = input.year ?? existing.year;
      const nextGenre = input.genre ?? existing.genre;
      const nextCover = input.coverHash ?? existing.coverHash;
      const nextMbid = input.mbid ?? existing.mbid;

      if (
        nextYear !== existing.year ||
        nextGenre !== existing.genre ||
        nextCover !== existing.coverHash ||
        nextMbid !== existing.mbid
      ) {
        this.dbContext.db
          .update(albums)
          .set({
            year: nextYear,
            genre: nextGenre,
            coverHash: nextCover,
            mbid: nextMbid,
            updatedAt: now,
          })
          .where(eq(albums.id, existing.id))
          .run();
      }
      return existing.id;
    }

    const inserted = this.dbContext.db
      .insert(albums)
      .values({
        title: input.title,
        artistId: input.artistId,
        year: input.year,
        genre: input.genre,
        coverHash: input.coverHash,
        mbid: input.mbid,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: albums.id })
      .get();

    return inserted.id;
  }

  /**
   * Removes albums that no longer contain tracks and artists with no albums or tracks.
   */
  private pruneOrphans(): void {
    const activeAlbumIds = this.dbContext.db
      .selectDistinct({ albumId: tracks.albumId })
      .from(tracks)
      .all()
      .map((r) => r.albumId);

    if (activeAlbumIds.length === 0) {
      this.dbContext.db.delete(albums).run();
    } else {
      this.dbContext.db.delete(albums).where(notInArray(albums.id, activeAlbumIds)).run();
    }

    const albumArtistIds = this.dbContext.db
      .selectDistinct({ artistId: albums.artistId })
      .from(albums)
      .all()
      .map((r) => r.artistId);
    const trackArtistIds = this.dbContext.db
      .selectDistinct({ artistId: tracks.artistId })
      .from(tracks)
      .all()
      .map((r) => r.artistId);
    const activeArtistIds = Array.from(new Set([...albumArtistIds, ...trackArtistIds]));

    if (activeArtistIds.length === 0) {
      this.dbContext.db.delete(artists).run();
    } else {
      this.dbContext.db.delete(artists).where(notInArray(artists.id, activeArtistIds)).run();
    }
  }

  private persistJob(status: ScanStatusResponse, errorMessage?: string): void {
    if (status.jobId === null) return;
    this.dbContext.db
      .update(scanJobs)
      .set({
        status: status.state,
        finishedAt: status.finishedAt ? new Date(status.finishedAt) : null,
        filesTotal: status.filesTotal,
        filesProcessed: status.filesProcessed,
        filesAdded: status.filesAdded,
        filesUpdated: status.filesUpdated,
        filesSkipped: status.filesSkipped,
        filesRemoved: status.filesRemoved,
        errorMessage:
          errorMessage ?? (status.errors.length > 0 ? status.errors.join("\n") : null),
      })
      .where(eq(scanJobs.id, status.jobId))
      .run();
  }
}
