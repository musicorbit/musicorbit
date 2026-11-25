import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import type { FastifyBaseLogger } from "fastify";
import type {
  LyricsBatchJobStatus,
  LyricsLibraryStatsResponse,
  SyncedLyricLine,
  TrackLyricsResponse,
  TrackLyricsSource,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { ActivityLogService } from "./activityLog.js";

const LRCLIB_BASE = "https://lrclib.net/api";
const USER_AGENT = "MusicOrbit/0.1.0 ( https://github.com/musicorbit/musicorbit )";
const LRC_TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_OFFSET_RE = /^\[offset:\s*([+-]?\d+)\s*\]$/i;
const LRC_META_TAG_RE = /^\[(ti|ar|al|au|by|re|ve|length):.*\]$/i;

interface LrclibRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface TrackRowForLyrics {
  id: number;
  title: string;
  artistName: string;
  albumTitle: string;
  durationSeconds: number | null;
  filePath: string;
}

interface CachedLyricsRow {
  trackId: number;
  source: TrackLyricsSource;
  syncedLrc: string | null;
  plainLyrics: string | null;
  instrumental: number;
  updatedAt: number;
}

export interface LyricsServiceDeps {
  dbContext: DbContext;
  activityLog?: ActivityLogService;
  logger?: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
  /** Polite delay between LRCLIB calls during batch fetch (default 350ms, 0 in tests). */
  batchDelayMs?: number;
}

/**
 * Returns the standard .lrc sidecar path beside an audio file (Navidrome / Symfonium compatible).
 */
export function getSidecarLrcPath(audioFilePath: string): string {
  const parsed = path.parse(audioFilePath);
  return path.join(parsed.dir, `${parsed.name}.lrc`);
}

/**
 * Parses standard LRC text (including multi-timestamp lines and [offset:ms]) into
 * sorted timestamped lines suitable for real-time sing-along highlighting and seeking.
 */
export function parseLrc(rawLrc: string | null | undefined): SyncedLyricLine[] {
  if (!rawLrc) return [];

  let offsetSeconds = 0;
  const rawLines = rawLrc.replace(/^\uFEFF/, "").split(/\r?\n/);

  // First pass: detect optional [offset:ms] tag
  for (const line of rawLines) {
    const m = LRC_OFFSET_RE.exec(line.trim());
    if (m?.[1]) {
      const ms = Number.parseInt(m[1], 10);
      if (Number.isFinite(ms)) {
        // Per LRC spec, positive offset shifts lyrics earlier (subtract from timestamp)
        offsetSeconds = -ms / 1000;
      }
      break;
    }
  }

  const parsed: SyncedLyricLine[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed || LRC_META_TAG_RE.test(trimmed) || LRC_OFFSET_RE.test(trimmed)) {
      continue;
    }

    const timestamps: number[] = [];
    LRC_TIMESTAMP_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LRC_TIMESTAMP_RE.exec(trimmed)) !== null) {
      const mins = Number.parseInt(match[1] ?? "0", 10);
      const secs = Number.parseInt(match[2] ?? "0", 10);
      const fracRaw = match[3] ?? "";
      let frac = 0;
      if (fracRaw.length === 1) frac = Number.parseInt(fracRaw, 10) / 10;
      else if (fracRaw.length === 2) frac = Number.parseInt(fracRaw, 10) / 100;
      else if (fracRaw.length === 3) frac = Number.parseInt(fracRaw, 10) / 1000;

      const total = Math.max(0, mins * 60 + secs + frac + offsetSeconds);
      timestamps.push(Math.round(total * 1000) / 1000);
    }

    if (timestamps.length === 0) continue;

    const text = trimmed.replace(LRC_TIMESTAMP_RE, "").trim();
    for (const ts of timestamps) {
      parsed.push({ timeSeconds: ts, text });
    }
  }

  parsed.sort((a, b) => a.timeSeconds - b.timeSeconds);

  // Drop trailing blank lines and collapse consecutive empty instrumental lines
  const cleaned: SyncedLyricLine[] = [];
  for (const entry of parsed) {
    if (!entry.text) {
      const prev = cleaned[cleaned.length - 1];
      if (!prev || !prev.text) continue;
    }
    cleaned.push(entry);
  }
  while (cleaned.length > 0 && !cleaned[cleaned.length - 1]?.text) {
    cleaned.pop();
  }

  return cleaned;
}

