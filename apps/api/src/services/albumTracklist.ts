import type {
  AlbumExpectedTrack,
  AlbumReleaseOption,
  AlbumTracklistProvider,
  AlbumTracklistResponse,
  TrackSummary,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { MusicBrainzClient } from "./musicbrainz.js";

const DEEZER_API = "https://api.deezer.com";
const USER_AGENT = "MusicOrbit/0.1.0 ( https://github.com/musicorbit/musicorbit )";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface DeezerSearchAlbumItem {
  id: number;
  title?: string;
  nb_tracks?: number;
  record_type?: string;
  artist?: { name?: string };
}

interface DeezerSearchAlbumResponse {
  data?: DeezerSearchAlbumItem[];
}

interface DeezerAlbumTrackItem {
  id: number;
  title?: string;
  duration?: number;
  track_position?: number;
  disk_number?: number;
  artist?: { name?: string };
}

interface DeezerAlbumFullResponse {
  id: number;
  title?: string;
  nb_tracks?: number;
  release_date?: string;
  artist?: { name?: string };
  tracks?: {
    data?: DeezerAlbumTrackItem[];
  };
}

interface RawExpectedTrack {
  discNumber: number;
  trackNumber: number;
  title: string;
  artist: string;
  durationSeconds: number | null;
}

interface CachedReleaseOptions {
  expiresAt: number;
  releases: AlbumReleaseOption[];
}

export interface AlbumTracklistAlbumInfo {
  id: number;
  title: string;
  artistName: string;
  year: number | null;
  mbid: string | null;
}

export interface AlbumTracklistServiceDeps {
  dbContext?: DbContext;
  musicBrainz: MusicBrainzClient;
  fetchImpl?: typeof fetch;
}

export interface LookupAlbumTracklistOptions {
  releaseId?: string;
  refresh?: boolean;
}

interface TracklistCacheRow {
  albumId: number;
  selectedReleaseId: string | null;
  provider: AlbumTracklistProvider | null;
  selectedReleaseJson: string | null;
  releasesJson: string;
  tracksJson: string;
  updatedAt: number;
}

function parseYear(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const match = /^(\d{4})/.exec(dateStr.trim());
  if (!match?.[1]) return null;
  const year = Number.parseInt(match[1], 10);
  return year > 1800 && year < 2200 ? year : null;
}

/**
 * Strips accents, punctuation, featured-artist clauses, and common edition tags
 * so "West Coast (Radio Edit)" or "Levitating (feat. DaBaby)" matches cleanly
 * against an album's canonical tracklist.
 */
export function normalizeTrackMatchTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:feat\.?|ft\.?|featuring|with)\b[^)]*\)/gi, " ")
    .replace(/\[(?:feat\.?|ft\.?|featuring|with)\b[^\]]*\]/gi, " ")
    .replace(/\b(?:feat\.?|ft\.?|featuring)\s+.+$/gi, " ")
    .replace(
      /\s*[-–—]\s*(?:\d{4}\s+)?(?:remaster(?:ed)?|album version|single version|radio edit|explicit|clean|bonus track|live|acoustic|deluxe).*$/gi,
      " ",
    )
    .replace(
      /\((?:[^)]*(?:remaster(?:ed)?|album version|single version|radio edit|explicit|clean|bonus track|deluxe)[^)]*)\)/gi,
      " ",
    )
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeAlbumCompare(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripAlbumEditionSuffix(value: string): string {
  return value
    .replace(/\s*\([^)]*(?:deluxe|edition|remaster|explicit|clean|expanded|version|special)[^)]*\)/gi, " ")
    .replace(/\s*\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSearchQuery(value: string): string {
  return value
    .replace(/[()[\]"?!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapRatio(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter((t) => t.length >= 2));
  const tokensB = new Set(b.split(" ").filter((t) => t.length >= 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) shared++;
  }
  return shared / Math.max(tokensA.size, tokensB.size);
}

/**
 * Matches expected album tracks against the user's locally owned tracks for that album.
 */
export function matchExpectedTracksToOwned(
  expected: RawExpectedTrack[],
  ownedTracks: TrackSummary[],
): AlbumExpectedTrack[] {
  const usedOwnedIds = new Set<number>();

  // Pre-normalize owned titles
  const ownedNormalized = ownedTracks.map((t) => ({
    track: t,
    exact: normalizeAlbumCompare(t.title),
    core: normalizeTrackMatchTitle(t.title),
  }));

  // Pass 1: exact normalized title or core normalized title match
  const results: AlbumExpectedTrack[] = expected.map((exp) => {
    const expExact = normalizeAlbumCompare(exp.title);
    const expCore = normalizeTrackMatchTitle(exp.title);

    let matched = ownedNormalized.find(
      (o) => !usedOwnedIds.has(o.track.id) && o.exact === expExact && expExact.length > 0,
    );
    if (!matched && expCore.length > 0) {
      matched = ownedNormalized.find(
        (o) => !usedOwnedIds.has(o.track.id) && o.core === expCore,
      );
    }

    if (matched) {
      usedOwnedIds.add(matched.track.id);
    }

    return {
      ...exp,
      ownedTrackId: matched ? matched.track.id : null,
    };
  });

  // Pass 2: fuzzy substring/token match for remaining unmatched tracks (e.g. slight punctuation/remix variants)
  for (const row of results) {
    if (row.ownedTrackId !== null) continue;
    const expCore = normalizeTrackMatchTitle(row.title);
    if (!expCore) continue;

    const candidate = ownedNormalized.find((o) => {
      if (usedOwnedIds.has(o.track.id)) return false;
      if (!o.core) return false;
      if (o.core.length >= 4 && expCore.length >= 4) {
        if (o.core.includes(expCore) || expCore.includes(o.core)) {
          return true;
        }
      }
      if (tokenOverlapRatio(o.core, expCore) >= 0.75) {
        return true;
      }
      // Fallback: same disc + track number AND at least one shared meaningful word
      const samePosition =
        o.track.trackNumber === row.trackNumber &&
        (o.track.discNumber ?? 1) === row.discNumber;
      return samePosition && tokenOverlapRatio(o.core, expCore) >= 0.35;
    });

    if (candidate) {
      usedOwnedIds.add(candidate.track.id);
      row.ownedTrackId = candidate.track.id;
    }
  }

  return results;
}

function scoreReleaseOption(
  option: AlbumReleaseOption,
  album: AlbumTracklistAlbumInfo,
  ownedCount: number,
): number {
  const targetTitle = normalizeAlbumCompare(album.title);
  const targetBaseTitle = normalizeAlbumCompare(stripAlbumEditionSuffix(album.title));
  const targetArtist = normalizeAlbumCompare(album.artistName);

  const candTitle = normalizeAlbumCompare(option.title);
  const candBaseTitle = normalizeAlbumCompare(stripAlbumEditionSuffix(option.title));
  const candArtist = normalizeAlbumCompare(option.artist);

  let score = 0;

  // Title agreement (strongest signal — preserves Deluxe vs Standard preference)
  if (candTitle === targetTitle) {
    score += 50;
  } else if (candBaseTitle && candBaseTitle === targetBaseTitle) {
    score += 36;
  } else if (targetTitle && (candTitle.includes(targetTitle) || targetTitle.includes(candTitle))) {
    score += 24;
  } else if (
    targetBaseTitle &&
    (candTitle.includes(targetBaseTitle) || targetBaseTitle.includes(candTitle))
  ) {
    score += 18;
  }

  // Artist agreement
  if (targetArtist && targetArtist !== "unknown artist") {
    if (candArtist === targetArtist) {
      score += 30;
    } else if (candArtist.includes(targetArtist) || targetArtist.includes(candArtist)) {
      score += 18;
    } else {
      score -= 25;
    }
  }

  // Year match bonus
  if (album.year && option.year && album.year === option.year) {
    score += 8;
  }

  // Prefer full album tracklists over 1-track singles unless the user's album has <=1 track and no bigger release exists
  if (option.trackCount >= Math.max(4, ownedCount)) {
    score += 12;
  } else if (option.trackCount >= ownedCount && option.trackCount > 1) {
    score += 6;
  } else if (option.trackCount <= 1) {
    score -= 15;
  }

  // Slight preference for Deezer when scores tie (clean streaming tracklists, fast detail fetch)
  if (option.provider === "deezer") {
    score += 3;
  }

  return score;
}

/**
 * Looks up the canonical tracklist for a local album across Deezer and MusicBrainz,
 * ranks editions, and cross-references against the user's owned tracks.
 */
export class AlbumTracklistService {
  private readonly dbContext?: DbContext;
  private readonly musicBrainz: MusicBrainzClient;
  private readonly fetchImpl: typeof fetch;
  private readonly releaseCache = new Map<number, CachedReleaseOptions>();

  constructor(deps: AlbumTracklistServiceDeps) {
    this.dbContext = deps.dbContext;
    this.musicBrainz = deps.musicBrainz;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private readCache(albumId: number): {
    selectedReleaseId: string | null;
    provider: AlbumTracklistProvider | null;
    selectedRelease: AlbumReleaseOption | null;
    releases: AlbumReleaseOption[];
    tracks: RawExpectedTrack[];
  } | null {
    if (!this.dbContext) return null;
    const row = this.dbContext.sqlite
      .prepare(
        `
        SELECT
          album_id AS albumId,
          selected_release_id AS selectedReleaseId,
          provider,
          selected_release_json AS selectedReleaseJson,
          releases_json AS releasesJson,
          tracks_json AS tracksJson,
          updated_at AS updatedAt
        FROM album_tracklist_cache
        WHERE album_id = ?
      `,
      )
      .get(albumId) as TracklistCacheRow | undefined;

    if (!row) return null;

    try {
      const selectedRelease = row.selectedReleaseJson
        ? (JSON.parse(row.selectedReleaseJson) as AlbumReleaseOption)
        : null;
      const releases = JSON.parse(row.releasesJson) as AlbumReleaseOption[];
      const tracks = JSON.parse(row.tracksJson) as RawExpectedTrack[];
      return {
        selectedReleaseId: row.selectedReleaseId,
        provider: row.provider,
        selectedRelease,
        releases: Array.isArray(releases) ? releases : [],
        tracks: Array.isArray(tracks) ? tracks : [],
      };
    } catch {
      return null;
    }
  }

  private writeCache(
    albumId: number,
    payload: {
      selectedRelease: AlbumReleaseOption | null;
      releases: AlbumReleaseOption[];
      tracks: RawExpectedTrack[];
    },
  ): void {
    if (!this.dbContext) return;
    this.dbContext.sqlite
      .prepare(
        `
        INSERT INTO album_tracklist_cache (
          album_id,
          selected_release_id,
          provider,
          selected_release_json,
          releases_json,
          tracks_json,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(album_id) DO UPDATE SET
          selected_release_id = excluded.selected_release_id,
          provider = excluded.provider,
          selected_release_json = excluded.selected_release_json,
          releases_json = excluded.releases_json,
          tracks_json = excluded.tracks_json,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        albumId,
        payload.selectedRelease?.id ?? null,
        payload.selectedRelease?.provider ?? null,
        payload.selectedRelease ? JSON.stringify(payload.selectedRelease) : null,
        JSON.stringify(payload.releases),
        JSON.stringify(payload.tracks),
        Date.now(),
      );
  }

  private async fetchDeezerJson<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`Deezer returned HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async searchDeezerReleases(album: AlbumTracklistAlbumInfo): Promise<AlbumReleaseOption[]> {
    const parts: string[] = [];
    if (album.artistName && album.artistName.toLowerCase() !== "unknown artist") {
      parts.push(`artist:"${cleanSearchQuery(album.artistName)}"`);
    }
    parts.push(`album:"${cleanSearchQuery(album.title)}"`);
    let query = parts.join(" ");

    let data = await this.fetchDeezerJson<DeezerSearchAlbumResponse>(
      `${DEEZER_API}/search/album?q=${encodeURIComponent(query)}&limit=8`,
    );
    let items = data.data ?? [];

    // Retry with stripped edition suffix / plain keywords if strict query returned nothing
    if (items.length === 0) {
      const stripped = cleanSearchQuery(stripAlbumEditionSuffix(album.title));
      const fallbackQuery = [
        album.artistName.toLowerCase() !== "unknown artist"
          ? cleanSearchQuery(album.artistName)
          : "",
        stripped || cleanSearchQuery(album.title),
      ]
        .filter(Boolean)
        .join(" ");
      if (fallbackQuery) {
        data = await this.fetchDeezerJson<DeezerSearchAlbumResponse>(
          `${DEEZER_API}/search/album?q=${encodeURIComponent(fallbackQuery)}&limit=8`,
        );
        items = data.data ?? [];
      }
    }

    return items
      .filter((item) => Boolean(item.id && item.title))
      .map((item) => ({
        id: `deezer:${item.id}`,
        provider: "deezer" as const,
        title: item.title?.trim() || album.title,
        artist: item.artist?.name?.trim() || album.artistName,
        year: null,
        country: null,
        trackCount: item.nb_tracks ?? 0,
      }));
  }

  private async fetchDeezerAlbumTracks(
    deezerId: string,
  ): Promise<{ release: AlbumReleaseOption; tracks: RawExpectedTrack[] }> {
    const raw = await this.fetchDeezerJson<DeezerAlbumFullResponse>(
      `${DEEZER_API}/album/${encodeURIComponent(deezerId)}`,
    );
    const artistName = raw.artist?.name?.trim() || "Unknown Artist";
    const items = raw.tracks?.data ?? [];

    const tracks: RawExpectedTrack[] = items.map((t, idx) => ({
      discNumber: t.disk_number && t.disk_number > 0 ? t.disk_number : 1,
      trackNumber: t.track_position && t.track_position > 0 ? t.track_position : idx + 1,
      title: t.title?.trim() || "Untitled",
      artist: t.artist?.name?.trim() || artistName,
      durationSeconds: typeof t.duration === "number" && t.duration > 0 ? t.duration : null,
    }));

    tracks.sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);

    return {
      release: {
        id: `deezer:${raw.id ?? deezerId}`,
        provider: "deezer",
        title: raw.title?.trim() || "Unknown Album",
        artist: artistName,
        year: parseYear(raw.release_date),
        country: null,
        trackCount: tracks.length || raw.nb_tracks || 0,
      },
      tracks,
    };
  }

  private async fetchMusicBrainzAlbumTracks(
    mbid: string,
  ): Promise<{ release: AlbumReleaseOption; tracks: RawExpectedTrack[] }> {
    const detail = await this.musicBrainz.getReleaseDetail(mbid);
    const tracks: RawExpectedTrack[] = detail.tracks.map((t) => ({
      discNumber: t.discNumber,
      trackNumber: t.trackNumber,
      title: t.title,
      artist: t.artist,
      durationSeconds: t.durationSeconds,
    }));

    tracks.sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);

    return {
      release: {
        id: `mb:${detail.mbid}`,
        provider: "musicbrainz",
        title: detail.title,
        artist: detail.artist,
        year: detail.year,
        country: detail.country,
        trackCount: tracks.length,
      },
      tracks,
    };
  }

  private async discoverReleaseOptions(
    album: AlbumTracklistAlbumInfo,
    ownedCount: number,
    forceRefresh = false,
  ): Promise<AlbumReleaseOption[]> {
    if (!forceRefresh) {
      const cached = this.releaseCache.get(album.id);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.releases;
      }
    }

    const [deezerResult, mbResult] = await Promise.allSettled([
      this.searchDeezerReleases(album),
      this.musicBrainz.searchReleases({
        artist: album.artistName,
        album: album.title,
      }),
    ]);

    const combined: AlbumReleaseOption[] = [];

    if (deezerResult.status === "fulfilled") {
      combined.push(...deezerResult.value);
    }

    if (mbResult.status === "fulfilled") {
      for (const rel of mbResult.value) {
        if (rel.trackCount <= 0) continue;
        combined.push({
          id: `mb:${rel.mbid}`,
          provider: "musicbrainz",
          title: rel.title,
          artist: rel.artist,
          year: rel.year,
          country: rel.country,
          trackCount: rel.trackCount,
        });
      }
    }

    // Filter out unrelated compilation albums (e.g. "Various Artists — 80s Today") when artist is known
    const targetArtist = normalizeAlbumCompare(album.artistName);
    const isSpecificArtist =
      targetArtist.length > 0 &&
      targetArtist !== "unknown artist" &&
      targetArtist !== "various artists";
    const artistFiltered = isSpecificArtist
      ? combined.filter((opt) => {
          const candArtist = normalizeAlbumCompare(opt.artist);
          return (
            candArtist === targetArtist ||
            candArtist.includes(targetArtist) ||
            targetArtist.includes(candArtist)
          );
        })
      : combined;
    const pool = artistFiltered.length > 0 ? artistFiltered : combined;

    // Rank candidates by fit against the local album
    const scored = pool
      .map((opt) => ({ opt, score: scoreReleaseOption(opt, album, ownedCount) }))
      .sort((a, b) => b.score - a.score);

    // Deduplicate near-identical releases from the same provider with same title + trackCount
    const seenKeys = new Set<string>();
    const deduped: AlbumReleaseOption[] = [];
    for (const { opt } of scored) {
      const key = `${opt.provider}|${normalizeAlbumCompare(opt.title)}|${opt.trackCount}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      deduped.push(opt);
      if (deduped.length >= 8) break;
    }

    // If the album already has a stored MusicBrainz release ID, ensure it is first
    if (album.mbid) {
      const storedId = `mb:${album.mbid}`;
      const existingIdx = deduped.findIndex((r) => r.id === storedId);
      if (existingIdx > 0) {
        const [item] = deduped.splice(existingIdx, 1);
        if (item) deduped.unshift(item);
      } else if (existingIdx === -1) {
        deduped.unshift({
          id: storedId,
          provider: "musicbrainz",
          title: album.title,
          artist: album.artistName,
          year: album.year,
          country: null,
          trackCount: ownedCount,
        });
      }
    }

    this.releaseCache.set(album.id, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      releases: deduped,
    });

    return deduped;
  }

  private async fetchByReleaseId(
    releaseId: string,
  ): Promise<{ release: AlbumReleaseOption; tracks: RawExpectedTrack[] }> {
    if (releaseId.startsWith("deezer:")) {
      return this.fetchDeezerAlbumTracks(releaseId.slice("deezer:".length));
    }
    if (releaseId.startsWith("mb:")) {
      return this.fetchMusicBrainzAlbumTracks(releaseId.slice("mb:".length));
    }
    throw new Error("Unsupported releaseId format");
  }

  async lookupAlbumTracklist(
    album: AlbumTracklistAlbumInfo,
    ownedTracks: TrackSummary[],
    options?: LookupAlbumTracklistOptions | string,
  ): Promise<AlbumTracklistResponse> {
    const requestedReleaseId =
      typeof options === "string" ? options : options?.releaseId;
    const forceRefresh = typeof options === "object" && Boolean(options?.refresh);

    const dbCached = !forceRefresh ? this.readCache(album.id) : null;

    // Fast path: serve cached tracklist from SQLite & re-match live owned tracks in < 1ms
    if (
      dbCached &&
      dbCached.tracks.length > 0 &&
      (!requestedReleaseId || dbCached.selectedReleaseId === requestedReleaseId)
    ) {
      const matchedTracks = matchExpectedTracksToOwned(dbCached.tracks, ownedTracks);
      const ownedCount = matchedTracks.filter((t) => t.ownedTrackId !== null).length;
      return {
        albumId: album.id,
        provider: dbCached.provider,
        selectedRelease: dbCached.selectedRelease,
        releases: dbCached.releases,
        tracks: matchedTracks,
        ownedCount,
        missingCount: matchedTracks.length - ownedCount,
      };
    }

    // Reuse cached edition options when switching editions without hitting search APIs again
    const releases =
      !forceRefresh && dbCached && dbCached.releases.length > 0 && requestedReleaseId
        ? dbCached.releases
        : await this.discoverReleaseOptions(album, ownedTracks.length, forceRefresh);

    const tryIds: string[] = [];
    if (requestedReleaseId) {
      tryIds.push(requestedReleaseId);
    } else {
      for (const rel of releases.slice(0, 3)) {
        tryIds.push(rel.id);
      }
    }

    let fetched: { release: AlbumReleaseOption; tracks: RawExpectedTrack[] } | null = null;
    let lastError: unknown = null;

    for (const id of tryIds) {
      try {
        const res = await this.fetchByReleaseId(id);
        if (res.tracks.length > 0) {
          fetched = res;
          break;
        }
      } catch (err) {
        lastError = err;
        if (requestedReleaseId) {
          throw err;
        }
      }
    }

    if (!fetched) {
      if (lastError instanceof Error && tryIds.length > 0) {
        throw lastError;
      }
      return {
        albumId: album.id,
        provider: null,
        selectedRelease: null,
        releases,
        tracks: [],
        ownedCount: 0,
        missingCount: 0,
      };
    }

    // Keep the selected release's enriched year/trackCount in the options list too
    const normalizedReleases = releases.map((r) =>
      r.id === fetched.release.id ? fetched.release : r,
    );
    if (!normalizedReleases.some((r) => r.id === fetched.release.id)) {
      normalizedReleases.unshift(fetched.release);
    }

    // Persist to SQLite so navigating back to this album is instant & remembers the chosen edition
    this.writeCache(album.id, {
      selectedRelease: fetched.release,
      releases: normalizedReleases,
      tracks: fetched.tracks,
    });
    this.releaseCache.set(album.id, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      releases: normalizedReleases,
    });

    const matchedTracks = matchExpectedTracksToOwned(fetched.tracks, ownedTracks);
    const ownedCount = matchedTracks.filter((t) => t.ownedTrackId !== null).length;
    const missingCount = matchedTracks.length - ownedCount;

    return {
      albumId: album.id,
      provider: fetched.release.provider,
      selectedRelease: fetched.release,
      releases: normalizedReleases,
      tracks: matchedTracks,
      ownedCount,
      missingCount,
    };
  }
}
