import type {
  MusicBrainzReleaseCandidate,
  MusicBrainzReleaseDetail,
  MusicBrainzTrackInfo,
} from "@musicorbit/shared";

const MB_BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = "MusicOrbit/0.1.0 ( https://github.com/musicorbit/musicorbit )";

interface RawMbArtistCredit {
  name?: string;
  artist?: { id?: string; name?: string };
}

interface RawMbReleaseSearchItem {
  id: string;
  title?: string;
  score?: number;
  date?: string;
  country?: string;
  "track-count"?: number;
  "artist-credit"?: RawMbArtistCredit[];
  media?: Array<{ "track-count"?: number }>;
}

interface RawMbReleaseSearchResponse {
  releases?: RawMbReleaseSearchItem[];
}

interface RawMbTrack {
  number?: string;
  position?: number;
  title?: string;
  length?: number | null;
  recording?: {
    id?: string;
    title?: string;
    length?: number | null;
    "artist-credit"?: RawMbArtistCredit[];
  };
  "artist-credit"?: RawMbArtistCredit[];
}

interface RawMbMedia {
  position?: number;
  tracks?: RawMbTrack[];
}

interface RawMbReleaseDetail {
  id: string;
  title?: string;
  date?: string;
  country?: string;
  "artist-credit"?: RawMbArtistCredit[];
  media?: RawMbMedia[];
}

function parseYear(dateStr?: string): number | null {
  if (!dateStr) return null;
  const match = /^(\d{4})/.exec(dateStr.trim());
  if (!match?.[1]) return null;
  const year = Number.parseInt(match[1], 10);
  return year > 1800 && year < 2200 ? year : null;
}

function formatArtistCredit(credits?: RawMbArtistCredit[]): {
  name: string;
  mbid: string | null;
} {
  if (!credits || credits.length === 0) {
    return { name: "Unknown Artist", mbid: null };
  }
  const primary = credits[0];
  const joined = credits
    .map((c) => c.name || c.artist?.name || "")
    .filter(Boolean)
    .join(", ");
  return {
    name: joined || primary?.artist?.name || "Unknown Artist",
    mbid: primary?.artist?.id ?? null,
  };
}

