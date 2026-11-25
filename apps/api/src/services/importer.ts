import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { parseFile } from "music-metadata";
import type { FastifyBaseLogger } from "fastify";
import type {
  ApplyImportResponse,
  ApplyTaggingRequest,
  BulkImportFolderResponse,
  ImportDuplicateMatch,
  ImportFileAction,
  ImportItemStatus,
  ImportItemSummary,
  ImportSourceFile,
  ImportsListResponse,
  InboxScanResult,
  LibraryOrganizationSettings,
  MusicBrainzReleaseCandidate,
  PostProcessingSettings,
  RetagAlbumResponse,
  RetagTrackOverride,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import { albums, importItems, tracks } from "../db/schema.js";
import type { ActivityLogService } from "./activityLog.js";
import { DEFAULT_LIBRARY_ORGANIZATION, formatTrackRelativePath } from "./libraryLayout.js";
import { getSidecarLrcPath, type LyricsService } from "./lyrics.js";
import { isAllowedCoverArtUrl, type MetadataLookupService } from "./metadataLookup.js";
import type { MusicBrainzClient } from "./musicbrainz.js";
import type { PlaylistBatchSearchService } from "./playlistBatchSearch.js";
import {
  extractArtistVariants,
  normalizeForMatching,
  recheckAllPlaylistsMissingTracks,
} from "./playlistImport.js";
import type { PlaylistSyncService } from "./playlistSync.js";
import { SUPPORTED_AUDIO_EXTENSIONS, type LibraryScanner } from "./scanner.js";
import { writeAudioTags, writeEmbeddedCover } from "./tagWriter.js";

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

const INCOMPLETE_EXTENSIONS = new Set([".part", ".tmp", ".incomplete", ".crdownload", ".downloading"]);
const OS_JUNK_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const DEFAULT_STABILITY_WINDOW_MS = 10_000;

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
 * Computes a deterministic quality score so MusicOrbit can compare duplicates
 * (FLAC/WAV lossless > high-bitrate Opus/AAC/MP3 > lower bitrate).
 */
export function computeAudioQualityScore(
  codecOrExt: string | null | undefined,
  bitrateKbpsOrBps: number | null | undefined,
): number {
  const raw = (codecOrExt ?? "").toLowerCase().replace(/^\./, "");
  const rawBr = bitrateKbpsOrBps ?? 0;
  const kbps = rawBr > 5000 ? Math.round(rawBr / 1000) : Math.round(rawBr);

  if (raw.includes("flac") || raw.includes("wav") || raw.includes("pcm") || raw.includes("alac")) {
    return 1000 + Math.min(500, Math.round((kbps || 1000) / 5));
  }
  if (raw.includes("opus")) {
    return Math.round((kbps || 160) * 1.35);
  }
  return kbps || 192;
}

/**
 * Moves a file safely across filesystems (handles Docker EXDEV when /downloads
 * and /music are mounted on different volumes).
 */
async function moveFileSafe(src: string, dest: string): Promise<void> {
  if (path.resolve(src) === path.resolve(dest)) return;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.rename(src, dest);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EXDEV") {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw err;
    }
  }
}

