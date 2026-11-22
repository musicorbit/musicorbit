import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { DbContext } from "../db/index.js";

const RETRY_MISS_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB safety limit
const SKIPPED_ARTIST_NAMES = new Set(["unknown artist", "various artists", "va"]);

interface DeezerArtistResult {
  id?: number;
  name?: string;
  nb_fan?: number;
  picture_xl?: string;
  picture_big?: string;
  picture_medium?: string;
}

interface DeezerTrackResult {
  title?: string;
  rank?: number;
  artist?: DeezerArtistResult;
}

interface DeezerArtistSearchResponse {
  data?: DeezerArtistResult[];
}

interface DeezerTrackSearchResponse {
  data?: DeezerTrackResult[];
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isUsableImageUrl(url?: string): url is string {
  if (!url) return false;
  // Deezer uses an empty path segment ("/images/artist//...") for generic blank silhouettes
  if (url.includes("/images/artist//")) return false;
  return true;
}

function pickArtistPictureUrl(artist?: DeezerArtistResult | null): string | null {
  if (!artist) return null;
  for (const candidate of [artist.picture_xl, artist.picture_big, artist.picture_medium]) {
    if (isUsableImageUrl(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extensionForMime(mime: string | null): string {
  const lower = mime?.split(";")[0]?.trim().toLowerCase();
  switch (lower) {
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

export interface ArtistImageServiceDeps {
  dbContext: DbContext;
  artistImagesDir: string;
  enabled: boolean;
  logger?: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches artist portraits lazily on first request via Deezer's free public API
 * (zero API key required) and caches them under DATA_DIR/artist-images.
 *
 * Disambiguation strategy for artists who share the same name (e.g. "Adele"):
 *   1. Search using both artist name + a known track title from the user's library.
 *   2. Fall back to artist search ranked by fan count (nb_fan) among exact name matches.
 */
export class ArtistImageService {
  private readonly dbContext: DbContext;
  private readonly artistImagesDir: string;
  private readonly enabled: boolean;
  private readonly logger?: FastifyBaseLogger;
  private readonly fetchImpl: typeof fetch;
  private readonly inFlight = new Map<number, Promise<string | null>>();

  constructor(deps: ArtistImageServiceDeps) {
    this.dbContext = deps.dbContext;
    this.artistImagesDir = deps.artistImagesDir;
    this.enabled = deps.enabled;
    this.logger = deps.logger;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  /**
   * Resolves the cached portrait filename (e.g. "a1b2c3d4e5f60718.jpg") for an artist.
   * Returns null if disabled, not found, or if the remote lookup fails.
   */
  async resolveArtistImage(artistId: number): Promise<string | null> {
    const row = this.dbContext.sqlite
      .prepare(
        "SELECT id, name, image_hash AS imageHash, image_checked_at AS imageCheckedAt FROM artists WHERE id = ?",
      )
      .get(artistId) as
      | { id: number; name: string; imageHash: string | null; imageCheckedAt: number | null }
      | undefined;

    if (!row) return null;

    // 1. Fast path: already cached on disk
    if (row.imageHash) {
      const safeName = path.basename(row.imageHash);
      if (fs.existsSync(path.join(this.artistImagesDir, safeName))) {
        return safeName;
      }
    }

    // 2. Respect offline/privacy opt-out or generic placeholder artist names
    if (!this.enabled || SKIPPED_ARTIST_NAMES.has(row.name.trim().toLowerCase())) {
      return null;
    }

    // 3. Avoid hammering external APIs if we already checked recently and found nothing
    const nowMs = Date.now();
    if (row.imageCheckedAt && nowMs - row.imageCheckedAt < RETRY_MISS_AFTER_MS) {
      return null;
    }

    // 4. Deduplicate concurrent requests for the same artist ID
    const existingPromise = this.inFlight.get(artistId);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = this.fetchAndCache(artistId, row.name).finally(() => {
      this.inFlight.delete(artistId);
    });
    this.inFlight.set(artistId, promise);
    return promise;
  }

  private getSampleTracks(artistId: number): Array<{ title: string; trackArtistName: string }> {
    const rows = this.dbContext.sqlite
      .prepare(
        `
        SELECT DISTINCT t.title AS title, ar.name AS trackArtistName
        FROM tracks t
        JOIN albums al ON al.id = t.album_id
        JOIN artists ar ON ar.id = t.artist_id
        WHERE t.artist_id = ? OR al.artist_id = ?
        LIMIT 3
      `,
      )
      .all(artistId, artistId) as Array<{ title: string; trackArtistName: string }>;
    return rows.filter((r) => r.title.trim().length > 0);
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MusicOrbit/0.1.0 (+https://github.com/musicorbit/musicorbit)",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  /**
   * Strategy 1: Disambiguate using a track title we already know belongs to this artist.
   * Uses a plain punctuation-stripped query (Deezer's strict quoted track:"..." syntax
   * drops matches on punctuation like "?"), then validates both track title and artist
   * name and picks the highest-ranked match.
   */
  private async findImageViaTrack(
    artistName: string,
    sampleTracks: Array<{ title: string; trackArtistName: string }>,
  ): Promise<string | null> {
    const allowedArtistNames = new Set<string>([normalizeName(artistName)]);
    for (const s of sampleTracks) {
      allowedArtistNames.add(normalizeName(s.trackArtistName));
    }

    const searchQueries: Array<{ query: string; expectedTitle: string }> = [];
    for (const sample of sampleTracks) {
      const cleanTrack = normalizeName(sample.title);
      const cleanAlbumArtist = normalizeName(artistName);
      const cleanTrackArtist = normalizeName(sample.trackArtistName);
      if (!cleanTrack) continue;

      // Prefer the track's own artist name first (handles rebrands like Marina & the Diamonds -> MARINA)
      if (cleanTrackArtist && cleanTrackArtist !== cleanAlbumArtist) {
        searchQueries.push({
          query: `${cleanTrackArtist} ${cleanTrack}`,
          expectedTitle: cleanTrack,
        });
      }
      searchQueries.push({
        query: `${cleanAlbumArtist} ${cleanTrack}`,
        expectedTitle: cleanTrack,
      });
    }

    for (const { query, expectedTitle } of searchQueries) {
      const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=10`;
      const payload = await this.fetchJson<DeezerTrackSearchResponse>(url);
      const tracksList = payload?.data ?? [];

      const matchingTracks = tracksList
        .filter((item) => {
          if (!item.title || !item.artist?.name) return false;
          if (!pickArtistPictureUrl(item.artist)) return false;

          const normTitle = normalizeName(item.title);
          const titleMatches =
            normTitle === expectedTitle ||
            normTitle.startsWith(expectedTitle) ||
            expectedTitle.startsWith(normTitle);
          if (!titleMatches) return false;

          const normCandidateArtist = normalizeName(item.artist.name);
          return allowedArtistNames.has(normCandidateArtist);
        })
        .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));

      if (matchingTracks.length > 0) {
        const pic = pickArtistPictureUrl(matchingTracks[0]?.artist);
        if (pic) return pic;
      }
    }

    return null;
  }

  /**
   * Strategy 2: Fall back to artist search and pick the most popular (highest nb_fan)
   * exact name match across both album artist and any distinct track artist names.
   */
  private async findImageViaArtistSearch(
    artistName: string,
    sampleTracks: Array<{ title: string; trackArtistName: string }>,
  ): Promise<string | null> {
    const namesToTry = Array.from(
      new Set([artistName, ...sampleTracks.map((s) => s.trackArtistName)]),
    );
    const allowedNorms = new Set(namesToTry.map((n) => normalizeName(n)));

    const allMatches: DeezerArtistResult[] = [];
    for (const name of namesToTry) {
      const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=25`;
      const payload = await this.fetchJson<DeezerArtistSearchResponse>(url);
      const candidates = (payload?.data ?? []).filter(
        (c) => c.name && allowedNorms.has(normalizeName(c.name)) && Boolean(pickArtistPictureUrl(c)),
      );
      allMatches.push(...candidates);
    }

    if (allMatches.length === 0) return null;
    allMatches.sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0));
    return pickArtistPictureUrl(allMatches[0]);
  }

  private async fetchAndCache(artistId: number, artistName: string): Promise<string | null> {
    const nowMs = Date.now();
    try {
      const sampleTracks = this.getSampleTracks(artistId);
      const imageUrl =
        (await this.findImageViaTrack(artistName, sampleTracks)) ??
        (await this.findImageViaArtistSearch(artistName, sampleTracks));

      if (!imageUrl) {
        this.markChecked(artistId, null, nowMs);
        return null;
      }

      const imgRes = await this.fetchImpl(imageUrl, {
        signal: AbortSignal.timeout(8000),
      });
      if (!imgRes.ok) {
        return null;
      }

      const contentType = imgRes.headers.get("content-type");
      if (!contentType || !contentType.toLowerCase().startsWith("image/")) {
        return null;
      }

      const arrayBuffer = await imgRes.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
        return null;
      }

      await fsp.mkdir(this.artistImagesDir, { recursive: true });
      const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const fileName = `${hash}.${extensionForMime(contentType)}`;
      const dest = path.join(this.artistImagesDir, fileName);

      if (!fs.existsSync(dest)) {
        await fsp.writeFile(dest, bytes);
      }

      this.markChecked(artistId, fileName, nowMs);
      this.logger?.info({ artistName, fileName }, "Cached artist portrait");
      return fileName;
    } catch (err) {
      // Transient network error: do not stamp imageCheckedAt so it can retry once online
      this.logger?.debug({ err, artistName }, "Could not fetch artist portrait");
      return null;
    }
  }

  private markChecked(artistId: number, imageHash: string | null, checkedAtMs: number): void {
    this.dbContext.sqlite
      .prepare(
        "UPDATE artists SET image_hash = COALESCE(?, image_hash), image_checked_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(imageHash, checkedAtMs, checkedAtMs, artistId);
  }
}