function escapeLucenePhrase(value: string): string {
  return value.replace(/([\\"])/g, "\\$1").trim();
}

/**
 * Strips common rip/edition noise like "(PBTHAL 24/96)" or "[FLAC]" when retrying a miss.
 */
function stripReleaseNoise(title: string): string {
  return title
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s*\([^)]*(?:flac|mp3|24\/96|pbthal|web|rip|deluxe|remaster)[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface MusicBrainzClientDeps {
  fetchImpl?: typeof fetch;
  /** Minimum delay between MusicBrainz API calls (default 1100ms per MB guidelines). */
  rateLimitMs?: number;
}

/**
 * Polite MusicBrainz API v2 client.
 *
 * MusicBrainz enforces <= 1 request/second per User-Agent and requires a
 * descriptive User-Agent string. All requests are serialized through a simple
 * pacing queue so bursts never get throttled or banned.
 */
export class MusicBrainzClient {
  private readonly fetchImpl: typeof fetch;
  private readonly rateLimitMs: number;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps?: MusicBrainzClientDeps) {
    this.fetchImpl = deps?.fetchImpl ?? fetch;
    this.rateLimitMs = deps?.rateLimitMs ?? 1100;
  }

  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.rateLimitMs > 0) {
        const waitMs = this.rateLimitMs - (Date.now() - this.lastRequestAt);
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
      this.lastRequestAt = Date.now();
      return fn();
    });
    // Keep queue chain alive even if an individual request rejects
    this.queue = run.catch(() => {});
    return run;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const maxAttempts = 3;
    let lastStatus = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.schedule(async () => {
        const res = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 503 || res.status === 429) {
          const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
          return {
            retry: true as const,
            status: res.status,
            retryDelayMs:
              Number.isFinite(retryAfterSec) && retryAfterSec > 0
                ? retryAfterSec * 1000
                : Math.min(2500, Math.max(this.rateLimitMs, 100) * attempt),
          };
        }
        if (!res.ok) {
          throw new Error(`MusicBrainz returned HTTP ${res.status}`);
        }
        return { retry: false as const, data: (await res.json()) as T };
      });

      if (!result.retry) {
        return result.data;
      }

      lastStatus = result.status;
      if (attempt < maxAttempts && this.rateLimitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, result.retryDelayMs));
      }
    }

    throw new Error(
      `MusicBrainz is temporarily busy (HTTP ${lastStatus}). Please try again in a few seconds.`,
    );
  }

  /**
   * Searches MusicBrainz releases and computes a 0-100 match confidence score
   * factoring in MusicBrainz relevance, artist/album match, and track count agreement.
   */
  async searchReleases(params: {
    artist?: string;
    album?: string;
    trackCount?: number;
  }): Promise<MusicBrainzReleaseCandidate[]> {
    const buildQuery = (artist?: string, album?: string) => {
      const clauses: string[] = [];
      if (album?.trim()) {
        clauses.push(`release:"${escapeLucenePhrase(album)}"`);
      }
      if (artist?.trim() && artist.trim().toLowerCase() !== "unknown artist") {
        clauses.push(`artist:"${escapeLucenePhrase(artist)}"`);
      }
      return clauses.join(" AND ");
    };

    const primaryQuery = buildQuery(params.artist, params.album);
    if (!primaryQuery) return [];

    let data = await this.fetchJson<RawMbReleaseSearchResponse>(
      `${MB_BASE_URL}/release/?query=${encodeURIComponent(primaryQuery)}&fmt=json&limit=10`,
    );
    let rawReleases = data.releases ?? [];

    // If messy edition/rip tags like "(PBTHAL 24/96)" prevented a match, retry with cleaned title
    if (rawReleases.length === 0 && params.album) {
      const cleanedAlbum = stripReleaseNoise(params.album);
      if (cleanedAlbum && cleanedAlbum !== params.album.trim()) {
        const retryQuery = buildQuery(params.artist, cleanedAlbum);
        data = await this.fetchJson<RawMbReleaseSearchResponse>(
          `${MB_BASE_URL}/release/?query=${encodeURIComponent(retryQuery)}&fmt=json&limit=10`,
        );
        rawReleases = data.releases ?? [];
      }
    }

    const normTargetArtist = params.artist ? normalize(params.artist) : "";
    const normTargetAlbum = params.album ? normalize(params.album) : "";

    const candidates: MusicBrainzReleaseCandidate[] = rawReleases.map((rel) => {
      const credit = formatArtistCredit(rel["artist-credit"]);
      const title = rel.title?.trim() || "Unknown Album";
      const trackCount =
        rel["track-count"] ??
        (rel.media ?? []).reduce((sum, m) => sum + (m["track-count"] ?? 0), 0);

      // Compute weighted confidence score (0-100)
      let score = Math.round((rel.score ?? 50) * 0.6);
      if (normTargetAlbum && normalize(title) === normTargetAlbum) {
        score += 20;
      } else if (normTargetAlbum && normalize(title).includes(normTargetAlbum)) {
        score += 10;
      }
      if (normTargetArtist && normalize(credit.name) === normTargetArtist) {
        score += 10;
      }
      if (params.trackCount && params.trackCount > 0 && trackCount > 0) {
        if (trackCount === params.trackCount) {
          score += 10;
        } else {
          // Penalize track count mismatch so a 1-track single doesn't auto-match a 12-track album
          score -= Math.min(20, Math.abs(trackCount - params.trackCount) * 3);
        }
      }

      return {
        mbid: rel.id,
        title,
        artist: credit.name,
        artistMbid: credit.mbid,
        year: parseYear(rel.date),
        country: rel.country ?? null,
        trackCount,
        score: Math.max(0, Math.min(100, score)),
        coverArtUrl: `https://coverartarchive.org/release/${rel.id}/front-250`,
      };
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /**
   * Fetches the full tracklist and metadata for a single MusicBrainz Release ID.
   */
  async getReleaseDetail(mbid: string): Promise<MusicBrainzReleaseDetail> {
    const encoded = encodeURIComponent(mbid);
    const url = `${MB_BASE_URL}/release/${encoded}?inc=recordings+artist-credits&fmt=json`;
    const raw = await this.fetchJson<RawMbReleaseDetail>(url);
    const credit = formatArtistCredit(raw["artist-credit"]);

    const tracks: MusicBrainzTrackInfo[] = [];
    for (const medium of raw.media ?? []) {
      const discNumber = medium.position ?? 1;
      for (const track of medium.tracks ?? []) {
        const trackArtist = formatArtistCredit(
          track["artist-credit"] ?? track.recording?.["artist-credit"],
        );
        const durationMs = track.length ?? track.recording?.length ?? null;
        tracks.push({
          discNumber,
          trackNumber: track.position ?? (Number.parseInt(track.number ?? "0", 10) || tracks.length + 1),
          title: track.title?.trim() || track.recording?.title?.trim() || "Untitled",
          artist:
            trackArtist.name !== "Unknown Artist" ? trackArtist.name : credit.name,
          recordingMbid: track.recording?.id ?? "",
          durationSeconds: durationMs ? Math.round((durationMs / 1000) * 10) / 10 : null,
        });
      }
    }

    return {
      mbid: raw.id ?? mbid,
      title: raw.title?.trim() || "Unknown Album",
      artist: credit.name,
      artistMbid: credit.mbid,
      year: parseYear(raw.date),
      country: raw.country ?? null,
      coverArtUrl: `https://coverartarchive.org/release/${raw.id ?? mbid}/front-500`,
      tracks,
    };
  }
}