async function copyFileSafe(src: string, dest: string): Promise<void> {
  if (path.resolve(src) === path.resolve(dest)) return;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

function isOsJunkFile(name: string): boolean {
  const lower = name.toLowerCase();
  return OS_JUNK_FILES.has(lower) || lower.startsWith("._");
}

/**
 * Cleans up empty staging directories inside downloadsDir after files are moved out,
 * removing macOS/Windows junk files (.DS_Store, Thumbs.db) if nothing else remains.
 */
async function removeEmptyDir(dir: string, stopAt: string): Promise<void> {
  let current = path.resolve(dir);
  const boundary = path.resolve(stopAt);
  while (current !== boundary && current.startsWith(`${boundary}${path.sep}`)) {
    try {
      const entries = await fsp.readdir(current, { withFileTypes: true });
      const realEntries = entries.filter((e) => !(e.isFile() && isOsJunkFile(e.name)));
      if (realEntries.length > 0) break;

      // Delete leftover OS metadata files before removing the folder
      for (const junk of entries) {
        if (junk.isFile() && isOsJunkFile(junk.name)) {
          await fsp.unlink(path.join(current, junk.name)).catch(() => {});
        }
      }

      await fsp.rmdir(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

async function areFilesStable(
  folderPath: string,
  audioFiles: string[],
  stabilityWindowMs: number,
  isLooseFile: boolean,
): Promise<boolean> {
  try {
    const now = Date.now();
    if (!isLooseFile) {
      const entries = await fsp.readdir(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (INCOMPLETE_EXTENSIONS.has(ext)) return false;
      }
    }
    for (const filePath of audioFiles) {
      const stat = await fsp.stat(filePath);
      if (now - stat.mtimeMs < stabilityWindowMs) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

interface DiscoveredInboxItem {
  sourceKey: string;
  folderPath: string;
  folderName: string;
  audioFiles: string[];
  isLooseFile: boolean;
}

/**
 * Discovers audio items inside downloadsDir:
 * - Loose audio files directly at the root of downloadsDir become individual single-track items
 *   (so unrelated loose downloads never collide or get grouped into a fake album).
 * - Audio files inside subfolders are grouped by their containing subfolder.
 */
async function discoverInboxItems(downloadsDir: string): Promise<DiscoveredInboxItem[]> {
  const items: DiscoveredInboxItem[] = [];
  const rootResolved = path.resolve(downloadsDir);

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

    if (audioFiles.length === 0) return;
    audioFiles.sort((a, b) => a.localeCompare(b));

    if (path.resolve(dir) === rootResolved) {
      // Treat each loose root file as its own single-track import item
      for (const filePath of audioFiles) {
        items.push({
          sourceKey: filePath,
          folderPath: dir,
          folderName: path.basename(filePath),
          audioFiles: [filePath],
          isLooseFile: true,
        });
      }
    } else {
      items.push({
        sourceKey: dir,
        folderPath: dir,
        folderName: path.basename(dir),
        audioFiles,
        isLooseFile: false,
      });
    }
  }

  await walk(downloadsDir);
  return items;
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

function stripLeadingTrackNumber(raw: string): string {
  return raw.replace(/^\d{1,3}[\s._-]+/, "").trim();
}

function isCompilationArtist(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    lower === "various artists" ||
    lower === "various" ||
    lower === "va" ||
    lower === "compilation"
  );
}

export interface LibraryImporterDeps {
  dbContext: DbContext;
  musicDir: string;
  getMusicDir?: () => string;
  downloadsDir: string;
  dataDir?: string;
  autoImportThreshold: number;
  getPostProcessingSettings?: () => PostProcessingSettings;
  getLibraryOrganizationSettings?: () => LibraryOrganizationSettings;
  musicBrainz: MusicBrainzClient;
  metadataLookup?: MetadataLookupService;
  lyricsService?: LyricsService;
  batchSearchService?: PlaylistBatchSearchService;
  playlistSync?: PlaylistSyncService;
  activityLog?: ActivityLogService;
  fetchImpl?: typeof fetch;
  scanner: LibraryScanner;
  logger?: FastifyBaseLogger;
}

export interface ScanInboxOptions {
  sourceDir?: string;
  fileActionOverride?: ImportFileAction;
  requireStableFiles?: boolean;
  stabilityWindowMs?: number;
}

interface ExistingDuplicateTrack {
  id: number;
  title: string;
  artistName: string;
  albumTitle: string;
  filePath: string;
  codec: string | null;
  bitrate: number | null;
}

export class LibraryImporter {
  private readonly dbContext: DbContext;
  private readonly getMusicDirFn: () => string;
  private readonly defaultDownloadsDir: string;
  private readonly dataDir: string;
  private readonly defaultAutoImportThreshold: number;
  private readonly getPostProcessingSettingsFn: () => PostProcessingSettings;
  private readonly getLibraryOrganizationSettingsFn: () => LibraryOrganizationSettings;
  private readonly musicBrainz: MusicBrainzClient;
  private readonly metadataLookup?: MetadataLookupService;
  private readonly lyricsService?: LyricsService;
  private readonly batchSearchService?: PlaylistBatchSearchService;
  private readonly playlistSync?: PlaylistSyncService;
  private readonly activityLog?: ActivityLogService;
  private readonly fetchImpl: typeof fetch;
  private readonly scanner: LibraryScanner;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: LibraryImporterDeps) {
    this.dbContext = deps.dbContext;
    this.getMusicDirFn = deps.getMusicDir ?? (() => deps.musicDir);
    this.defaultDownloadsDir = deps.downloadsDir;
    this.dataDir = deps.dataDir ?? path.dirname(deps.dbContext.dbPath);
    this.defaultAutoImportThreshold = deps.autoImportThreshold;
    this.getPostProcessingSettingsFn =
      deps.getPostProcessingSettings ??
      (() => ({
        downloadsDir: this.defaultDownloadsDir,
        defaultDownloadsDir: this.defaultDownloadsDir,
        downloadsDirExists: fs.existsSync(this.defaultDownloadsDir),
        fileAction: "move",
        duplicatePolicy: "upgrade",
        autoWatchEnabled: false,
        autoWatchIntervalSeconds: 60,
        autoImportThreshold: this.defaultAutoImportThreshold,
        includeYearInAlbumFolder: false,
        autoEmbedCoverArt: true,
        autoFetchLyrics: false,
      }));
    this.getLibraryOrganizationSettingsFn =
      deps.getLibraryOrganizationSettings ??
      (() => ({
        ...DEFAULT_LIBRARY_ORGANIZATION,
        includeYearInAlbumFolder: this.getPostProcessingSettingsFn().includeYearInAlbumFolder,
      }));
    this.musicBrainz = deps.musicBrainz;
    this.metadataLookup = deps.metadataLookup;
    this.lyricsService = deps.lyricsService;
    this.batchSearchService = deps.batchSearchService;
    this.playlistSync = deps.playlistSync;
    this.activityLog = deps.activityLog;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.scanner = deps.scanner;
    this.logger = deps.logger;
  }

  private get musicDir(): string {
    return this.getMusicDirFn();
  }

  private get settings(): PostProcessingSettings {
    return this.getPostProcessingSettingsFn();
  }

  private get organizationSettings(): LibraryOrganizationSettings {
    return this.getLibraryOrganizationSettingsFn();
  }

  listItems(statusFilter?: ImportItemStatus): ImportsListResponse {
    const pp = this.settings;
    const rows = statusFilter
      ? this.dbContext.db
          .select()
          .from(importItems)
          .where(eq(importItems.status, statusFilter))
          .orderBy(desc(importItems.updatedAt))
          .all()
      : this.dbContext.db.select().from(importItems).orderBy(desc(importItems.updatedAt)).all();

    const items: ImportItemSummary[] = rows.map((row) => {
      const files = this.safeParseJson<ImportSourceFile[]>(row.filesJson, []);
      const duplicates: ImportDuplicateMatch[] = [];

      if (row.status === "needs_review") {
        for (const f of files) {
          const trackArtist = f.currentArtist || row.detectedArtist;
          const dup = this.findExistingDuplicate(trackArtist, f.currentTitle);
          if (dup) {
            const incomingScore = computeAudioQualityScore(f.codec ?? f.extension, f.bitrate);
            const existingScore = computeAudioQualityScore(dup.codec, dup.bitrate);
            duplicates.push({
              sourceFilePath: f.filePath,
              existingTrackId: dup.id,
              existingTitle: dup.title,
              existingArtist: dup.artistName,
              existingAlbum: dup.albumTitle,
              existingCodec: dup.codec,
              existingBitrate: dup.bitrate,
              existingFilePath: dup.filePath,
              isUpgrade: incomingScore > existingScore,
            });
          }
        }
      }

      return {
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
        files,
        duplicates,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });

    const needsReviewRow = this.dbContext.sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM import_items WHERE status = 'needs_review'")
      .get() as { cnt: number } | undefined;

    return {
      downloadsDir: {
        path: pp.downloadsDir,
        exists: fs.existsSync(pp.downloadsDir),
      },
      needsReviewCount: needsReviewRow?.cnt ?? 0,
      items,
    };
  }

  /**
   * One-off bulk import from an external folder (e.g. initial migration of an existing
   * messy music folder) using the same tagging, layout, duplicate, and Review Queue pipeline.
   */
  async importExternalFolder(
    rawSourceDir: string,
    fileAction: ImportFileAction = "copy",
  ): Promise<BulkImportFolderResponse> {
    const trimmed = rawSourceDir.trim();
    if (!trimmed) {
      throw new ImporterError("Please select a source folder to import.", 400);
    }

    const resolvedSource = path.resolve(trimmed);
    if (!fs.existsSync(resolvedSource)) {
      throw new ImporterError(`Source folder does not exist: ${resolvedSource}`, 400);
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedSource);
    } catch {
      throw new ImporterError(`Cannot access source folder: ${resolvedSource}`, 400);
    }
    if (!stat.isDirectory()) {
      throw new ImporterError(`Source path is not a directory: ${resolvedSource}`, 400);
    }

    const resolvedMusic = path.resolve(this.musicDir);
    const relFromMusic = path.relative(resolvedMusic, resolvedSource);
    const relFromSource = path.relative(resolvedSource, resolvedMusic);
    const overlapsMusicDir =
      resolvedSource === resolvedMusic ||
      (relFromMusic !== "" && !relFromMusic.startsWith("..") && !path.isAbsolute(relFromMusic)) ||
      (relFromSource !== "" && !relFromSource.startsWith("..") && !path.isAbsolute(relFromSource));

    if (overlapsMusicDir) {
      throw new ImporterError(
        "Source folder overlaps your Music Directory. Use 'Preview & Organize Library' to format files already inside your Music Directory.",
        400,
      );
    }

    this.activityLog?.info(
      "importer",
      `Starting bulk folder import from ${resolvedSource} (${fileAction})`,
      { sourceDir: resolvedSource, fileAction },
    );

    const scanResult = await this.scanInbox({
      sourceDir: resolvedSource,
      fileActionOverride: fileAction,
      requireStableFiles: false,
    });

    this.activityLog?.success(
      "importer",
      `Bulk import finished: ${scanResult.autoImported} imported, ${scanResult.needsReview} sent to Review Queue, ${scanResult.skipped} skipped`,
      { sourceDir: resolvedSource, fileAction, ...scanResult },
    );

    return {
      ...scanResult,
      sourceDir: resolvedSource,
      fileAction,
    };
  }

  /**
   * Scans DOWNLOADS_DIR (or a custom external sourceDir) for album folders and loose single files,
   * matches via Deezer (singles) and MusicBrainz (albums), respects duplicate policies & stability checks,
   * auto-imports high-confidence matches, and queues uncertain ones for review.
   */
  async scanInbox(options?: ScanInboxOptions): Promise<InboxScanResult> {
    const pp = this.settings;
    const scanRoot = options?.sourceDir ? path.resolve(options.sourceDir) : pp.downloadsDir;
    const effectiveFileAction: ImportFileAction = options?.fileActionOverride ?? pp.fileAction;

    if (!fs.existsSync(scanRoot)) {
      return { discoveredFolders: 0, autoImported: 0, needsReview: 0, skipped: 0, failed: 0 };
    }

    const discovered = await discoverInboxItems(scanRoot);
    const result: InboxScanResult = {
      discoveredFolders: discovered.length,
      autoImported: 0,
      needsReview: 0,
      skipped: 0,
      failed: 0,
    };

    for (const item of discovered) {
      const existing = this.dbContext.db
        .select()
        .from(importItems)
        .where(eq(importItems.sourceDir, item.sourceKey))
        .get();

      // Skip only when the exact same file paths were already queued/dismissed/copied-imported
      if (existing) {
        const prevFiles = this.safeParseJson<ImportSourceFile[]>(existing.filesJson, []).map(
          (f) => f.filePath,
        );
        const sameFiles =
          prevFiles.length === item.audioFiles.length &&
          prevFiles.every((fp, i) => fp === item.audioFiles[i]);

        if (
          sameFiles &&
          (existing.status === "needs_review" ||
            existing.status === "dismissed" ||
            (existing.status === "imported" && effectiveFileAction === "copy"))
        ) {
          result.skipped += 1;
          continue;
        }
      }

      if (options?.requireStableFiles) {
        const stable = await areFilesStable(
          item.folderPath,
          item.audioFiles,
          options.stabilityWindowMs ?? DEFAULT_STABILITY_WINDOW_MS,
          item.isLooseFile,
        );
        if (!stable) {
          result.skipped += 1;
          continue;
        }
      }

      try {
        const files = await this.inspectSourceFiles(item.audioFiles);
        const isSingleTrack = files.length === 1;
        const folderName = item.folderName;
        const hints = parseFolderHints(
          item.isLooseFile ? path.basename(folderName, path.extname(folderName)) : folderName,
        );

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
          sourceDir: item.sourceKey,
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

        // 1. Single-Track Mode FIRST when there is 1 audio file (prevents renaming songs like
        //    "Doin' Time" or "West Coast" to a 1-track single release named after the album!)
        if (isSingleTrack && this.metadataLookup) {
          const singleFile = files[0]!;
          const singleMatch = await this.tryMatchSingleTrack(
            singleFile,
            detectedArtist,
            detectedAlbum,
            pp.autoImportThreshold,
          );

          if (singleMatch) {
            if (
              pp.duplicatePolicy === "review" &&
              this.findExistingDuplicate(singleMatch.artist, singleMatch.title)
            ) {
              result.needsReview += 1;
              continue;
            }

            try {
              await this.applyImport(
                itemId,
                {
                  artist: singleMatch.albumArtist,
                  album: singleMatch.album,
                  year: singleMatch.year,
                  genre: singleMatch.genre,
                  coverArtUrl: singleMatch.coverArtUrl,
                  tracks: [
                    {
                      filePath: singleFile.filePath,
                      title: singleMatch.title,
                      artist: singleMatch.artist,
                      trackNumber: singleMatch.trackNumber,
                      discNumber: singleMatch.discNumber,
                    },
                  ],
                },
                {
                  coverArtUrl: singleMatch.coverArtUrl,
                  fileActionOverride: effectiveFileAction,
                  sourceRoot: scanRoot,
                },
              );
              result.autoImported += 1;
              continue;
            } catch (err) {
              this.logger?.warn(
                { err, folderName },
                "Single-track auto-import failed; leaving in Review Queue",
              );
            }
          }
        }

        // 2. Album Auto-Import (MusicBrainz release match with exact track count)
        const canAutoImportAlbum =
          top !== null &&
          confidence >= pp.autoImportThreshold &&
          top.trackCount === files.length;

        if (canAutoImportAlbum) {
          try {
            const detail = await this.musicBrainz.getReleaseDetail(top.mbid);

            // Safety guard for 1-track releases: NEVER blindly overwrite a single track's title
            // with an album title unless the MusicBrainz track title actually matches the song!
            if (isSingleTrack) {
              const fileTitleNorm = normalizeForMatching(stripLeadingTrackNumber(files[0]!.currentTitle));
              const mbTitleNorm = normalizeForMatching(detail.tracks[0]?.title ?? "");
              if (!fileTitleNorm || !mbTitleNorm || fileTitleNorm !== mbTitleNorm) {
                result.needsReview += 1;
                continue;
              }
            }

            // Map MusicBrainz release tracks by title similarity FIRST, then trackNumber, then index
            const usedMbIndices = new Set<number>();
            const trackOverrides: RetagTrackOverride[] = files.map((file, idx) => {
              const normFileTitle = normalizeForMatching(stripLeadingTrackNumber(file.currentTitle));
              let matchedIdx = detail.tracks.findIndex(
                (t, ti) =>
                  !usedMbIndices.has(ti) &&
                  normFileTitle.length > 0 &&
                  normalizeForMatching(t.title) === normFileTitle,
              );
              if (matchedIdx === -1 && file.trackNumber !== null) {
                matchedIdx = detail.tracks.findIndex(
                  (t, ti) =>
                    !usedMbIndices.has(ti) &&
                    t.trackNumber === file.trackNumber &&
                    t.discNumber === (file.discNumber ?? 1),
                );
              }
              if (matchedIdx === -1 && idx < detail.tracks.length && !usedMbIndices.has(idx)) {
                matchedIdx = idx;
              }
              if (matchedIdx >= 0) usedMbIndices.add(matchedIdx);
              const mbTrack = matchedIdx >= 0 ? detail.tracks[matchedIdx] : undefined;

              return {
                filePath: file.filePath,
                title: mbTrack?.title ?? file.currentTitle,
                artist: mbTrack?.artist ?? detail.artist,
                trackNumber: mbTrack?.trackNumber ?? file.trackNumber ?? idx + 1,
                discNumber: mbTrack?.discNumber ?? file.discNumber ?? 1,
                recordingMbid: mbTrack?.recordingMbid ?? null,
              };
            });

            if (
              pp.duplicatePolicy === "review" &&
              trackOverrides.some((t) =>
                Boolean(this.findExistingDuplicate(t.artist ?? detail.artist, t.title)),
              )
            ) {
              result.needsReview += 1;
              continue;
            }

            await this.applyImport(
              itemId,
              {
                artist: detail.artist,
                album: detail.title,
                year: detail.year,
                mbid: detail.mbid,
                artistMbid: detail.artistMbid,
                coverArtUrl: top.coverArtUrl,
                tracks: trackOverrides,
              },
              {
                coverArtUrl: top.coverArtUrl,
                fileActionOverride: effectiveFileAction,
                sourceRoot: scanRoot,
              },
            );
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
        this.activityLog?.info(
          "importer",
          `Queued "${folderName}" for manual review (${files.length} ${files.length === 1 ? "track" : "tracks"}, best match ${Math.round(confidence)}%)`,
          { source: item.sourceKey, detectedArtist, detectedAlbum, confidence },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.activityLog?.error("importer", `Failed to inspect "${item.folderName}": ${msg}`, {
          source: item.sourceKey,
        });
        result.failed += 1;
        this.upsertImportItem({
          sourceDir: item.sourceKey,
          folderName: item.folderName,
          status: "failed",
          detectedArtist: "Unknown Artist",
          detectedAlbum: item.folderName,
          detectedYear: null,
          trackCount: item.audioFiles.length,
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
   * Tags every file in a Review Queue item, handles duplicates according to policy/resolution,
   * moves/copies them into MUSIC_DIR/Artist/Album/Track, embeds cover/lyrics if enabled,
   * rescans the library, and automatically backfills missing tracks on all playlists.
   */
  async applyImport(
    importId: number,
    payload: ApplyTaggingRequest,
    extra?: {
      coverArtUrl?: string | null;
      fileActionOverride?: ImportFileAction;
      sourceRoot?: string;
    },
  ): Promise<ApplyImportResponse> {
    const pp = this.settings;
    const org = this.organizationSettings;
    const effectiveFileAction: ImportFileAction = extra?.fileActionOverride ?? pp.fileAction;
    const sourceRoot = extra?.sourceRoot ? path.resolve(extra.sourceRoot) : path.resolve(pp.downloadsDir);

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
    const discNumbers = new Set(
      tracksToProcess.map((t) => t.discNumber ?? 1).filter((d) => d > 0),
    );
    const hasMultipleDiscs = discNumbers.size > 1;
    let destinationDir = path.join(this.musicDir, safeArtist);

    let remoteCover: { bytes: Uint8Array; mimeType: string } | null = null;
    const coverCandidateUrl = extra?.coverArtUrl ?? payload.coverArtUrl ?? row.matchedCoverUrl;
    if (pp.autoEmbedCoverArt && coverCandidateUrl) {
      remoteCover = await this.tryDownloadCoverArt(coverCandidateUrl);
    }

    const dupResolution = payload.duplicateResolution ?? "policy";
    let filesImported = 0;
    let duplicatesSkipped = 0;
    let duplicatesUpgraded = 0;
    // Preserve playlist memberships when a track is upgraded/replaced at a different file path
    const playlistMigrations: Array<{
      newDestPath: string;
      entries: Array<{ playlistId: number; position: number; addedAt: number }>;
    }> = [];

    for (let idx = 0; idx < tracksToProcess.length; idx++) {
      const track = tracksToProcess[idx]!;
      if (!fs.existsSync(track.filePath)) {
        throw new ImporterError(`Source file no longer exists: ${path.basename(track.filePath)}`);
      }

      const trackArtist = track.artist?.trim() || payload.artist;
      const trackNumber = track.trackNumber ?? idx + 1;
      const discNumber = track.discNumber ?? 1;
      const ext = path.extname(track.filePath).toLowerCase();

      let incomingBitrate: number | null = null;
      let incomingCodec: string | null = ext.slice(1);
      let hasEmbeddedCover = false;
      try {
        const parsedMeta = await parseFile(track.filePath, { duration: false });
        incomingBitrate = parsedMeta.format.bitrate ?? null;
        incomingCodec = parsedMeta.format.codec ?? parsedMeta.format.container ?? ext.slice(1);
        hasEmbeddedCover = Boolean(parsedMeta.common.picture && parsedMeta.common.picture.length > 0);
      } catch {
        // Fallback to extension
      }

      const relTarget =
        formatTrackRelativePath(
          {
            albumArtist: payload.artist,
            trackArtist,
            album: payload.album,
            title: track.title,
            year: payload.year,
            trackNumber,
            discNumber,
            hasMultipleDiscs,
            extension: ext,
          },
          org,
          { forExternalImport: true },
        ) ??
        path.join(
          safeArtist,
          sanitizePathSegment(payload.album, "Unknown Album"),
          formatTrackFilename(trackNumber, discNumber, hasMultipleDiscs, track.title, ext),
        );
      const destPath = path.join(this.musicDir, relTarget);
      destinationDir = path.dirname(destPath);

      // Duplicate & Quality-Upgrade Handling
      const existingDup = this.findExistingDuplicate(trackArtist, track.title);
      if (existingDup && dupResolution !== "keep_both") {
        const incomingScore = computeAudioQualityScore(incomingCodec, incomingBitrate);
        const existingScore = computeAudioQualityScore(existingDup.codec, existingDup.bitrate);

        const shouldSkip =
          dupResolution === "skip" ||
          (dupResolution === "policy" &&
            (pp.duplicatePolicy === "skip" ||
              (pp.duplicatePolicy === "upgrade" && incomingScore <= existingScore)));

        const shouldReplace =
          dupResolution === "replace" ||
          (dupResolution === "policy" &&
            pp.duplicatePolicy === "upgrade" &&
            incomingScore > existingScore);

        if (shouldSkip) {
          duplicatesSkipped += 1;
          let archivedTo: string | null = null;
          if (effectiveFileAction === "move") {
            const dupDest = path.join(
              this.dataDir,
              "duplicates",
              sanitizePathSegment(`${safeArtist} - ${payload.album}`),
              path.basename(track.filePath),
            );
            await moveFileSafe(track.filePath, dupDest).catch(() => {});
            archivedTo = dupDest;
          }
          this.activityLog?.warn(
            "importer",
            `Skipped duplicate "${track.title}" by ${trackArtist} (existing quality >= incoming)`,
            {
              source: track.filePath,
              existing: existingDup.filePath,
              existingCodec: existingDup.codec,
              incomingCodec,
              archivedTo,
            },
          );
          continue;
        }

        if (shouldReplace) {
          // Snapshot all playlist occurrences BEFORE scanner deletes the replaced track (ON DELETE CASCADE)
          const savedEntries = this.dbContext.sqlite
            .prepare(
              `
              SELECT playlist_id AS playlistId, position, added_at AS addedAt
              FROM playlist_tracks
              WHERE track_id = ?
              ORDER BY playlist_id ASC, position ASC
            `,
            )
            .all(existingDup.id) as Array<{ playlistId: number; position: number; addedAt: number }>;

          if (savedEntries.length > 0 && path.resolve(existingDup.filePath) !== path.resolve(destPath)) {
            playlistMigrations.push({ newDestPath: destPath, entries: savedEntries });
          }

          if (fs.existsSync(existingDup.filePath)) {
            const oldDir = path.dirname(existingDup.filePath);
            const archiveDest = path.join(
              this.dataDir,
              "replaced",
              sanitizePathSegment(`${existingDup.artistName} - ${existingDup.albumTitle}`),
              `${Date.now()}-${path.basename(existingDup.filePath)}`,
            );
            await moveFileSafe(existingDup.filePath, archiveDest).catch(() => {});
            // Carry paired .lrc sidecar over to upgraded track (or clean it out of the old folder)
            const oldLrc = getSidecarLrcPath(existingDup.filePath);
            const newLrc = getSidecarLrcPath(destPath);
            if (fs.existsSync(oldLrc) && path.resolve(oldLrc) !== path.resolve(newLrc)) {
              if (!fs.existsSync(newLrc)) {
                await moveFileSafe(oldLrc, newLrc).catch(() => {});
              } else {
                await fsp.unlink(oldLrc).catch(() => {});
              }
            }
            // Clean up now-empty old album/artist folder inside MUSIC_DIR
            await removeEmptyDir(oldDir, this.musicDir);
            duplicatesUpgraded += 1;
            this.activityLog?.success(
              "importer",
              `Upgraded "${track.title}" by ${trackArtist} (${existingDup.codec ?? "old"} → ${incomingCodec ?? ext})`,
              {
                replaced: existingDup.filePath,
                archivedTo: archiveDest,
                playlistEntriesPreserved: savedEntries.length,
              },
            );
          }
        }
      }

      if (effectiveFileAction === "copy") {
        await copyFileSafe(track.filePath, destPath);
      } else {
        await moveFileSafe(track.filePath, destPath);
      }

      let fetchedLyrics: string | null = null;
      if (pp.autoFetchLyrics) {
        if (this.lyricsService) {
          try {
            let durationSec: number | null = null;
            try {
              const durMeta = await parseFile(destPath, { duration: true, skipCovers: true });
              durationSec = durMeta.format.duration ?? null;
            } catch {
              // Non-fatal
            }
            const lrcResult = await this.lyricsService.fetchAndWriteSidecarForFile({
              filePath: destPath,
              artist: trackArtist,
              title: track.title,
              album: payload.album,
              durationSeconds: durationSec,
            });
            fetchedLyrics = lrcResult.syncedLrc ?? lrcResult.plainLyrics ?? null;
          } catch {
            // Non-fatal
          }
        } else if (this.metadataLookup) {
          try {
            const lrc = await this.metadataLookup.lookup({
              provider: "lrclib",
              title: track.title,
              artist: trackArtist,
              album: payload.album,
            });
            fetchedLyrics = lrc[0]?.fields.lyrics ?? null;
          } catch {
            // Non-fatal
          }
        }
      }

      writeAudioTags(destPath, {
        title: track.title,
        artist: trackArtist,
        albumArtist: payload.artist,
        album: payload.album,
        trackNumber,
        discNumber,
        year: payload.year,
        genre: payload.genre ?? null,
        lyrics: fetchedLyrics,
        musicBrainzReleaseId: payload.mbid ?? null,
        musicBrainzArtistId: payload.artistMbid ?? null,
        musicBrainzTrackId: track.recordingMbid ?? null,
      });

      if (pp.autoEmbedCoverArt && !hasEmbeddedCover && remoteCover) {
        try {
          writeEmbeddedCover(destPath, remoteCover.bytes, remoteCover.mimeType);
        } catch {
          // Non-fatal
        }
      }

      filesImported += 1;
    }

    // Only transfer folder covers / remove empty folder when source was a subfolder (not loose file)
    const sourceParentDir =
      fs.existsSync(row.sourceDir) && fs.statSync(row.sourceDir).isDirectory()
        ? row.sourceDir
        : path.dirname(row.sourceDir);
    const isSubfolder = path.resolve(sourceParentDir) !== sourceRoot;

    if (isSubfolder) {
      if (filesImported > 0) {
        await this.transferFolderCovers(sourceParentDir, destinationDir, effectiveFileAction);
      }
      if (effectiveFileAction === "move") {
        await removeEmptyDir(sourceParentDir, sourceRoot);
      }
    }

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

    await this.scanner.runScan();

    // Restore playlist memberships for any upgraded/replaced tracks at their exact original positions
    if (playlistMigrations.length > 0) {
      const findTrackByPathStmt = this.dbContext.sqlite.prepare(
        "SELECT id FROM tracks WHERE file_path = ?",
      );
      const insertPlTrackStmt = this.dbContext.sqlite.prepare(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
      );
      const touchPlStmt = this.dbContext.sqlite.prepare(
        "UPDATE playlists SET updated_at = ? WHERE id = ?",
      );
      const nowMs = Date.now();
      const tx = this.dbContext.sqlite.transaction(() => {
        for (const mig of playlistMigrations) {
          const newRow = findTrackByPathStmt.get(mig.newDestPath) as { id: number } | undefined;
          if (!newRow) continue;
          const touched = new Set<number>();
          for (const entry of mig.entries) {
            insertPlTrackStmt.run(entry.playlistId, newRow.id, entry.position, entry.addedAt);
            touched.add(entry.playlistId);
          }
          for (const plId of touched) {
            touchPlStmt.run(nowMs, plId);
          }
        }
      });
      tx();
    }

    const playlistsBackfilled = recheckAllPlaylistsMissingTracks(
      this.dbContext.sqlite,
      this.musicDir,
      this.batchSearchService,
    );

    if (playlistsBackfilled > 0 || playlistMigrations.length > 0) {
      await this.playlistSync?.syncAllPlaylists().catch(() => {});
    }

    this.activityLog?.success(
      "importer",
      `Imported "${payload.artist} — ${payload.album}" (${filesImported} ${filesImported === 1 ? "file" : "files"} ${effectiveFileAction === "copy" ? "copied" : "moved"}${duplicatesUpgraded > 0 ? `, ${duplicatesUpgraded} upgraded` : ""}${duplicatesSkipped > 0 ? `, ${duplicatesSkipped} duplicate skipped` : ""}${playlistsBackfilled > 0 ? `, ${playlistsBackfilled} playlist entries backfilled` : ""})`,
      {
        destinationDir,
        filesImported,
        duplicatesUpgraded,
        duplicatesSkipped,
        playlistsBackfilled,
      },
    );

    return {
      importId,
      status: "imported",
      destinationDir,
      filesImported,
      duplicatesSkipped,
      duplicatesUpgraded,
      playlistsBackfilled,
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

    await this.scanner.runScan({ force: true });

    return { albumId, filesUpdated };
  }

  private findExistingDuplicate(artist: string, title: string): ExistingDuplicateTrack | null {
    const normTitle = normalizeForMatching(title);
    if (!normTitle) return null;

    const entryArtists = extractArtistVariants(artist);
    const allRows = this.dbContext.sqlite
      .prepare(
        `
        SELECT
          t.id,
          t.title,
          ar.name AS artistName,
          al.title AS albumTitle,
          t.file_path AS filePath,
          t.codec,
          t.bitrate
        FROM tracks t
        JOIN artists ar ON ar.id = t.artist_id
        JOIN albums al ON al.id = t.album_id
      `,
      )
      .all() as ExistingDuplicateTrack[];

    for (const row of allRows) {
      // Ignore stale SQLite entries whose files were already removed on disk
      if (!fs.existsSync(row.filePath)) continue;
      if (normalizeForMatching(row.title) !== normTitle) continue;
      if (entryArtists.length === 0) return row;

      const rowArtistNorm = normalizeForMatching(row.artistName);
      const rowVariants = extractArtistVariants(row.artistName);
      if (
        rowVariants.some((v) => entryArtists.includes(v)) ||
        entryArtists.some(
          (ea) => ea.length >= 3 && (rowArtistNorm.includes(ea) || ea.includes(rowArtistNorm)),
        )
      ) {
        return row;
      }
    }

    return null;
  }

  private async tryMatchSingleTrack(
    file: ImportSourceFile,
    detectedArtist: string,
    detectedAlbum: string,
    threshold: number,
  ): Promise<{
    title: string;
    artist: string;
    albumArtist: string;
    album: string;
    year: number | null;
    genre: string | null;
    trackNumber: number | null;
    discNumber: number | null;
    coverArtUrl: string | null;
  } | null> {
    if (!this.metadataLookup) return null;

    const cleanTitle = stripLeadingTrackNumber(file.currentTitle);
    const rawArtist =
      file.currentArtist.trim() ||
      (detectedArtist !== "Unknown Artist" && !isCompilationArtist(detectedArtist)
        ? detectedArtist
        : "");
    const cleanArtist = isCompilationArtist(rawArtist) ? "" : rawArtist;
    if (!cleanTitle || !cleanArtist) return null;

    let suggestions;
    try {
      suggestions = await this.metadataLookup.lookup({
        provider: "deezer",
        title: cleanTitle,
        artist: cleanArtist,
        album:
          file.currentAlbum && !file.currentAlbum.toLowerCase().includes("now that")
            ? file.currentAlbum
            : undefined,
      });
    } catch {
      return null;
    }

    const normQueryTitle = normalizeForMatching(cleanTitle);
    const queryArtists = extractArtistVariants(cleanArtist);

    for (const s of suggestions) {
      const sTitle = s.fields.title?.trim() ?? "";
      const sArtist = s.fields.artists?.trim() || s.fields.albumArtist?.trim() || "";
      const sAlbum = s.fields.album?.trim() || "";
      if (!sTitle || !sArtist || !sAlbum) continue;

      const normSTitle = normalizeForMatching(sTitle);
      const sArtistNorm = normalizeForMatching(sArtist);
      const titleExact = normSTitle === normQueryTitle;
      const artistMatches = queryArtists.some(
        (qa) =>
          qa === sArtistNorm ||
          (qa.length >= 3 && (sArtistNorm.includes(qa) || qa.includes(sArtistNorm))),
      );

      const score = (titleExact ? 55 : 0) + (artistMatches ? 40 : 0);
      if (score >= threshold) {
        return {
          title: sTitle,
          artist: sArtist,
          albumArtist: s.fields.albumArtist?.trim() || sArtist,
          album: sAlbum,
          year: s.fields.year ?? null,
          genre: s.fields.genres?.trim() || null,
          trackNumber: s.fields.trackNumber ?? file.trackNumber ?? 1,
          discNumber: s.fields.discNumber ?? file.discNumber ?? 1,
          coverArtUrl: s.coverArtUrl,
        };
      }
    }

    // Silence unused parameter lint
    void detectedAlbum;
    return null;
  }

  private async tryDownloadCoverArt(
    url: string,
  ): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    if (!isAllowedCoverArtUrl(url)) return null;
    try {
      const res = await this.fetchImpl(url, {
        headers: { "User-Agent": "MusicOrbit/0.1.0 (https://github.com/musicorbit)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < 16 || buf.length > 5 * 1024 * 1024) return null;
      const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
      return { bytes: buf, mimeType: mime };
    } catch {
      return null;
    }
  }

  private async inspectSourceFiles(filePaths: string[]): Promise<ImportSourceFile[]> {
    const results: ImportSourceFile[] = [];
    const isSingle = filePaths.length === 1;

    for (const filePath of filePaths) {
      const basename = path.basename(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const rawBase = path.basename(filePath, extension);
      const fileHints = parseFolderHints(rawBase);

      let currentTitle = fileHints.album || stripLeadingTrackNumber(rawBase) || rawBase;
      let currentArtist = fileHints.artist ?? "";
      let currentAlbum = "";
      let trackNumber: number | null = null;
      let discNumber: number | null = null;
      let durationSeconds: number | null = null;
      let codec: string | null = extension.slice(1).toUpperCase() || null;
      let bitrate: number | null = null;

      try {
        const meta = await parseFile(filePath, { duration: true });
        if (meta.common.title?.trim()) {
          currentTitle = meta.common.title.trim();
        }
        const trackArt = meta.common.artist?.trim() || "";
        const albumArt = meta.common.albumartist?.trim() || "";
        // Prefer track artist on single tracks or compilations ("Various Artists")
        if (isSingle || !albumArt || isCompilationArtist(albumArt)) {
          currentArtist = trackArt || albumArt || currentArtist;
        } else {
          currentArtist = albumArt || trackArt || currentArtist;
        }
        currentAlbum = meta.common.album?.trim() || "";
        trackNumber = meta.common.track.no ?? null;
        discNumber = meta.common.disk.no ?? null;
        durationSeconds = meta.format.duration ?? null;
        codec = meta.format.codec ?? meta.format.container ?? codec;
        bitrate = meta.format.bitrate ? Math.round(meta.format.bitrate) : null;
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
        codec,
        bitrate,
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

  private async transferFolderCovers(
    sourceDir: string,
    destinationDir: string,
    fileAction: "move" | "copy",
  ): Promise<void> {
    try {
      const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!COVER_IMAGE_NAMES.has(entry.name.toLowerCase())) continue;
        const src = path.join(sourceDir, entry.name);
        const dest = path.join(destinationDir, entry.name);
        if (!fs.existsSync(dest)) {
          if (fileAction === "copy") {
            await copyFileSafe(src, dest);
          } else {
            await moveFileSafe(src, dest);
          }
        }
      }
    } catch {
      // Non-fatal
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
