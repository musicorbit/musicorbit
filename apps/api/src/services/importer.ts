import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { parseFile } from "music-metadata";
import type { FastifyBaseLogger } from "fastify";
import type {
  ApplyImportResponse,
  ApplyTaggingRequest,
  ImportItemStatus,
  ImportItemSummary,
  ImportSourceFile,
  ImportsListResponse,
  InboxScanResult,
  MusicBrainzReleaseCandidate,
  RetagAlbumResponse,
  RetagTrackOverride,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import { albums, importItems, tracks } from "../db/schema.js";
import type { MusicBrainzClient } from "./musicbrainz.js";
import { SUPPORTED_AUDIO_EXTENSIONS, type LibraryScanner } from "./scanner.js";
import { writeAudioTags } from "./tagWriter.js";

const COVER_IMAGE_NAMES = new Set([
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
]);

export class ImporterError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ImporterError";
    this.statusCode = statusCode;
  }
}

/**
 * Sanitizes an artist, album, or track name for safe cross-platform filesystem paths.
 */
export function sanitizePathSegment(value: string, fallback = "Unknown"): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Extracts best-guess artist, album, and year hints from common Soulseek folder names,
 * e.g. "Daft Punk - Discovery (2001) [FLAC]" -> { artist: "Daft Punk", album: "Discovery", year: 2001 }.
 */
export function parseFolderHints(folderName: string): {
  artist: string | null;
  album: string | null;
  year: number | null;
} {
  let clean = folderName.trim();
  // Strip trailing format/release tags in brackets like [FLAC], [24-96], [WEB]
  clean = clean.replace(/\s*\[[^\]]*\]\s*/g, " ").trim();

  let year: number | null = null;
  const yearMatch = /\((\d{4})\)/.exec(clean);
  if (yearMatch?.[1]) {
    const parsed = Number.parseInt(yearMatch[1], 10);
    if (parsed > 1900 && parsed < 2100) {
      year = parsed;
      clean = clean.replace(yearMatch[0], " ").trim();
    }
  }

  const dashParts = clean.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2 && dashParts[0] && dashParts[1]) {
    return {
      artist: dashParts[0].trim(),
      album: dashParts.slice(1).join(" - ").trim(),
      year,
    };
  }

  return { artist: null, album: clean || null, year };
}

/**
 * Moves a file safely across filesystems (handles Docker EXDEV when /downloads
 * and /music are mounted on different volumes).
 */
async function moveFileSafe(src: string, dest: string): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "EXDEV") throw err;
    await fsp.copyFile(src, dest);
    await fsp.unlink(src);
  }
}

/**
 * Removes empty directories up to (but never including) stopDir.
 */
async function removeEmptyDir(dir: string, stopDir: string): Promise<void> {
  const resolvedStop = path.resolve(stopDir);
  let current = path.resolve(dir);
  while (current !== resolvedStop && current.startsWith(resolvedStop + path.sep)) {
    try {
      const remaining = await fsp.readdir(current);
      if (remaining.length > 0) break;
      await fsp.rmdir(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

/**
 * Finds all directories inside downloadsDir that directly contain at least one audio file.
 */
async function discoverInboxFolders(downloadsDir: string): Promise<Map<string, string[]>> {
  const folderMap = new Map<string, string[]>();

  async function walk(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const audioFiles: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
          audioFiles.push(fullPath);
        }
      }
    }

    if (audioFiles.length > 0) {
      audioFiles.sort((a, b) => a.localeCompare(b));
      folderMap.set(dir, audioFiles);
    }
  }

  await walk(downloadsDir);
  return folderMap;
}

function mostCommonString(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = raw?.trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [val, cnt] of counts.entries()) {
    if (cnt > bestCount) {
      best = val;
      bestCount = cnt;
    }
  }
  return best;
}

function formatTrackFilename(
  trackNumber: number | null,
  discNumber: number | null,
  hasMultipleDiscs: boolean,
  title: string,
  ext: string,
): string {
  const safeTitle = sanitizePathSegment(title, "Untitled");
  const numPart =
    trackNumber !== null && trackNumber > 0 ? String(trackNumber).padStart(2, "0") : null;
  const discPrefix = hasMultipleDiscs && discNumber ? `${discNumber}-` : "";
  return numPart ? `${discPrefix}${numPart} - ${safeTitle}${ext}` : `${safeTitle}${ext}`;
}

