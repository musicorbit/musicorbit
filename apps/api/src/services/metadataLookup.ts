import type {
  EditableTrackTags,
  MetadataProvider,
  TrackMetadataSuggestion,
} from "@musicorbit/shared";

const USER_AGENT = "MusicOrbit/0.1.0 ( https://github.com/musicorbit/musicorbit )";

export function isAllowedCoverArtUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== "443") return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === "dzcdn.net" ||
    host.endsWith(".dzcdn.net") ||
    host === "coverartarchive.org" ||
    host.endsWith(".coverartarchive.org") ||
    host === "archive.org" ||
    host.endsWith(".archive.org")
  );
}

function parseYear(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const match = /^(\d{4})/.exec(dateStr.trim());
  if (!match?.[1]) return null;
  const year = Number.parseInt(match[1], 10);
  return year > 1800 && year < 2200 ? year : null;
}

function cleanQueryText(value?: string): string {
  return (value ?? "")
    .replace(/[()[\]"?!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeLucenePhrase(value: string): string {
  return value.replace(/([\\"])/g, "\\$1").trim();
}

interface DeezerSearchTrack {
  id: number;
  title?: string;
  artist?: { name?: string };
  album?: { id?: number; title?: string; cover_xl?: string; cover_big?: string };
}

interface DeezerTrackDetail {
  id: number;
  title?: string;
  track_position?: number;
  disk_number?: number;
  release_date?: string;
  bpm?: number;
  artist?: { name?: string };
  contributors?: Array<{ name?: string; role?: string }>;
  album?: {
    id?: number;
    title?: string;
    cover_xl?: string;
    cover_big?: string;
    release_date?: string;
  };
}

interface DeezerAlbumDetail {
  id: number;
  title?: string;
  label?: string;
  nb_tracks?: number;
  release_date?: string;
  artist?: { name?: string };
  genres?: { data?: Array<{ name?: string }> };
  cover_xl?: string;
  cover_big?: string;
}

interface MbRecordingSearchItem {
  id: string;
  title?: string;
  score?: number;
  "artist-credit"?: Array<{ name?: string; artist?: { id?: string; name?: string } }>;
  tags?: Array<{ name?: string; count?: number }>;
  releases?: Array<{
    id: string;
    title?: string;
    date?: string;
    country?: string;
    status?: string;
    "track-count"?: number;
    "artist-credit"?: Array<{ name?: string; artist?: { id?: string; name?: string } }>;
    media?: Array<{
      position?: number;
      "track-count"?: number;
      track?: Array<{ number?: string; title?: string }>;
    }>;
  }>;
}

interface LrclibSearchItem {
  id: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

function stripLrcTimestamps(synced: string): string {
  return synced
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[\d+:\d+(?:\.\d+)?\]\s*/, ""))
    .join("\n")
    .trim();
}

export interface MetadataLookupServiceDeps {
  fetchImpl?: typeof fetch;
  mbRateLimitMs?: number;
}

/**
 * Multi-provider free, zero-API-key track metadata lookup service
 * supporting Deezer, MusicBrainz, and LRCLIB (lyrics).
 */
export class MetadataLookupService {
  private readonly fetchImpl: typeof fetch;
  private readonly mbRateLimitMs: number;
  private lastMbCallAt = 0;

  constructor(deps?: MetadataLookupServiceDeps) {
    this.fetchImpl = deps?.fetchImpl ?? fetch;
    this.mbRateLimitMs = deps?.mbRateLimitMs ?? 1100;
  }

  async lookup(params: {
    provider: MetadataProvider;
    title?: string;
    artist?: string;
    album?: string;
  }): Promise<TrackMetadataSuggestion[]> {
    switch (params.provider) {
      case "deezer":
        return this.lookupDeezer(params);
      case "musicbrainz":
        return this.lookupMusicBrainz(params);
      case "lrclib":
        return this.lookupLrclib(params);
    }
  }

  private async fetchJson<T>(url: string, retriesOn503 = 0): Promise<T> {
    let lastStatus = 0;
    for (let attempt = 1; attempt <= retriesOn503 + 1; attempt++) {
      const res = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      lastStatus = res.status;
      if ((res.status === 503 || res.status === 429) && attempt <= retriesOn503) {
        const delay = this.mbRateLimitMs > 0 ? this.mbRateLimitMs * attempt : 0;
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        continue;
      }

      throw new Error(`Metadata provider returned HTTP ${res.status}`);
    }

    throw new Error(`Metadata provider is temporarily busy (HTTP ${lastStatus}). Try again shortly.`);
  }

  private async lookupDeezer(params: {
    title?: string;
    artist?: string;
  }): Promise<TrackMetadataSuggestion[]> {
    const q = [cleanQueryText(params.artist), cleanQueryText(params.title)].filter(Boolean).join(" ");
    if (!q) return [];

    const searchData = await this.fetchJson<{ data?: DeezerSearchTrack[] }>(
      `https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=6`,
    );
    const hits = (searchData.data ?? []).slice(0, 5);
    if (hits.length === 0) return [];

    // Fetch full track details + deduplicated album details for BPM, label, genres, track total
    const trackDetails = await Promise.all(
      hits.map((hit) =>
        this.fetchJson<DeezerTrackDetail>(`https://api.deezer.com/track/${hit.id}`).catch(() => null),
      ),
    );

    const albumIds = Array.from(
      new Set(
        trackDetails
          .map((t) => t?.album?.id)
          .filter((id): id is number => typeof id === "number" && id > 0),
      ),
    );

    const albumMap = new Map<number, DeezerAlbumDetail>();
    await Promise.all(
      albumIds.map(async (id) => {
        try {
          const al = await this.fetchJson<DeezerAlbumDetail>(`https://api.deezer.com/album/${id}`);
          albumMap.set(id, al);
        } catch {
          // Non-fatal if album detail fails
        }
      }),
    );

    const suggestions: TrackMetadataSuggestion[] = [];
    for (const detail of trackDetails) {
      if (!detail || !detail.title) continue;
      const album = detail.album?.id ? albumMap.get(detail.album.id) : undefined;
      const year = parseYear(detail.release_date ?? album?.release_date ?? detail.album?.release_date);
      const genres = (album?.genres?.data ?? [])
        .map((g) => g.name?.trim())
        .filter(Boolean)
        .join(", ");
      const bpm = detail.bpm && detail.bpm > 0 ? Math.round(detail.bpm) : null;
      const artistName = detail.artist?.name?.trim() || "";
      const albumArtist = album?.artist?.name?.trim() || artistName;
      const albumTitle = album?.title?.trim() || detail.album?.title?.trim() || "";
      const coverArtUrl =
        album?.cover_xl ||
        album?.cover_big ||
        detail.album?.cover_xl ||
        detail.album?.cover_big ||
        null;

      const fields: Partial<EditableTrackTags> = {};
      if (detail.title.trim()) fields.title = detail.title.trim();
      if (artistName) fields.artists = artistName;
      if (albumArtist) fields.albumArtist = albumArtist;
      if (albumTitle) fields.album = albumTitle;
      if (detail.track_position && detail.track_position > 0) {
        fields.trackNumber = detail.track_position;
      }
      if (album?.nb_tracks && album.nb_tracks > 0) {
        fields.trackTotal = album.nb_tracks;
      }
      if (detail.disk_number && detail.disk_number > 0) {
        fields.discNumber = detail.disk_number;
      }
      if (year) fields.year = year;
      if (genres) fields.genres = genres;
      if (bpm) fields.bpm = bpm;
      if (album?.label?.trim()) fields.publisher = album.label.trim();

      const subtitleParts = [
        artistName,
        albumTitle,
        year ? String(year) : null,
        bpm ? `${bpm} BPM` : null,
        album?.label?.trim() || null,
      ].filter(Boolean);

      suggestions.push({
        id: `deezer:${detail.id}`,
        provider: "deezer",
        title: detail.title.trim(),
        subtitle: subtitleParts.join(" · "),
        coverArtUrl,
        fields,
      });
    }

    return suggestions;
  }

  private async lookupMusicBrainz(params: {
    title?: string;
    artist?: string;
  }): Promise<TrackMetadataSuggestion[]> {
    const clauses: string[] = [];
    if (params.title?.trim()) {
      clauses.push(`recording:"${escapeLucenePhrase(params.title)}"`);
    }
    if (params.artist?.trim() && params.artist.trim().toLowerCase() !== "unknown artist") {
      clauses.push(`artist:"${escapeLucenePhrase(params.artist)}"`);
    }
    if (clauses.length === 0) return [];

    if (this.mbRateLimitMs > 0) {
      const wait = this.mbRateLimitMs - (Date.now() - this.lastMbCallAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    this.lastMbCallAt = Date.now();

    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(clauses.join(" AND "))}&fmt=json&limit=8`;
    const data = await this.fetchJson<{ recordings?: MbRecordingSearchItem[] }>(url, 2);
    const recordings = data.recordings ?? [];

    const suggestions: TrackMetadataSuggestion[] = [];
    for (const rec of recordings) {
      if (!rec.title) continue;
      const credits = rec["artist-credit"] ?? [];
      const artists = credits
        .map((c) => c.name || c.artist?.name || "")
        .filter(Boolean)
        .join(", ");
      const artistMbid = credits[0]?.artist?.id ?? "";

      const releases = rec.releases ?? [];
      // Prefer official releases that have a date
      const bestRelease =
        releases.find((r) => r.status === "Official" && r.date) ??
        releases.find((r) => r.status === "Official") ??
        releases[0];

      const relArtistCredits = bestRelease?.["artist-credit"] ?? credits;
      const albumArtist =
        relArtistCredits
          .map((c) => c.name || c.artist?.name || "")
          .filter(Boolean)
          .join(", ") || artists;
      const relArtistMbid = relArtistCredits[0]?.artist?.id ?? artistMbid;

      const year = parseYear(bestRelease?.date);
      const medium = bestRelease?.media?.[0];
      const trackNumRaw = medium?.track?.[0]?.number;
      const trackNum = trackNumRaw ? Number.parseInt(trackNumRaw, 10) : null;
      const trackTotal = medium?.["track-count"] ?? bestRelease?.["track-count"] ?? null;
      const discNumber = medium?.position ?? null;

      const genres = (rec.tags ?? [])
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .slice(0, 3)
        .map((t) => t.name?.trim())
        .filter(Boolean)
        .join(", ");

      const fields: Partial<EditableTrackTags> = {
        title: rec.title.trim(),
        musicBrainzTrackId: rec.id,
      };
      if (artists) fields.artists = artists;
      if (albumArtist) fields.albumArtist = albumArtist;
      if (bestRelease?.title?.trim()) fields.album = bestRelease.title.trim();
      if (trackNum && Number.isFinite(trackNum) && trackNum > 0) fields.trackNumber = trackNum;
      if (trackTotal && trackTotal > 0) fields.trackTotal = trackTotal;
      if (discNumber && discNumber > 0) fields.discNumber = discNumber;
      if (year) fields.year = year;
      if (genres) fields.genres = genres;
      if (bestRelease?.id) fields.musicBrainzReleaseId = bestRelease.id;
      if (artistMbid) fields.musicBrainzArtistId = artistMbid;
      if (relArtistMbid) fields.musicBrainzReleaseArtistId = relArtistMbid;

      const subtitleParts = [
        artists || null,
        bestRelease?.title?.trim() || null,
        year ? String(year) : null,
        bestRelease?.country || null,
      ].filter(Boolean);

      suggestions.push({
        id: `mb:${rec.id}:${bestRelease?.id ?? "none"}`,
        provider: "musicbrainz",
        title: rec.title.trim(),
        subtitle: subtitleParts.join(" · "),
        coverArtUrl: bestRelease?.id
          ? `https://coverartarchive.org/release/${bestRelease.id}/front-500`
          : null,
        fields,
      });
    }

    return suggestions;
  }

  private async lookupLrclib(params: {
    title?: string;
    artist?: string;
  }): Promise<TrackMetadataSuggestion[]> {
    const sp = new URLSearchParams();
    if (params.title?.trim()) sp.set("track_name", params.title.trim());
    if (params.artist?.trim()) sp.set("artist_name", params.artist.trim());
    if (!sp.toString()) return [];

    const url = `https://lrclib.net/api/search?${sp.toString()}`;
    const items = await this.fetchJson<LrclibSearchItem[]>(url);

    const suggestions: TrackMetadataSuggestion[] = [];
    for (const item of (Array.isArray(items) ? items : []).slice(0, 6)) {
      const lyrics =
        item.plainLyrics?.trim() ||
        (item.syncedLyrics ? stripLrcTimestamps(item.syncedLyrics) : "");
      if (!lyrics) continue;

      const fields: Partial<EditableTrackTags> = { lyrics };
      if (item.trackName?.trim()) fields.title = item.trackName.trim();
      if (item.artistName?.trim()) fields.artists = item.artistName.trim();
      if (item.albumName?.trim()) fields.album = item.albumName.trim();

      const lineCount = lyrics.split(/\r?\n/).filter(Boolean).length;
      const subtitleParts = [
        item.artistName?.trim() || null,
        item.albumName?.trim() || null,
        `${lineCount} lines of lyrics`,
      ].filter(Boolean);

      suggestions.push({
        id: `lrclib:${item.id}`,
        provider: "lrclib",
        title: item.trackName?.trim() || params.title || "Lyrics",
        subtitle: subtitleParts.join(" · "),
        coverArtUrl: null,
        fields,
      });
    }

    return suggestions;
  }
}