export function stripLrcToPlain(rawLrc: string): string {
  const lines = parseLrc(rawLrc);
  if (lines.length === 0) return rawLrc.trim();
  return lines.map((l) => l.text).join("\n").trim();
}

function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\((?:feat\.?|ft\.?|featuring|with)\b[^)]*\)/gi, " ")
    .replace(/\[(?:feat\.?|ft\.?|featuring|with)\b[^\]]*\]/gi, " ")
    .replace(/\b(?:feat\.?|ft\.?|featuring)\s+.+$/gi, " ")
    .replace(/\s*[-–—]\s*(?:\d{4}\s+)?(?:remaster(?:ed)?|album version|radio edit|explicit|clean).*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompare(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Manages synced & plain lyrics across .lrc sidecar files (Navidrome/Symfonium compatible),
 * embedded tags, SQLite cache, and LRCLIB (with exact duration matching & polite bulk backfill).
 */
export class LyricsService {
  private readonly dbContext: DbContext;
  private readonly activityLog?: ActivityLogService;
  private readonly logger?: FastifyBaseLogger;
  private readonly fetchImpl: typeof fetch;
  private readonly batchDelayMs: number;

  private readonly batchJobs = new Map<
    number,
    { status: LyricsBatchJobStatus; cancelRequested: boolean }
  >();

  constructor(deps: LyricsServiceDeps) {
    this.dbContext = deps.dbContext;
    this.activityLog = deps.activityLog;
    this.logger = deps.logger;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.batchDelayMs = deps.batchDelayMs ?? 350;
  }

  private getOrCreateBatchJob(userId: number): {
    status: LyricsBatchJobStatus;
    cancelRequested: boolean;
  } {
    let entry = this.batchJobs.get(userId);
    if (!entry) {
      entry = {
        status: {
          state: "idle",
          total: 0,
          processed: 0,
          syncedFound: 0,
          plainFound: 0,
          instrumental: 0,
          notFound: 0,
          errors: 0,
          currentTrackTitle: null,
          startedAt: null,
          finishedAt: null,
        },
        cancelRequested: false,
      };
      this.batchJobs.set(userId, entry);
    }
    return entry;
  }

  private getTrackById(trackId: number, userId?: number): TrackRowForLyrics | null {
    const sql =
      userId !== undefined
        ? `
        SELECT
          t.id,
          t.title,
          ar.name AS artistName,
          al.title AS albumTitle,
          t.duration_seconds AS durationSeconds,
          t.file_path AS filePath
        FROM tracks t
        JOIN artists ar ON ar.id = t.artist_id
        JOIN albums al ON al.id = t.album_id
        WHERE t.id = ? AND t.user_id = ?
      `
        : `
        SELECT
          t.id,
          t.title,
          ar.name AS artistName,
          al.title AS albumTitle,
          t.duration_seconds AS durationSeconds,
          t.file_path AS filePath
        FROM tracks t
        JOIN artists ar ON ar.id = t.artist_id
        JOIN albums al ON al.id = t.album_id
        WHERE t.id = ?
      `;
    const row = (
      userId !== undefined
        ? this.dbContext.sqlite.prepare(sql).get(trackId, userId)
        : this.dbContext.sqlite.prepare(sql).get(trackId)
    ) as TrackRowForLyrics | undefined;
    return row ?? null;
  }

  private readCache(trackId: number): CachedLyricsRow | null {
    const row = this.dbContext.sqlite
      .prepare(
        `
        SELECT
          track_id AS trackId,
          source,
          synced_lrc AS syncedLrc,
          plain_lyrics AS plainLyrics,
          instrumental,
          updated_at AS updatedAt
        FROM track_lyrics
        WHERE track_id = ?
      `,
      )
      .get(trackId) as CachedLyricsRow | undefined;
    return row ?? null;
  }

  private writeCache(
    trackId: number,
    data: {
      source: TrackLyricsSource;
      syncedLrc: string | null;
      plainLyrics: string | null;
      instrumental: boolean;
    },
  ): number {
    const now = Date.now();
    this.dbContext.sqlite
      .prepare(
        `
        INSERT INTO track_lyrics (track_id, source, synced_lrc, plain_lyrics, instrumental, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(track_id) DO UPDATE SET
          source = excluded.source,
          synced_lrc = excluded.synced_lrc,
          plain_lyrics = excluded.plain_lyrics,
          instrumental = excluded.instrumental,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        trackId,
        data.source,
        data.syncedLrc,
        data.plainLyrics,
        data.instrumental ? 1 : 0,
        now,
      );
    return now;
  }

  private buildResponse(
    trackId: number,
    filePath: string,
    row: {
      source: TrackLyricsSource;
      syncedLrc: string | null;
      plainLyrics: string | null;
      instrumental: boolean;
      updatedAt: number;
    },
  ): TrackLyricsResponse {
    const syncedLines = parseLrc(row.syncedLrc);
    const plain =
      row.plainLyrics?.trim() || (syncedLines.length > 0 ? stripLrcToPlain(row.syncedLrc!) : null);
    const sidecarPath = getSidecarLrcPath(filePath);
    const lrcPath = fs.existsSync(sidecarPath) ? sidecarPath : null;

    return {
      trackId,
      hasSynced: syncedLines.length > 0,
      hasPlain: Boolean(plain),
      instrumental: row.instrumental,
      source: row.source,
      syncedLines,
      plainLyrics: plain,
      lrcPath,
      fetchedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private async readEmbeddedLyrics(filePath: string): Promise<{
    syncedLrc: string | null;
    plainLyrics: string | null;
  }> {
    if (!fs.existsSync(filePath)) return { syncedLrc: null, plainLyrics: null };
    try {
      const meta = await parseFile(filePath, { duration: false, skipCovers: true });
      const rawEntries = meta.common.lyrics;
      if (!rawEntries || rawEntries.length === 0) {
        return { syncedLrc: null, plainLyrics: null };
      }

      const chunks: string[] = [];
      for (const entry of rawEntries) {
        if (typeof entry === "string") {
          chunks.push(entry);
        } else if (entry && typeof entry === "object") {
          if (typeof entry.text === "string" && entry.text.trim()) {
            chunks.push(entry.text);
          } else if (Array.isArray(entry.syncText) && entry.syncText.length > 0) {
            const formatted = entry.syncText
              .map((line) => {
                const totalSec = Math.max(0, (line.timestamp ?? 0) / 1000);
                const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
                const ss = (totalSec % 60).toFixed(2).padStart(5, "0");
                return `[${mm}:${ss}]${line.text ?? ""}`;
              })
              .join("\n");
            if (formatted.trim()) chunks.push(formatted);
          }
        }
      }

      const combined = chunks.join("\n").trim();
      if (!combined) return { syncedLrc: null, plainLyrics: null };

      const parsed = parseLrc(combined);
      if (parsed.length > 0) {
        return { syncedLrc: combined, plainLyrics: stripLrcToPlain(combined) };
      }
      return { syncedLrc: null, plainLyrics: combined };
    } catch {
      return { syncedLrc: null, plainLyrics: null };
    }
  }

  private async writeSidecarLrcSafe(audioFilePath: string, syncedLrc: string): Promise<string | null> {
    if (!syncedLrc.trim()) return null;
    if (!fs.existsSync(audioFilePath)) return null;
    const lrcPath = getSidecarLrcPath(audioFilePath);
    try {
      await fsp.writeFile(lrcPath, `${syncedLrc.trim()}\n`, "utf8");
      return lrcPath;
    } catch (err) {
      this.logger?.warn({ err, lrcPath }, "Could not write .lrc sidecar file");
      return null;
    }
  }

  /**
   * Queries LRCLIB using exact duration matching (/api/get) first, falling back to /api/search
   * scored by synced availability + closest duration match.
   */
  async fetchFromLrclib(params: {
    artist: string;
    title: string;
    album?: string;
    durationSeconds?: number | null;
  }): Promise<{
    syncedLrc: string | null;
    plainLyrics: string | null;
    instrumental: boolean;
  } | null> {
    const artist = params.artist.trim();
    const title = params.title.trim();
    if (!title || !artist || artist.toLowerCase() === "unknown artist") {
      return null;
    }

    const cleanedTitle = cleanTitleForSearch(title) || title;
    const album = params.album?.trim() && params.album.toLowerCase() !== "unknown album"
      ? params.album.trim()
      : "";
    const duration =
      params.durationSeconds && params.durationSeconds > 5
        ? Math.round(params.durationSeconds)
        : null;

    // 1. Exact LRCLIB /api/get (best timestamp alignment because duration is matched!)
    const tryExactGet = async (trackName: string): Promise<LrclibRecord | null> => {
      const sp = new URLSearchParams({
        artist_name: artist,
        track_name: trackName,
      });
      if (album) sp.set("album_name", album);
      if (duration !== null) sp.set("duration", String(duration));

      try {
        const res = await this.fetchImpl(`${LRCLIB_BASE}/get?${sp.toString()}`, {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return null;
        return (await res.json()) as LrclibRecord;
      } catch {
        return null;
      }
    };

    let exact = await tryExactGet(title);
    if (!exact && cleanedTitle !== title) {
      exact = await tryExactGet(cleanedTitle);
    }

    if (exact && (exact.syncedLyrics?.trim() || exact.plainLyrics?.trim() || exact.instrumental)) {
      const synced = exact.syncedLyrics?.trim() || null;
      const plain = exact.plainLyrics?.trim() || (synced ? stripLrcToPlain(synced) : null);
      if (synced && parseLrc(synced).length > 0) {
        return { syncedLrc: synced, plainLyrics: plain, instrumental: Boolean(exact.instrumental) };
      }
      if (exact.instrumental) {
        return { syncedLrc: null, plainLyrics: null, instrumental: true };
      }
      // If exact match only had plain lyrics, check search briefly to see if a synced version exists
      const searched = await this.searchLrclibBest(artist, cleanedTitle, duration);
      if (searched?.syncedLrc) {
        return searched;
      }
      return { syncedLrc: null, plainLyrics: plain, instrumental: false };
    }

    // 2. Fallback: LRCLIB /api/search scored by synced + duration closeness
    return this.searchLrclibBest(artist, cleanedTitle, duration);
  }

  private async searchLrclibBest(
    artist: string,
    title: string,
    duration: number | null,
  ): Promise<{
    syncedLrc: string | null;
    plainLyrics: string | null;
    instrumental: boolean;
  } | null> {
    const sp = new URLSearchParams({
      artist_name: artist,
      track_name: title,
    });
    let records: LrclibRecord[] = [];
    try {
      const res = await this.fetchImpl(`${LRCLIB_BASE}/search?${sp.toString()}`, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as unknown;
      if (Array.isArray(body)) {
        records = body as LrclibRecord[];
      }
    } catch {
      return null;
    }

    if (records.length === 0) return null;

    const normTargetArtist = normalizeCompare(artist);
    const normTargetTitle = normalizeCompare(title);

    let best: { rec: LrclibRecord; score: number } | null = null;
    for (const rec of records) {
      const hasSynced = Boolean(rec.syncedLyrics?.trim() && parseLrc(rec.syncedLyrics).length > 0);
      const hasPlain = Boolean(rec.plainLyrics?.trim());
      if (!hasSynced && !hasPlain && !rec.instrumental) continue;

      let score = 0;
      if (hasSynced) score += 50;
      else if (hasPlain) score += 20;
      else if (rec.instrumental) score += 10;

      const candTitle = normalizeCompare(rec.trackName ?? "");
      const candArtist = normalizeCompare(rec.artistName ?? "");
      if (candTitle === normTargetTitle) score += 30;
      else if (candTitle.includes(normTargetTitle) || normTargetTitle.includes(candTitle)) score += 15;
      else score -= 25;

      if (candArtist === normTargetArtist) score += 25;
      else if (candArtist.includes(normTargetArtist) || normTargetArtist.includes(candArtist)) score += 12;
      else score -= 25;

      if (duration !== null && typeof rec.duration === "number" && rec.duration > 0) {
        const diff = Math.abs(rec.duration - duration);
        if (diff <= 2) score += 25;
        else if (diff <= 5) score += 15;
        else if (diff <= 10) score += 5;
        else score -= Math.min(30, Math.round(diff / 2));
      }

      if (!best || score > best.score) {
        best = { rec, score };
      }
    }

    if (!best || best.score < 20) return null;

    const synced = best.rec.syncedLyrics?.trim() || null;
    const validSynced = synced && parseLrc(synced).length > 0 ? synced : null;
    const plain =
      best.rec.plainLyrics?.trim() || (validSynced ? stripLrcToPlain(validSynced) : null);

    return {
      syncedLrc: validSynced,
      plainLyrics: plain,
      instrumental: Boolean(best.rec.instrumental && !validSynced && !plain),
    };
  }

  /**
   * Resolves lyrics for a track using the priority chain:
   *  1) .lrc sidecar file on disk
   *  2) SQLite track_lyrics cache
   *  3) Embedded lyrics inside the audio file
   *  4) LRCLIB fetch (writes .lrc sidecar + caches in SQLite)
   */
  async getTrackLyrics(
    trackId: number,
    options?: { refresh?: boolean; userId?: number },
  ): Promise<TrackLyricsResponse | null> {
    const track = this.getTrackById(trackId, options?.userId);
    if (!track) return null;

    const forceRefresh = Boolean(options?.refresh);
    const sidecarPath = getSidecarLrcPath(track.filePath);

    if (!forceRefresh) {
      // 1. Check .lrc sidecar file next to audio file
      if (fs.existsSync(sidecarPath)) {
        try {
          const rawSidecar = await fsp.readFile(sidecarPath, "utf8");
          const trimmed = rawSidecar.trim();
          if (trimmed) {
            const parsed = parseLrc(trimmed);
            const syncedLrc = parsed.length > 0 ? trimmed : null;
            const plainLyrics = parsed.length > 0 ? stripLrcToPlain(trimmed) : trimmed;
            const updatedAt = this.writeCache(track.id, {
              source: "sidecar",
              syncedLrc,
              plainLyrics,
              instrumental: false,
            });
            return this.buildResponse(track.id, track.filePath, {
              source: "sidecar",
              syncedLrc,
              plainLyrics,
              instrumental: false,
              updatedAt,
            });
          }
        } catch {
          // Fall through to cache / embedded / LRCLIB
        }
      }

      // 2. Check SQLite cache
      const cached = this.readCache(track.id);
      if (cached) {
        return this.buildResponse(track.id, track.filePath, {
          source: cached.source,
          syncedLrc: cached.syncedLrc,
          plainLyrics: cached.plainLyrics,
          instrumental: Boolean(cached.instrumental),
          updatedAt: cached.updatedAt,
        });
      }

      // 3. Check embedded audio tags — if embedded tags already contain synced LRC, use immediately;
      //    if they only contain plain unsynced text, keep as fallback and still check LRCLIB for synced!
      const embedded = await this.readEmbeddedLyrics(track.filePath);
      if (embedded.syncedLrc) {
        await this.writeSidecarLrcSafe(track.filePath, embedded.syncedLrc);
        const updatedAt = this.writeCache(track.id, {
          source: "embedded",
          syncedLrc: embedded.syncedLrc,
          plainLyrics: embedded.plainLyrics,
          instrumental: false,
        });
        return this.buildResponse(track.id, track.filePath, {
          source: "embedded",
          syncedLrc: embedded.syncedLrc,
          plainLyrics: embedded.plainLyrics,
          instrumental: false,
          updatedAt,
        });
      }

      // 4. Fetch from LRCLIB & save .lrc sidecar + SQLite cache (preferring synced over embedded plain)
      const fetched = await this.fetchFromLrclib({
        artist: track.artistName,
        title: track.title,
        album: track.albumTitle,
        durationSeconds: track.durationSeconds,
      });

      if (fetched && (fetched.syncedLrc || fetched.instrumental || !embedded.plainLyrics)) {
        if (fetched.syncedLrc) {
          await this.writeSidecarLrcSafe(track.filePath, fetched.syncedLrc);
        }
        const updatedAt = this.writeCache(track.id, {
          source: "lrclib",
          syncedLrc: fetched.syncedLrc,
          plainLyrics: fetched.plainLyrics ?? embedded.plainLyrics,
          instrumental: fetched.instrumental,
        });
        return this.buildResponse(track.id, track.filePath, {
          source: "lrclib",
          syncedLrc: fetched.syncedLrc,
          plainLyrics: fetched.plainLyrics ?? embedded.plainLyrics,
          instrumental: fetched.instrumental,
          updatedAt,
        });
      }

      if (embedded.plainLyrics) {
        const updatedAt = this.writeCache(track.id, {
          source: "embedded",
          syncedLrc: null,
          plainLyrics: embedded.plainLyrics,
          instrumental: false,
        });
        return this.buildResponse(track.id, track.filePath, {
          source: "embedded",
          syncedLrc: null,
          plainLyrics: embedded.plainLyrics,
          instrumental: false,
          updatedAt,
        });
      }

      // Cache miss so repeat plays don't hammer LRCLIB (user can manually refresh anytime)
      const updatedAt = this.writeCache(track.id, {
        source: "none",
        syncedLrc: null,
        plainLyrics: null,
        instrumental: false,
      });
      return this.buildResponse(track.id, track.filePath, {
        source: "none",
        syncedLrc: null,
        plainLyrics: null,
        instrumental: false,
        updatedAt,
      });
    }

    // Explicit refresh: query LRCLIB directly
    const fetched = await this.fetchFromLrclib({
      artist: track.artistName,
      title: track.title,
      album: track.albumTitle,
      durationSeconds: track.durationSeconds,
    });

    if (fetched) {
      if (fetched.syncedLrc) {
        await this.writeSidecarLrcSafe(track.filePath, fetched.syncedLrc);
      }
      const updatedAt = this.writeCache(track.id, {
        source: "lrclib",
        syncedLrc: fetched.syncedLrc,
        plainLyrics: fetched.plainLyrics,
        instrumental: fetched.instrumental,
      });
      return this.buildResponse(track.id, track.filePath, {
        source: "lrclib",
        syncedLrc: fetched.syncedLrc,
        plainLyrics: fetched.plainLyrics,
        instrumental: fetched.instrumental,
        updatedAt,
      });
    }

    const updatedAt = this.writeCache(track.id, {
      source: "none",
      syncedLrc: null,
      plainLyrics: null,
      instrumental: false,
    });
    return this.buildResponse(track.id, track.filePath, {
      source: "none",
      syncedLrc: null,
      plainLyrics: null,
      instrumental: false,
      updatedAt,
    });
  }

  /**
   * Used by the Post-Processing pipeline when autoFetchLyrics is enabled: fetches synced
   * lyrics from LRCLIB and writes a .lrc sidecar next to the newly imported file.
   */
  async fetchAndWriteSidecarForFile(params: {
    filePath: string;
    artist: string;
    title: string;
    album?: string;
    durationSeconds?: number | null;
  }): Promise<{ syncedLrc: string | null; plainLyrics: string | null; lrcPath: string | null }> {
    const fetched = await this.fetchFromLrclib(params);
    if (!fetched) {
      return { syncedLrc: null, plainLyrics: null, lrcPath: null };
    }
    const lrcPath = fetched.syncedLrc
      ? await this.writeSidecarLrcSafe(params.filePath, fetched.syncedLrc)
      : null;
    return {
      syncedLrc: fetched.syncedLrc,
      plainLyrics: fetched.plainLyrics,
      lrcPath,
    };
  }

  /**
   * Returns per-user library lyrics coverage counts + current batch fetch status.
   */
  getStats(userId = 1): LyricsLibraryStatsResponse {
    const rows = this.dbContext.sqlite
      .prepare(
        `
        SELECT
          t.id,
          t.file_path AS filePath,
          tl.source,
          tl.synced_lrc AS syncedLrc,
          tl.plain_lyrics AS plainLyrics,
          tl.instrumental
        FROM tracks t
        LEFT JOIN track_lyrics tl ON tl.track_id = t.id
        WHERE t.user_id = ?
      `,
      )
      .all(userId) as Array<{
      id: number;
      filePath: string;
      source: TrackLyricsSource | null;
      syncedLrc: string | null;
      plainLyrics: string | null;
      instrumental: number | null;
    }>;

    let withSyncedLyrics = 0;
    let withPlainOnly = 0;
    let instrumental = 0;
    let missingLyrics = 0;

    for (const row of rows) {
      if (row.syncedLrc && row.syncedLrc.trim().length > 0) {
        withSyncedLyrics += 1;
      } else if (fs.existsSync(getSidecarLrcPath(row.filePath))) {
        withSyncedLyrics += 1;
      } else if (row.instrumental) {
        instrumental += 1;
      } else if (row.plainLyrics && row.plainLyrics.trim().length > 0) {
        withPlainOnly += 1;
      } else {
        missingLyrics += 1;
      }
    }

    const job = this.getOrCreateBatchJob(userId);
    return {
      totalTracks: rows.length,
      withSyncedLyrics,
      withPlainOnly,
      instrumental,
      missingLyrics,
      job: { ...job.status },
    };
  }

  /**
   * Starts a polite background job to fetch missing synced lyrics across a user's library.
   */
  startBatchFetch(options?: {
    userId?: number;
    retryNotFound?: boolean;
    trackIds?: number[];
  }): LyricsBatchJobStatus {
    const userId = options?.userId ?? 1;
    const job = this.getOrCreateBatchJob(userId);
    if (job.status.state === "running") {
      return { ...job.status };
    }

    const retryNotFound = Boolean(options?.retryNotFound);
    const filterTrackIds = options?.trackIds ? new Set(options.trackIds) : null;
    const rows = this.dbContext.sqlite
      .prepare(
        `
        SELECT
          t.id,
          t.title,
          ar.name AS artistName,
          al.title AS albumTitle,
          t.duration_seconds AS durationSeconds,
          t.file_path AS filePath,
          tl.source AS cachedSource,
          tl.synced_lrc AS syncedLrc,
          tl.instrumental AS instrumental
        FROM tracks t
        JOIN artists ar ON ar.id = t.artist_id
        JOIN albums al ON al.id = t.album_id
        LEFT JOIN track_lyrics tl ON tl.track_id = t.id
        WHERE t.user_id = ?
        ORDER BY t.id ASC
      `,
      )
      .all(userId) as Array<
      TrackRowForLyrics & {
        cachedSource: TrackLyricsSource | null;
        syncedLrc: string | null;
        instrumental: number | null;
      }
    >;

    const targets = rows.filter((row) => {
      if (filterTrackIds && !filterTrackIds.has(row.id)) return false;
      if (row.syncedLrc && row.syncedLrc.trim().length > 0) return false;
      if (row.instrumental) return false;
      if (fs.existsSync(getSidecarLrcPath(row.filePath))) return false;
      if (!retryNotFound && row.cachedSource === "none") return false;
      return true;
    });

    job.cancelRequested = false;
    job.status = {
      state: targets.length === 0 ? "completed" : "running",
      total: targets.length,
      processed: 0,
      syncedFound: 0,
      plainFound: 0,
      instrumental: 0,
      notFound: 0,
      errors: 0,
      currentTrackTitle: targets[0]?.title ?? null,
      startedAt: new Date().toISOString(),
      finishedAt: targets.length === 0 ? new Date().toISOString() : null,
    };

    if (targets.length === 0) {
      return { ...job.status };
    }

    this.activityLog?.info(
      "lyrics",
      `Started fetching synced lyrics for ${targets.length} ${targets.length === 1 ? "track" : "tracks"}`,
      { userId, total: targets.length, retryNotFound },
    );

    void (async () => {
      for (const track of targets) {
        if (job.cancelRequested) {
          job.status.state = "cancelled";
          job.status.currentTrackTitle = null;
          job.status.finishedAt = new Date().toISOString();
          this.activityLog?.warn(
            "lyrics",
            `Lyrics fetch cancelled after ${job.status.processed} of ${job.status.total} tracks`,
            { userId, ...job.status },
          );
          return;
        }

        job.status.currentTrackTitle = `${track.artistName} — ${track.title}`;
        try {
          const res = await this.getTrackLyrics(track.id, {
            userId,
            refresh: retryNotFound && track.cachedSource === "none",
          });
          if (res?.hasSynced) job.status.syncedFound += 1;
          else if (res?.instrumental) job.status.instrumental += 1;
          else if (res?.hasPlain) job.status.plainFound += 1;
          else job.status.notFound += 1;
        } catch {
          job.status.errors += 1;
        } finally {
          job.status.processed += 1;
        }

        if (this.batchDelayMs > 0 && !job.cancelRequested) {
          await new Promise((r) => setTimeout(r, this.batchDelayMs));
        }
      }

      job.status.state = "completed";
      job.status.currentTrackTitle = null;
      job.status.finishedAt = new Date().toISOString();
      this.activityLog?.success(
        "lyrics",
        `Lyrics fetch completed: ${job.status.syncedFound} synced, ${job.status.plainFound} plain, ${job.status.notFound} not found`,
        { userId, ...job.status },
      );
    })();

    return { ...job.status };
  }

  cancelBatchFetch(userId = 1): LyricsBatchJobStatus {
    const job = this.getOrCreateBatchJob(userId);
    if (job.status.state === "running") {
      job.cancelRequested = true;
    }
    return { ...job.status };
  }
}