export interface LibraryImporterDeps {
  dbContext: DbContext;
  musicDir: string;
  getMusicDir?: () => string;
  downloadsDir: string;
  autoImportThreshold: number;
  musicBrainz: MusicBrainzClient;
  scanner: LibraryScanner;
  logger?: FastifyBaseLogger;
}

export class LibraryImporter {
  private readonly dbContext: DbContext;
  private readonly getMusicDirFn: () => string;
  private readonly downloadsDir: string;
  private readonly autoImportThreshold: number;
  private readonly musicBrainz: MusicBrainzClient;
  private readonly scanner: LibraryScanner;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: LibraryImporterDeps) {
    this.dbContext = deps.dbContext;
    this.getMusicDirFn = deps.getMusicDir ?? (() => deps.musicDir);
    this.downloadsDir = deps.downloadsDir;
    this.autoImportThreshold = deps.autoImportThreshold;
    this.musicBrainz = deps.musicBrainz;
    this.scanner = deps.scanner;
    this.logger = deps.logger;
  }

  private get musicDir(): string {
    return this.getMusicDirFn();
  }

  listItems(statusFilter?: ImportItemStatus): ImportsListResponse {
    const rows = statusFilter
      ? this.dbContext.db
          .select()
          .from(importItems)
          .where(eq(importItems.status, statusFilter))
          .orderBy(desc(importItems.updatedAt))
          .all()
      : this.dbContext.db.select().from(importItems).orderBy(desc(importItems.updatedAt)).all();

    const items: ImportItemSummary[] = rows.map((row) => ({
      id: row.id,
      sourceDir: row.sourceDir,
      folderName: row.folderName,
      status: row.status as ImportItemStatus,
      detectedArtist: row.detectedArtist,
      detectedAlbum: row.detectedAlbum,
      detectedYear: row.detectedYear,
      trackCount: row.trackCount,
      confidence: row.confidence,
      matchedMbid: row.matchedMbid,
      matchedArtist: row.matchedArtist,
      matchedAlbum: row.matchedAlbum,
      matchedYear: row.matchedYear,
      matchedCoverUrl: row.matchedCoverUrl,
      candidates: this.safeParseJson<MusicBrainzReleaseCandidate[]>(row.candidatesJson, []),
      files: this.safeParseJson<ImportSourceFile[]>(row.filesJson, []),
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    const needsReviewRow = this.dbContext.sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM import_items WHERE status = 'needs_review'")
      .get() as { cnt: number } | undefined;

    return {
      downloadsDir: {
        path: this.downloadsDir,
        exists: fs.existsSync(this.downloadsDir),
      },
      needsReviewCount: needsReviewRow?.cnt ?? 0,
      items,
    };
  }

  /**
   * Scans DOWNLOADS_DIR for album folders, looks up MusicBrainz candidates,
   * auto-imports high-confidence exact matches, and queues uncertain ones for review.
   */
  async scanInbox(): Promise<InboxScanResult> {
    if (!fs.existsSync(this.downloadsDir)) {
      return { discoveredFolders: 0, autoImported: 0, needsReview: 0, skipped: 0, failed: 0 };
    }

    const folders = await discoverInboxFolders(this.downloadsDir);
    const result: InboxScanResult = {
      discoveredFolders: folders.size,
      autoImported: 0,
      needsReview: 0,
      skipped: 0,
      failed: 0,
    };

    for (const [folderPath, audioFiles] of folders.entries()) {
      const existing = this.dbContext.db
        .select()
        .from(importItems)
        .where(eq(importItems.sourceDir, folderPath))
        .get();

      // Skip folders already queued for review or explicitly dismissed with the same file count
      if (
        existing &&
        (existing.status === "needs_review" || existing.status === "dismissed") &&
        existing.trackCount === audioFiles.length
      ) {
        result.skipped += 1;
        continue;
      }

      try {
        const files = await this.inspectSourceFiles(audioFiles);
        const folderName = path.basename(folderPath);
        const hints = parseFolderHints(folderName);

        const detectedArtist =
          mostCommonString(files.map((f) => f.currentArtist)) ?? hints.artist ?? "Unknown Artist";
        const detectedAlbum =
          mostCommonString(files.map((f) => f.currentAlbum)) ?? hints.album ?? folderName;
        const detectedYear = hints.year;

        let candidates: MusicBrainzReleaseCandidate[] = [];
        try {
          candidates = await this.musicBrainz.searchReleases({
            artist: detectedArtist,
            album: detectedAlbum,
            trackCount: files.length,
          });
        } catch (err) {
          this.logger?.warn({ err, folderName }, "MusicBrainz lookup failed during inbox scan");
        }

        const top = candidates[0] ?? null;
        const confidence = top?.score ?? 0;
        const now = new Date();

        const itemId = this.upsertImportItem({
          sourceDir: folderPath,
          folderName,
          status: "needs_review",
          detectedArtist,
          detectedAlbum,
          detectedYear: top?.year ?? detectedYear,
          trackCount: files.length,
          confidence,
          matchedMbid: top?.mbid ?? null,
          matchedArtist: top?.artist ?? null,
          matchedAlbum: top?.title ?? null,
          matchedYear: top?.year ?? null,
          matchedCoverUrl: top?.coverArtUrl ?? null,
          candidates,
          files,
          errorMessage: null,
          now,
        });

        // Auto-import only when confidence clears the threshold AND track count matches exactly
        const canAutoImport =
          top !== null &&
          confidence >= this.autoImportThreshold &&
          top.trackCount === files.length;

        if (canAutoImport) {
          try {
            const detail = await this.musicBrainz.getReleaseDetail(top.mbid);
            const trackOverrides: RetagTrackOverride[] = files.map((file, idx) => {
              const mbTrack = detail.tracks[idx];
              return {
                filePath: file.filePath,
                title: mbTrack?.title ?? file.currentTitle,
                artist: mbTrack?.artist ?? detail.artist,
                trackNumber: mbTrack?.trackNumber ?? file.trackNumber ?? idx + 1,
                discNumber: mbTrack?.discNumber ?? file.discNumber ?? 1,
                recordingMbid: mbTrack?.recordingMbid ?? null,
              };
            });

            await this.applyImport(itemId, {
              artist: detail.artist,
              album: detail.title,
              year: detail.year,
              mbid: detail.mbid,
              artistMbid: detail.artistMbid,
              tracks: trackOverrides,
            });
            result.autoImported += 1;
            continue;
          } catch (err) {
            this.logger?.warn(
              { err, folderName },
              "Auto-import failed; leaving item in Review Queue",
            );
          }
        }

        result.needsReview += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.error({ err, folderPath }, "Failed to inspect inbox folder");
        result.failed += 1;
        this.upsertImportItem({
          sourceDir: folderPath,
          folderName: path.basename(folderPath),
          status: "failed",
          detectedArtist: "Unknown Artist",
          detectedAlbum: path.basename(folderPath),
          detectedYear: null,
          trackCount: audioFiles.length,
          confidence: 0,
          matchedMbid: null,
          matchedArtist: null,
          matchedAlbum: null,
          matchedYear: null,
          matchedCoverUrl: null,
          candidates: [],
          files: [],
          errorMessage: msg,
          now: new Date(),
        });
      }
    }

    return result;
  }

  /**
   * Tags every file in a Review Queue item, moves them into MUSIC_DIR/Artist/Album/Track,
   * cleans up the empty inbox folder, and triggers a library scan.
   */
  async applyImport(importId: number, payload: ApplyTaggingRequest): Promise<ApplyImportResponse> {
    const row = this.dbContext.db
      .select()
      .from(importItems)
      .where(eq(importItems.id, importId))
      .get();

    if (!row) {
      throw new ImporterError("Import item not found.", 404);
    }

    const storedFiles = this.safeParseJson<ImportSourceFile[]>(row.filesJson, []);
    const allowedPaths = new Set(storedFiles.map((f) => f.filePath));
    const tracksToProcess = payload.tracks.filter((t) => allowedPaths.has(t.filePath));

    if (tracksToProcess.length === 0) {
      throw new ImporterError("No valid source files matched this import item.", 400);
    }

    const safeArtist = sanitizePathSegment(payload.artist, "Unknown Artist");
    const safeAlbum = sanitizePathSegment(payload.album, "Unknown Album");
    const destinationDir = path.join(this.musicDir, safeArtist, safeAlbum);
    await fsp.mkdir(destinationDir, { recursive: true });

    const discNumbers = new Set(
      tracksToProcess.map((t) => t.discNumber ?? 1).filter((d) => d > 0),
    );
    const hasMultipleDiscs = discNumbers.size > 1;

    let filesImported = 0;

    for (let idx = 0; idx < tracksToProcess.length; idx++) {
      const track = tracksToProcess[idx]!;
      if (!fs.existsSync(track.filePath)) {
        throw new ImporterError(`Source file no longer exists: ${path.basename(track.filePath)}`);
      }

      const trackNumber = track.trackNumber ?? idx + 1;
      const discNumber = track.discNumber ?? 1;

      // Write clean tags before moving into the library
      writeAudioTags(track.filePath, {
        title: track.title,
        artist: track.artist?.trim() || payload.artist,
        albumArtist: payload.artist,
        album: payload.album,
        trackNumber,
        discNumber,
        year: payload.year,
        genre: payload.genre ?? null,
        musicBrainzReleaseId: payload.mbid ?? null,
        musicBrainzArtistId: payload.artistMbid ?? null,
        musicBrainzTrackId: track.recordingMbid ?? null,
      });

      const ext = path.extname(track.filePath).toLowerCase();
      const destName = formatTrackFilename(
        trackNumber,
        discNumber,
        hasMultipleDiscs,
        track.title,
        ext,
      );
      const destPath = path.join(destinationDir, destName);
      await moveFileSafe(track.filePath, destPath);
      filesImported += 1;
    }

    // Also bring along any folder artwork (cover.jpg / folder.png) if present in the source folder
    await this.moveFolderCovers(row.sourceDir, destinationDir);
    await removeEmptyDir(row.sourceDir, this.downloadsDir);

    const now = new Date();
    this.dbContext.db
      .update(importItems)
      .set({
        status: "imported",
        matchedMbid: payload.mbid ?? row.matchedMbid,
        matchedArtist: payload.artist,
        matchedAlbum: payload.album,
        matchedYear: payload.year,
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(importItems.id, importId))
      .run();

    // Index the newly moved album into SQLite right away
    await this.scanner.runScan();

    return {
      importId,
      status: "imported",
      destinationDir,
      filesImported,
    };
  }

  dismissImport(importId: number): void {
    const existing = this.dbContext.db
      .select({ id: importItems.id })
      .from(importItems)
      .where(eq(importItems.id, importId))
      .get();

    if (!existing) {
      throw new ImporterError("Import item not found.", 404);
    }

    this.dbContext.db
      .update(importItems)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(eq(importItems.id, importId))
      .run();
  }

  /**
   * "Fix This Album" for albums already in the library: rewrites embedded audio tags
   * in place and triggers a forced re-scan so SQLite reflects the cleaned tags.
   */
  async retagExistingAlbum(
    albumId: number,
    payload: ApplyTaggingRequest,
  ): Promise<RetagAlbumResponse> {
    const album = this.dbContext.db.select().from(albums).where(eq(albums.id, albumId)).get();
    if (!album) {
      throw new ImporterError("Album not found.", 404);
    }

    const albumTracks = this.dbContext.db
      .select({ id: tracks.id, filePath: tracks.filePath })
      .from(tracks)
      .where(eq(tracks.albumId, albumId))
      .all();

    const allowedPaths = new Set(albumTracks.map((t) => t.filePath));
    const tracksToUpdate = payload.tracks.filter((t) => allowedPaths.has(t.filePath));

    if (tracksToUpdate.length === 0) {
      throw new ImporterError("No valid tracks matched this album.", 400);
    }

    let filesUpdated = 0;
    for (let idx = 0; idx < tracksToUpdate.length; idx++) {
      const track = tracksToUpdate[idx]!;
      if (!fs.existsSync(track.filePath)) continue;

      writeAudioTags(track.filePath, {
        title: track.title,
        artist: track.artist?.trim() || payload.artist,
        albumArtist: payload.artist,
        album: payload.album,
        trackNumber: track.trackNumber ?? idx + 1,
        discNumber: track.discNumber ?? 1,
        year: payload.year,
        genre: payload.genre ?? null,
        musicBrainzReleaseId: payload.mbid ?? null,
        musicBrainzArtistId: payload.artistMbid ?? null,
        musicBrainzTrackId: track.recordingMbid ?? null,
      });
      filesUpdated += 1;
    }

    // Re-scan so SQLite picks up the rewritten tags and merges/prunes old artist/album names
    await this.scanner.runScan({ force: true });

    return { albumId, filesUpdated };
  }

  private async inspectSourceFiles(filePaths: string[]): Promise<ImportSourceFile[]> {
    const results: ImportSourceFile[] = [];

    for (const filePath of filePaths) {
      const basename = path.basename(filePath);
      const extension = path.extname(filePath).toLowerCase();
      let currentTitle = path.basename(filePath, extension);
      let currentArtist = "";
      let currentAlbum = "";
      let trackNumber: number | null = null;
      let discNumber: number | null = null;
      let durationSeconds: number | null = null;

      try {
        const meta = await parseFile(filePath, { duration: true });
        if (meta.common.title?.trim()) currentTitle = meta.common.title.trim();
        currentArtist =
          meta.common.albumartist?.trim() || meta.common.artist?.trim() || "";
        currentAlbum = meta.common.album?.trim() || "";
        trackNumber = meta.common.track.no ?? null;
        discNumber = meta.common.disk.no ?? null;
        durationSeconds = meta.format.duration ?? null;
      } catch {
        // Fall back to filename hints when tags are unreadable or missing
      }

      results.push({
        filePath,
        basename,
        extension,
        currentTitle,
        currentArtist,
        currentAlbum,
        trackNumber,
        discNumber,
        durationSeconds,
      });
    }

    results.sort((a, b) => {
      const discDiff = (a.discNumber ?? 1) - (b.discNumber ?? 1);
      if (discDiff !== 0) return discDiff;
      const trackDiff = (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999);
      if (trackDiff !== 0) return trackDiff;
      return a.basename.localeCompare(b.basename);
    });

    return results;
  }

  private async moveFolderCovers(sourceDir: string, destinationDir: string): Promise<void> {
    try {
      const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!COVER_IMAGE_NAMES.has(entry.name.toLowerCase())) continue;
        const src = path.join(sourceDir, entry.name);
        const dest = path.join(destinationDir, entry.name);
        if (!fs.existsSync(dest)) {
          await moveFileSafe(src, dest);
        }
      }
    } catch {
      // Non-fatal if cover copy fails
    }
  }

  private upsertImportItem(input: {
    sourceDir: string;
    folderName: string;
    status: ImportItemStatus;
    detectedArtist: string;
    detectedAlbum: string;
    detectedYear: number | null;
    trackCount: number;
    confidence: number;
    matchedMbid: string | null;
    matchedArtist: string | null;
    matchedAlbum: string | null;
    matchedYear: number | null;
    matchedCoverUrl: string | null;
    candidates: MusicBrainzReleaseCandidate[];
    files: ImportSourceFile[];
    errorMessage: string | null;
    now: Date;
  }): number {
    const existing = this.dbContext.db
      .select({ id: importItems.id })
      .from(importItems)
      .where(eq(importItems.sourceDir, input.sourceDir))
      .get();

    const values = {
      folderName: input.folderName,
      status: input.status,
      detectedArtist: input.detectedArtist,
      detectedAlbum: input.detectedAlbum,
      detectedYear: input.detectedYear,
      trackCount: input.trackCount,
      confidence: input.confidence,
      matchedMbid: input.matchedMbid,
      matchedArtist: input.matchedArtist,
      matchedAlbum: input.matchedAlbum,
      matchedYear: input.matchedYear,
      matchedCoverUrl: input.matchedCoverUrl,
      candidatesJson: JSON.stringify(input.candidates),
      filesJson: JSON.stringify(input.files),
      errorMessage: input.errorMessage,
      updatedAt: input.now,
    };

    if (existing) {
      this.dbContext.db
        .update(importItems)
        .set(values)
        .where(eq(importItems.id, existing.id))
        .run();
      return existing.id;
    }

    const inserted = this.dbContext.db
      .insert(importItems)
      .values({
        sourceDir: input.sourceDir,
        ...values,
        createdAt: input.now,
      })
      .returning({ id: importItems.id })
      .get();

    return inserted.id;
  }

  private safeParseJson<T>(raw: string, fallback: T): T {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
}
