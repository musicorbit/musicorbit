import type {
  AlbumSummary,
  AvailableRecapOption,
  ClientUsageStat,
  CodecStat,
  DailyActivityPoint,
  HomeStatsResponse,
  HourlyActivityPoint,
  LibraryOverviewStats,
  ListeningPersona,
  MonthlyBreakdownPoint,
  PlaySource,
  RecapPeriodType,
  RecapResponse,
  RecentPlayItem,
  RecordPlayResponse,
  SaveRecapPlaylistResponse,
  SpotifyHistoryImportResponse,
  StatsRange,
  TopAlbumStat,
  TopArtistStat,
  TopGenreStat,
  TopTrackStat,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { PlaylistSyncService } from "./playlistSync.js";

const LOSSLESS_CODECS = new Set(["FLAC", "ALAC", "WAV", "AIFF", "APE", "WV", "DSD", "PCM"]);
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const KNOWN_CLIENT_NAMES: Record<string, string> = {
  symfonium: "Symfonium",
  arpeggi: "Arpeggi",
  amperfy: "Amperfy",
  feishin: "Feishin",
  tempo: "Tempo",
  "play:sub": "play:Sub",
  playsub: "play:Sub",
  substreamer: "substreamer",
  ultrasonic: "Ultrasonic",
  dsub: "DSub",
  "musicorbit web": "MusicOrbit Web",
  "musicorbit pwa": "MusicOrbit PWA",
  "spotify (imported)": "Spotify (Imported)",
};

function normalizePlaySource(raw: string): PlaySource {
  if (raw === "subsonic") return "subsonic";
  if (raw === "import") return "import";
  return "web";
}

function normalizeMatchText(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with|remaster(?:ed)?[^)\]]*|deluxe[^)\]]*|bonus[^)\]]*)\s*[\)\]]/gi, "")
    .replace(/\s*-\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|deluxe|radio edit|single version|album version).*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseSpotifyTimestamp(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Extended Streaming History: "2026-10-14T21:43:12Z"
  if (trimmed.includes("T")) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  // Account Data: "2026-10-14 21:43" or "2026-10-14 21:43:00" (UTC)
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (match) {
    const iso = `${match[1]}T${match[2]}:${match[3] ?? "00"}Z`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  }
  const fallback = Date.parse(trimmed);
  return Number.isFinite(fallback) ? fallback : null;
}

interface PlayRow {
  id: number;
  track_id: number | null;
  album_id: number | null;
  artist_id: number | null;
  track_title: string;
  album_title: string;
  artist_name: string;
  genre: string | null;
  duration_seconds: number;
  played_at: number;
  client_name: string;
  source: string;
  cover_hash: string | null;
  artist_image_hash: string | null;
}

export interface ListeningStatsServiceDeps {
  dbContext: DbContext;
  playlistSync?: PlaylistSyncService;
  now?: () => number;
}

export function normalizeClientName(raw: string | null | undefined, source: PlaySource): string {
  const cleaned = (raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 64);
  if (!cleaned) {
    if (source === "subsonic") return "OpenSubsonic App";
    if (source === "import") return "Spotify (Imported)";
    return "MusicOrbit Web";
  }
  const lower = cleaned.toLowerCase();
  if (KNOWN_CLIENT_NAMES[lower]) {
    return KNOWN_CLIENT_NAMES[lower];
  }
  // Handle client strings like "Symfonium/10.2.0" -> "Symfonium"
  const prefix = lower.split(/[/@\s]/)[0] ?? "";
  if (KNOWN_CLIENT_NAMES[prefix]) {
    return KNOWN_CLIENT_NAMES[prefix];
  }
  return cleaned;
}

function toLocalDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalMonthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(period: string): string {
  const [yStr, mStr] = period.split("-");
  const mIdx = Number(mStr) - 1;
  if (mIdx >= 0 && mIdx < 12 && yStr) {
    return `${MONTH_NAMES[mIdx]} ${yStr}`;
  }
  return period;
}

function computePersona(peakHour: number | null): ListeningPersona | null {
  if (peakHour === null) return null;
  if (peakHour >= 22 || peakHour < 5) {
    return {
      title: "Night Owl",
      description: "Your speakers shine brightest after dark.",
    };
  }
  if (peakHour >= 5 && peakHour < 10) {
    return {
      title: "Early Bird",
      description: "You soundtrack your mornings before the day ramps up.",
    };
  }
  if (peakHour >= 10 && peakHour < 14) {
    return {
      title: "Midday Mover",
      description: "Music powers your focus through the heart of the day.",
    };
  }
  if (peakHour >= 14 && peakHour < 18) {
    return {
      title: "Afternoon Groove",
      description: "Your prime listening window hits right in the afternoon.",
    };
  }
  return {
    title: "Evening Unwinder",
    description: "You love settling into albums as the evening winds down.",
  };
}

function dayDiff(aKey: string, bKey: string): number {
  const [ay, am, ad] = aKey.split("-").map(Number);
  const [by, bm, bd] = bKey.split("-").map(Number);
  const aUtc = Date.UTC(ay ?? 1970, (am ?? 1) - 1, ad ?? 1);
  const bUtc = Date.UTC(by ?? 1970, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((bUtc - aUtc) / 86_400_000);
}

function computeStreaks(dayKeys: string[], todayKey: string): { current: number; longest: number } {
  if (dayKeys.length === 0) return { current: 0, longest: 0 };
  const sorted = Array.from(new Set(dayKeys)).sort();

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (dayDiff(sorted[i - 1]!, sorted[i]!) === 1) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak counts if latest active day is today or yesterday
  const lastDay = sorted[sorted.length - 1]!;
  const gapToToday = dayDiff(lastDay, todayKey);
  if (gapToToday > 1 || gapToToday < -1) {
    return { current: 0, longest };
  }

  let current = 1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (dayDiff(sorted[i]!, sorted[i + 1]!) === 1) {
      current++;
    } else {
      break;
    }
  }
  return { current, longest };
}

function isPostChristmasForYear(year: number, nowMs: number): boolean {
  const now = new Date(nowMs);
  const currentYear = now.getFullYear();
  if (year < currentYear) return true;
  if (year > currentYear) return false;
  // Unlocked on or after December 26 (month 11 = December)
  return now.getMonth() === 11 && now.getDate() >= 26;
}

export class ListeningStatsService {
  private readonly dbContext: DbContext;
  private readonly playlistSync?: PlaylistSyncService;
  private readonly now: () => number;

  constructor(deps: ListeningStatsServiceDeps) {
    this.dbContext = deps.dbContext;
    this.playlistSync = deps.playlistSync;
    this.now = deps.now ?? (() => Date.now());
  }

  recordPlay(params: {
    userId: number;
    trackId: number;
    clientName?: string | null;
    source: PlaySource;
    playedAt?: number | null;
  }): RecordPlayResponse {
    const { sqlite } = this.dbContext;
    const track = sqlite
      .prepare(
        `
        SELECT
          t.id,
          t.title,
          t.album_id,
          t.artist_id,
          t.duration_seconds,
          al.title AS album_title,
          al.genre AS album_genre,
          ar.name AS artist_name
        FROM tracks t
        JOIN albums al ON al.id = t.album_id
        JOIN artists ar ON ar.id = t.artist_id
        WHERE t.id = ? AND t.user_id = ?
      `,
      )
      .get(params.trackId, params.userId) as
      | {
          id: number;
          title: string;
          album_id: number;
          artist_id: number;
          duration_seconds: number | null;
          album_title: string;
          album_genre: string | null;
          artist_name: string;
        }
      | undefined;

    if (!track) {
      return { recorded: false, deduplicated: false };
    }

    const nowMs = this.now();
    let playedAtMs = nowMs;
    if (typeof params.playedAt === "number" && Number.isFinite(params.playedAt) && params.playedAt > 0) {
      // Subsonic clients may send either seconds or milliseconds
      const candidate = params.playedAt < 1e11 ? Math.round(params.playedAt * 1000) : Math.round(params.playedAt);
      // Guard against wildly futuristic timestamps (> 10 minutes ahead)
      if (candidate <= nowMs + 10 * 60 * 1000) {
        playedAtMs = candidate;
      }
    }

    // Deduplicate identical track plays within a 60-second window (protects against offline scrobble retries)
    const existing = sqlite
      .prepare(
        `
        SELECT id FROM play_events
        WHERE user_id = ?
          AND track_id = ?
          AND ABS(played_at - ?) <= 60000
        LIMIT 1
      `,
      )
      .get(params.userId, track.id, playedAtMs) as { id: number } | undefined;

    if (existing) {
      return { recorded: false, deduplicated: true };
    }

    const clientName = normalizeClientName(params.clientName, params.source);
    const duration =
      typeof track.duration_seconds === "number" && track.duration_seconds > 0
        ? track.duration_seconds
        : 0;

    sqlite
      .prepare(
        `
        INSERT INTO play_events (
          user_id, track_id, album_id, artist_id,
          track_title, album_title, artist_name, genre,
          duration_seconds, played_at, client_name, source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        params.userId,
        track.id,
        track.album_id,
        track.artist_id,
        track.title,
        track.album_title,
        track.artist_name,
        track.album_genre?.trim() || null,
        duration,
        playedAtMs,
        clientName,
        params.source,
      );

    return { recorded: true, deduplicated: false };
  }

  getLibraryOverview(userId: number): LibraryOverviewStats {
    const { sqlite } = this.dbContext;

    const counts = sqlite
      .prepare(
        `
        SELECT
          COUNT(*) AS track_count,
          COALESCE(SUM(duration_seconds), 0) AS total_duration,
          COALESCE(SUM(file_size), 0) AS total_size
        FROM tracks
        WHERE user_id = ?
      `,
      )
      .get(userId) as { track_count: number; total_duration: number; total_size: number };

    const albumCount =
      (
        sqlite.prepare("SELECT COUNT(*) AS v FROM albums WHERE user_id = ?").get(userId) as
          | { v: number }
          | undefined
      )?.v ?? 0;

    const artistCount =
      (
        sqlite
          .prepare("SELECT COUNT(DISTINCT artist_id) AS v FROM albums WHERE user_id = ?")
          .get(userId) as { v: number } | undefined
      )?.v ?? 0;

    const playlistCount =
      (
        sqlite.prepare("SELECT COUNT(*) AS v FROM playlists WHERE user_id = ?").get(userId) as
          | { v: number }
          | undefined
      )?.v ?? 0;

    const codecRows = sqlite
      .prepare(
        `
        SELECT UPPER(COALESCE(NULLIF(TRIM(codec), ''), 'OTHER')) AS codec, COUNT(*) AS cnt
        FROM tracks
        WHERE user_id = ?
        GROUP BY UPPER(COALESCE(NULLIF(TRIM(codec), ''), 'OTHER'))
        ORDER BY cnt DESC
      `,
      )
      .all(userId) as Array<{ codec: string; cnt: number }>;

    const totalTracks = counts.track_count;
    let losslessTrackCount = 0;
    const codecs: CodecStat[] = codecRows.map((r) => {
      const lossless = LOSSLESS_CODECS.has(r.codec);
      if (lossless) losslessTrackCount += r.cnt;
      return {
        codec: r.codec,
        trackCount: r.cnt,
        percentage: totalTracks > 0 ? Math.round((r.cnt / totalTracks) * 100) : 0,
        lossless,
      };
    });

    return {
      trackCount: totalTracks,
      albumCount,
      artistCount,
      playlistCount,
      totalDurationSeconds: Math.round(counts.total_duration),
      totalSizeBytes: counts.total_size,
      losslessTrackCount,
      losslessPercentage: totalTracks > 0 ? Math.round((losslessTrackCount / totalTracks) * 100) : 0,
      codecs,
    };
  }

  private fetchPlayRows(userId: number, startMs?: number, endMs?: number): PlayRow[] {
    const { sqlite } = this.dbContext;
    const clauses = ["p.user_id = ?"];
    const args: unknown[] = [userId];
    if (typeof startMs === "number") {
      clauses.push("p.played_at >= ?");
      args.push(startMs);
    }
    if (typeof endMs === "number") {
      clauses.push("p.played_at < ?");
      args.push(endMs);
    }

    return sqlite
      .prepare(
        `
        SELECT
          p.id,
          p.track_id,
          p.album_id,
          p.artist_id,
          p.track_title,
          p.album_title,
          p.artist_name,
          p.genre,
          p.duration_seconds,
          p.played_at,
          p.client_name,
          p.source,
          al.cover_hash AS cover_hash,
          ar.image_hash AS artist_image_hash
        FROM play_events p
        LEFT JOIN albums al ON al.id = p.album_id AND al.user_id = p.user_id
        LEFT JOIN artists ar ON ar.id = p.artist_id AND ar.user_id = p.user_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY p.played_at DESC, p.id DESC
      `,
      )
      .all(...args) as PlayRow[];
  }

  private getAvailablePeriods(allRows: PlayRow[]): {
    months: AvailableRecapOption[];
    years: AvailableRecapOption[];
  } {
    const monthMap = new Map<string, { plays: number; seconds: number }>();
    const yearMap = new Map<string, { plays: number; seconds: number }>();

    for (const r of allRows) {
      const mKey = toLocalMonthKey(r.played_at);
      const yKey = mKey.slice(0, 4);

      const mEntry = monthMap.get(mKey) ?? { plays: 0, seconds: 0 };
      mEntry.plays++;
      mEntry.seconds += r.duration_seconds;
      monthMap.set(mKey, mEntry);

      const yEntry = yearMap.get(yKey) ?? { plays: 0, seconds: 0 };
      yEntry.plays++;
      yEntry.seconds += r.duration_seconds;
      yearMap.set(yKey, yEntry);
    }

    const months: AvailableRecapOption[] = Array.from(monthMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([period, v]) => ({
        period,
        label: formatMonthLabel(period),
        plays: v.plays,
        minutes: Math.round(v.seconds / 60),
      }));

    const years: AvailableRecapOption[] = Array.from(yearMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([period, v]) => ({
        period,
        label: period,
        plays: v.plays,
        minutes: Math.round(v.seconds / 60),
      }));

    return { months, years };
  }

  private aggregatePlays(rows: PlayRow[]): {
    totalPlays: number;
    totalMinutes: number;
    uniqueArtists: number;
    uniqueTracks: number;
    uniqueAlbums: number;
    topArtists: TopArtistStat[];
    topAlbums: TopAlbumStat[];
    topTracks: TopTrackStat[];
    topGenres: TopGenreStat[];
    clients: ClientUsageStat[];
    hourlyActivity: HourlyActivityPoint[];
    peakHour: number | null;
    persona: ListeningPersona | null;
    dayCounts: Map<string, { plays: number; seconds: number }>;
  } {
    let totalSeconds = 0;
    const artistMap = new Map<
      string,
      {
        artistId: number | null;
        artistName: string;
        imageHash: string | null;
        fallbackAlbumId: number | null;
        plays: number;
        seconds: number;
      }
    >();
    const albumMap = new Map<
      string,
      {
        albumId: number | null;
        albumTitle: string;
        artistId: number | null;
        artistName: string;
        coverHash: string | null;
        plays: number;
        seconds: number;
      }
    >();
    const trackMap = new Map<
      string,
      {
        trackId: number | null;
        title: string;
        albumId: number | null;
        albumTitle: string;
        artistId: number | null;
        artistName: string;
        coverHash: string | null;
        durationSeconds: number;
        plays: number;
        seconds: number;
      }
    >();
    const genreMap = new Map<string, { genre: string; plays: number; seconds: number }>();
    const clientMap = new Map<
      string,
      { clientName: string; source: PlaySource; plays: number; seconds: number; lastPlayedAt: number }
    >();
    const hourBuckets = new Array<number>(24).fill(0);
    const dayCounts = new Map<string, { plays: number; seconds: number }>();

    for (const r of rows) {
      totalSeconds += r.duration_seconds;

      const d = new Date(r.played_at);
      hourBuckets[d.getHours()] = (hourBuckets[d.getHours()] ?? 0) + 1;

      const dKey = toLocalDateKey(r.played_at);
      const dayEntry = dayCounts.get(dKey) ?? { plays: 0, seconds: 0 };
      dayEntry.plays++;
      dayEntry.seconds += r.duration_seconds;
      dayCounts.set(dKey, dayEntry);

      // Artist aggregation (key by artist_id when present, else normalized name)
      const artistKey = r.artist_id ? `id:${r.artist_id}` : `name:${r.artist_name.toLowerCase()}`;
      const aEntry = artistMap.get(artistKey) ?? {
        artistId: r.artist_id,
        artistName: r.artist_name,
        imageHash: r.artist_image_hash,
        fallbackAlbumId: r.cover_hash ? r.album_id : null,
        plays: 0,
        seconds: 0,
      };
      aEntry.plays++;
      aEntry.seconds += r.duration_seconds;
      if (!aEntry.imageHash && r.artist_image_hash) aEntry.imageHash = r.artist_image_hash;
      if (!aEntry.fallbackAlbumId && r.cover_hash && r.album_id) aEntry.fallbackAlbumId = r.album_id;
      artistMap.set(artistKey, aEntry);

      // Album aggregation
      const albumKey = r.album_id
        ? `id:${r.album_id}`
        : `name:${r.artist_name.toLowerCase()}::${r.album_title.toLowerCase()}`;
      const alEntry = albumMap.get(albumKey) ?? {
        albumId: r.album_id,
        albumTitle: r.album_title,
        artistId: r.artist_id,
        artistName: r.artist_name,
        coverHash: r.cover_hash,
        plays: 0,
        seconds: 0,
      };
      alEntry.plays++;
      alEntry.seconds += r.duration_seconds;
      if (!alEntry.coverHash && r.cover_hash) alEntry.coverHash = r.cover_hash;
      albumMap.set(albumKey, alEntry);

      // Track aggregation
      const trackKey = r.track_id
        ? `id:${r.track_id}`
        : `name:${r.artist_name.toLowerCase()}::${r.track_title.toLowerCase()}`;
      const tEntry = trackMap.get(trackKey) ?? {
        trackId: r.track_id,
        title: r.track_title,
        albumId: r.album_id,
        albumTitle: r.album_title,
        artistId: r.artist_id,
        artistName: r.artist_name,
        coverHash: r.cover_hash,
        durationSeconds: r.duration_seconds,
        plays: 0,
        seconds: 0,
      };
      tEntry.plays++;
      tEntry.seconds += r.duration_seconds;
      if (!tEntry.coverHash && r.cover_hash) tEntry.coverHash = r.cover_hash;
      trackMap.set(trackKey, tEntry);

      // Genre aggregation
      const cleanGenre = r.genre?.trim();
      if (cleanGenre) {
        const gKey = cleanGenre.toLowerCase();
        const gEntry = genreMap.get(gKey) ?? { genre: cleanGenre, plays: 0, seconds: 0 };
        gEntry.plays++;
        gEntry.seconds += r.duration_seconds;
        genreMap.set(gKey, gEntry);
      }

      // Client usage aggregation
      const cSource = normalizePlaySource(r.source);
      const cName = normalizeClientName(r.client_name, cSource);
      const cKey = cName.toLowerCase();
      const cEntry = clientMap.get(cKey) ?? {
        clientName: cName,
        source: cSource,
        plays: 0,
        seconds: 0,
        lastPlayedAt: r.played_at,
      };
      cEntry.plays++;
      cEntry.seconds += r.duration_seconds;
      if (r.played_at > cEntry.lastPlayedAt) cEntry.lastPlayedAt = r.played_at;
      clientMap.set(cKey, cEntry);
    }

    const totalPlays = rows.length;
    const totalGenrePlays = Array.from(genreMap.values()).reduce((sum, g) => sum + g.plays, 0);

    const topArtists: TopArtistStat[] = Array.from(artistMap.values())
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .map((a) => ({
        artistId: a.artistId,
        artistName: a.artistName,
        imageHash: a.imageHash,
        fallbackAlbumId: a.fallbackAlbumId,
        playCount: a.plays,
        totalMinutes: Math.round(a.seconds / 60),
      }));

    const topAlbums: TopAlbumStat[] = Array.from(albumMap.values())
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .map((al) => ({
        albumId: al.albumId,
        albumTitle: al.albumTitle,
        artistId: al.artistId,
        artistName: al.artistName,
        coverHash: al.coverHash,
        playCount: al.plays,
        totalMinutes: Math.round(al.seconds / 60),
      }));

    const topTracks: TopTrackStat[] = Array.from(trackMap.values())
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .map((t) => ({
        trackId: t.trackId,
        title: t.title,
        albumId: t.albumId,
        albumTitle: t.albumTitle,
        artistId: t.artistId,
        artistName: t.artistName,
        coverHash: t.coverHash,
        durationSeconds: Math.round(t.durationSeconds),
        playCount: t.plays,
        totalMinutes: Math.round(t.seconds / 60),
      }));

    const topGenres: TopGenreStat[] = Array.from(genreMap.values())
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .map((g) => ({
        genre: g.genre,
        playCount: g.plays,
        totalMinutes: Math.round(g.seconds / 60),
        percentage: totalGenrePlays > 0 ? Math.round((g.plays / totalGenrePlays) * 100) : 0,
      }));

    const clients: ClientUsageStat[] = Array.from(clientMap.values())
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .map((c) => ({
        clientName: c.clientName,
        source: c.source,
        playCount: c.plays,
        totalMinutes: Math.round(c.seconds / 60),
        percentage: totalPlays > 0 ? Math.round((c.plays / totalPlays) * 100) : 0,
        lastPlayedAt: new Date(c.lastPlayedAt).toISOString(),
      }));

    let peakHour: number | null = null;
    let peakHourPlays = 0;
    const hourlyActivity: HourlyActivityPoint[] = hourBuckets.map((plays, hour) => {
      if (plays > peakHourPlays) {
        peakHourPlays = plays;
        peakHour = hour;
      }
      return { hour, plays };
    });

    return {
      totalPlays,
      totalMinutes: Math.round(totalSeconds / 60),
      uniqueArtists: artistMap.size,
      uniqueTracks: trackMap.size,
      uniqueAlbums: albumMap.size,
      topArtists,
      topAlbums,
      topTracks,
      topGenres,
      clients,
      hourlyActivity,
      peakHour,
      persona: computePersona(peakHour),
      dayCounts,
    };
  }

  getHomeStats(userId: number, range: StatsRange = "30d"): HomeStatsResponse {
    const nowMs = this.now();
    const nowDate = new Date(nowMs);
    const todayKey = toLocalDateKey(nowMs);
    const currentMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
    const currentYearStart = new Date(nowDate.getFullYear(), 0, 1).getTime();

    let rangeStartMs: number | undefined;
    if (range === "7d") {
      rangeStartMs = nowMs - 7 * 86_400_000;
    } else if (range === "30d") {
      rangeStartMs = nowMs - 30 * 86_400_000;
    } else if (range === "year") {
      rangeStartMs = currentYearStart;
    }

    const library = this.getLibraryOverview(userId);
    const allRows = this.fetchPlayRows(userId);
    const rangeRows =
      typeof rangeStartMs === "number"
        ? allRows.filter((r) => r.played_at >= rangeStartMs)
        : allRows;

    const agg = this.aggregatePlays(rangeRows);

    // All-time & current-month KPIs + streaks
    let allTimeSeconds = 0;
    let monthPlays = 0;
    let monthSeconds = 0;
    const allDayKeys: string[] = [];
    const heatmapCounts = new Map<string, { plays: number; seconds: number }>();

    for (const r of allRows) {
      allTimeSeconds += r.duration_seconds;
      if (r.played_at >= currentMonthStart) {
        monthPlays++;
        monthSeconds += r.duration_seconds;
      }
      const dKey = toLocalDateKey(r.played_at);
      allDayKeys.push(dKey);
      const hm = heatmapCounts.get(dKey) ?? { plays: 0, seconds: 0 };
      hm.plays++;
      hm.seconds += r.duration_seconds;
      heatmapCounts.set(dKey, hm);
    }

    const streaks = computeStreaks(allDayKeys, todayKey);

    // Build 91-day (13 weeks) daily activity series ending today
    const dailyActivity: DailyActivityPoint[] = [];
    const todayMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    for (let i = 90; i >= 0; i--) {
      const dayMs = todayMidnight - i * 86_400_000;
      const dateKey = toLocalDateKey(dayMs);
      const entry = heatmapCounts.get(dateKey);
      dailyActivity.push({
        date: dateKey,
        plays: entry?.plays ?? 0,
        minutes: entry ? Math.round(entry.seconds / 60) : 0,
      });
    }

    const recentlyPlayed: RecentPlayItem[] = allRows.slice(0, 12).map((r) => {
      const src = normalizePlaySource(r.source);
      return {
        id: r.id,
        trackId: r.track_id,
        title: r.track_title,
        albumId: r.album_id,
        albumTitle: r.album_title,
        artistId: r.artist_id,
        artistName: r.artist_name,
        coverHash: r.cover_hash,
        durationSeconds: Math.round(r.duration_seconds),
        playedAt: new Date(r.played_at).toISOString(),
        clientName: normalizeClientName(r.client_name, src),
        source: src,
      };
    });

    // Recently added albums
    const recentAlbumRows = this.dbContext.sqlite
      .prepare(
        `
        SELECT
          al.id,
          al.title,
          al.artist_id,
          ar.name AS artist_name,
          al.year,
          al.genre,
          al.cover_hash,
          COUNT(t.id) AS track_count,
          COALESCE(SUM(t.duration_seconds), 0) AS total_duration
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        LEFT JOIN tracks t ON t.album_id = al.id AND t.user_id = al.user_id
        WHERE al.user_id = ?
        GROUP BY al.id
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT 8
      `,
      )
      .all(userId) as Array<{
      id: number;
      title: string;
      artist_id: number;
      artist_name: string;
      year: number | null;
      genre: string | null;
      cover_hash: string | null;
      track_count: number;
      total_duration: number;
    }>;

    const recentlyAddedAlbums: AlbumSummary[] = recentAlbumRows.map((row) => ({
      id: row.id,
      title: row.title,
      artistId: row.artist_id,
      artistName: row.artist_name,
      year: row.year,
      genre: row.genre,
      coverHash: row.cover_hash,
      trackCount: row.track_count,
      totalDurationSeconds: Math.round(row.total_duration),
    }));

    const { months: availableMonths, years: availableYears } = this.getAvailablePeriods(allRows);

    const currentYear = nowDate.getFullYear();
    const currentYearEntry = availableYears.find((y) => y.period === String(currentYear));
    const postChristmas = isPostChristmasForYear(currentYear, nowMs);
    const yearlyRecapBanner =
      currentYearEntry && currentYearEntry.plays > 0
        ? {
            year: currentYear,
            unlocked: postChristmas,
            plays: currentYearEntry.plays,
            unlocksOn: `December 26, ${currentYear}`,
          }
        : null;

    return {
      range,
      library,
      listening: {
        totalPlays: agg.totalPlays,
        totalMinutes: agg.totalMinutes,
        allTimePlays: allRows.length,
        allTimeMinutes: Math.round(allTimeSeconds / 60),
        monthPlays,
        monthMinutes: Math.round(monthSeconds / 60),
        uniqueArtists: agg.uniqueArtists,
        uniqueTracks: agg.uniqueTracks,
        uniqueAlbums: agg.uniqueAlbums,
        currentStreakDays: streaks.current,
        longestStreakDays: streaks.longest,
        peakHour: agg.peakHour,
        persona: agg.persona,
      },
      recentlyPlayed,
      recentlyAddedAlbums,
      topArtists: agg.topArtists.slice(0, 8),
      topAlbums: agg.topAlbums.slice(0, 8),
      topTracks: agg.topTracks.slice(0, 10),
      topGenres: agg.topGenres.slice(0, 6),
      clients: agg.clients,
      dailyActivity,
      hourlyActivity: agg.hourlyActivity,
      availableMonths,
      availableYears,
      yearlyRecapBanner,
    };
  }

  getRecap(userId: number, type: RecapPeriodType, rawPeriod?: string): RecapResponse {
    const nowMs = this.now();
    const nowDate = new Date(nowMs);
    const allRows = this.fetchPlayRows(userId);
    const { months: availableMonths, years: availableYears } = this.getAvailablePeriods(allRows);

    let period: string;
    let startMs: number;
    let endMs: number;
    let label: string;
    let isComplete: boolean;
    let isPostChristmasUnlocked: boolean;
    let unlocksOn: string | null = null;
    let yearNum = nowDate.getFullYear();

    if (type === "year") {
      const match = /^(\d{4})$/.exec((rawPeriod ?? "").trim());
      yearNum = match
        ? Number(match[1])
        : Number(availableYears[0]?.period ?? nowDate.getFullYear());
      period = String(yearNum);
      startMs = new Date(yearNum, 0, 1).getTime();
      endMs = new Date(yearNum + 1, 0, 1).getTime();
      label = `${yearNum} Yearly Recap`;
      isComplete = yearNum < nowDate.getFullYear();
      isPostChristmasUnlocked = isPostChristmasForYear(yearNum, nowMs);
      unlocksOn = `December 26, ${yearNum}`;
    } else {
      const match = /^(\d{4})-(\d{2})$/.exec((rawPeriod ?? "").trim());
      let monthNum: number;
      if (match) {
        yearNum = Number(match[1]);
        monthNum = Math.min(12, Math.max(1, Number(match[2])));
      } else if (availableMonths[0]) {
        const [y, m] = availableMonths[0].period.split("-").map(Number);
        yearNum = y ?? nowDate.getFullYear();
        monthNum = m ?? nowDate.getMonth() + 1;
      } else {
        yearNum = nowDate.getFullYear();
        monthNum = nowDate.getMonth() + 1;
      }
      period = `${yearNum}-${String(monthNum).padStart(2, "0")}`;
      startMs = new Date(yearNum, monthNum - 1, 1).getTime();
      endMs = new Date(yearNum, monthNum, 1).getTime();
      label = formatMonthLabel(period);
      isComplete = endMs <= nowMs;
      isPostChristmasUnlocked = true;
    }

    const periodRows = allRows.filter((r) => r.played_at >= startMs && r.played_at < endMs);
    const agg = this.aggregatePlays(periodRows);
    const dayKeys = Array.from(agg.dayCounts.keys());
    const streaks = computeStreaks(dayKeys, toLocalDateKey(nowMs));

    let peakDay: RecapResponse["peakDay"] = null;
    for (const [date, stats] of agg.dayCounts.entries()) {
      if (!peakDay || stats.plays > peakDay.plays) {
        peakDay = { date, plays: stats.plays, minutes: Math.round(stats.seconds / 60) };
      }
    }

    const monthlyBreakdown: MonthlyBreakdownPoint[] = [];
    if (type === "year") {
      const mBuckets = Array.from({ length: 12 }, () => ({ plays: 0, seconds: 0 }));
      for (const r of periodRows) {
        const mIdx = new Date(r.played_at).getMonth();
        const b = mBuckets[mIdx];
        if (b) {
          b.plays++;
          b.seconds += r.duration_seconds;
        }
      }
      for (let i = 0; i < 12; i++) {
        const b = mBuckets[i]!;
        monthlyBreakdown.push({
          month: i + 1,
          label: MONTH_SHORT[i]!,
          plays: b.plays,
          minutes: Math.round(b.seconds / 60),
        });
      }
    }

    return {
      type,
      period,
      label,
      isComplete,
      isPostChristmasUnlocked,
      unlocksOn,
      totalPlays: agg.totalPlays,
      totalMinutes: agg.totalMinutes,
      uniqueTracks: agg.uniqueTracks,
      uniqueArtists: agg.uniqueArtists,
      uniqueAlbums: agg.uniqueAlbums,
      activeDays: dayKeys.length,
      longestStreakDays: streaks.longest,
      peakDay,
      peakHour: agg.peakHour,
      persona: agg.persona,
      topTrack: agg.topTracks[0] ?? null,
      topArtist: agg.topArtists[0] ?? null,
      topAlbum: agg.topAlbums[0] ?? null,
      topTracks: agg.topTracks.slice(0, 25),
      topArtists: agg.topArtists.slice(0, 10),
      topAlbums: agg.topAlbums.slice(0, 10),
      topGenres: agg.topGenres.slice(0, 6),
      clients: agg.clients,
      monthlyBreakdown,
      availableMonths,
      availableYears,
    };
  }

  saveRecapAsPlaylist(
    userId: number,
    type: RecapPeriodType,
    period: string,
  ): SaveRecapPlaylistResponse {
    const recap = this.getRecap(userId, type, period);
    const { sqlite } = this.dbContext;

    const validTrackIds: number[] = [];
    const checkStmt = sqlite.prepare("SELECT id FROM tracks WHERE id = ? AND user_id = ?");
    for (const t of recap.topTracks) {
      if (t.trackId && checkStmt.get(t.trackId, userId)) {
        validTrackIds.push(t.trackId);
      }
    }

    const baseName =
      type === "year"
        ? `MusicOrbit ${recap.period} Top ${Math.min(25, Math.max(1, validTrackIds.length))}`
        : `MusicOrbit Recap — ${recap.label}`;
    const description = `Generated from your ${recap.label} (${recap.totalPlays} plays · ${recap.totalMinutes} min).`;

    const nowMs = this.now();
    const insertPlaylist = sqlite.prepare(
      `
      INSERT INTO playlists (user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    );
    const result = insertPlaylist.run(userId, baseName, description, nowMs, nowMs);
    const playlistId = Number(result.lastInsertRowid);

    const insertTrack = sqlite.prepare(
      `
      INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
      VALUES (?, ?, ?, ?)
    `,
    );
    const tx = sqlite.transaction(() => {
      validTrackIds.forEach((tid, idx) => {
        insertTrack.run(playlistId, tid, idx + 1, nowMs);
      });
    });
    tx();

    // Sync to .m3u8 on disk if enabled
    this.playlistSync?.syncPlaylist(playlistId);

    const summaryRow = sqlite
      .prepare(
        `
        SELECT
          p.id,
          p.name,
          p.description,
          p.cover_hash,
          p.created_at,
          p.updated_at,
          COUNT(pt.id) AS track_count,
          COALESCE(SUM(t.duration_seconds), 0) AS total_duration
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
        LEFT JOIN tracks t ON t.id = pt.track_id
        WHERE p.id = ? AND p.user_id = ?
        GROUP BY p.id
      `,
      )
      .get(playlistId, userId) as {
      id: number;
      name: string;
      description: string;
      cover_hash: string | null;
      created_at: number;
      updated_at: number;
      track_count: number;
      total_duration: number;
    };

    const firstCoverRow = sqlite
      .prepare(
        `
        SELECT t.album_id
        FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        JOIN albums al ON al.id = t.album_id
        WHERE pt.playlist_id = ? AND al.cover_hash IS NOT NULL
        ORDER BY pt.position ASC
        LIMIT 1
      `,
      )
      .get(playlistId) as { album_id: number } | undefined;

    return {
      playlist: {
        id: summaryRow.id,
        name: summaryRow.name,
        description: summaryRow.description,
        coverAlbumId: firstCoverRow?.album_id ?? null,
        coverHash: summaryRow.cover_hash,
        trackCount: summaryRow.track_count,
        missingCount: 0,
        totalDurationSeconds: Math.round(summaryRow.total_duration),
        createdAt: new Date(summaryRow.created_at).toISOString(),
        updatedAt: new Date(summaryRow.updated_at).toISOString(),
      },
      tracksAdded: validTrackIds.length,
    };
  }

  /**
   * Imports official Spotify JSON listening history into the user's private play_events table.
   * Supports both:
   * - Account Data ("StreamingHistory_music_*.json": endTime, artistName, trackName, msPlayed)
   * - Extended Streaming History ("Streaming_History_Audio_*.json": ts, master_metadata_*, ms_played, skipped)
   */
  importSpotifyHistory(
    userId: number,
    entries: unknown[],
    options?: { minSeconds?: number },
  ): SpotifyHistoryImportResponse {
    const { sqlite } = this.dbContext;
    const minMs = Math.max(5, Math.min(300, options?.minSeconds ?? 30)) * 1000;

    // Build fast in-memory library lookup maps for this user
    const trackRows = sqlite
      .prepare(
        `
        SELECT
          t.id AS track_id,
          t.title AS track_title,
          t.album_id,
          t.artist_id,
          t.duration_seconds,
          al.title AS album_title,
          al.genre AS album_genre,
          ar.name AS artist_name
        FROM tracks t
        JOIN albums al ON al.id = t.album_id
        JOIN artists ar ON ar.id = t.artist_id
        WHERE t.user_id = ?
      `,
      )
      .all(userId) as Array<{
      track_id: number;
      track_title: string;
      album_id: number;
      artist_id: number;
      duration_seconds: number | null;
      album_title: string;
      album_genre: string | null;
      artist_name: string;
    }>;

    const trackByArtistTitle = new Map<
      string,
      {
        trackId: number;
        albumId: number;
        artistId: number;
        albumTitle: string;
        genre: string | null;
        durationSeconds: number | null;
      }
    >();
    const albumByArtistAlbum = new Map<
      string,
      { albumId: number; artistId: number; albumTitle: string; genre: string | null }
    >();
    const artistByNormName = new Map<string, number>();

    for (const tr of trackRows) {
      const nArtist = normalizeMatchText(tr.artist_name);
      const nTitle = normalizeMatchText(tr.track_title);
      const nAlbum = normalizeMatchText(tr.album_title);
      if (nArtist) {
        if (!artistByNormName.has(nArtist)) artistByNormName.set(nArtist, tr.artist_id);
        if (nTitle) {
          const tKey = `${nArtist}::${nTitle}`;
          if (!trackByArtistTitle.has(tKey)) {
            trackByArtistTitle.set(tKey, {
              trackId: tr.track_id,
              albumId: tr.album_id,
              artistId: tr.artist_id,
              albumTitle: tr.album_title,
              genre: tr.album_genre?.trim() || null,
              durationSeconds: tr.duration_seconds,
            });
          }
        }
        if (nAlbum) {
          const alKey = `${nArtist}::${nAlbum}`;
          if (!albumByArtistAlbum.has(alKey)) {
            albumByArtistAlbum.set(alKey, {
              albumId: tr.album_id,
              artistId: tr.artist_id,
              albumTitle: tr.album_title,
              genre: tr.album_genre?.trim() || null,
            });
          }
        }
      }
    }

    // Load existing plays for fast ±65s deduplication (handles re-uploads + Account vs Extended overlap)
    const existingRows = sqlite
      .prepare("SELECT artist_name, track_title, played_at FROM play_events WHERE user_id = ?")
      .all(userId) as Array<{ artist_name: string; track_title: string; played_at: number }>;

    const seenTimestampsBySong = new Map<string, number[]>();
    const addSeen = (songKey: string, tsMs: number) => {
      const arr = seenTimestampsBySong.get(songKey);
      if (arr) arr.push(tsMs);
      else seenTimestampsBySong.set(songKey, [tsMs]);
    };
    const isDuplicate = (songKey: string, tsMs: number): boolean => {
      const arr = seenTimestampsBySong.get(songKey);
      if (!arr) return false;
      for (let i = 0; i < arr.length; i++) {
        if (Math.abs(arr[i]! - tsMs) <= 65_000) return true;
      }
      return false;
    };

    for (const ex of existingRows) {
      const key = `${normalizeMatchText(ex.artist_name)}::${normalizeMatchText(ex.track_title)}`;
      addSeen(key, ex.played_at);
    }

    let sawExtended = false;
    let sawAccount = false;
    let importedCount = 0;
    let matchedLocalTracks = 0;
    let skippedShortOrNonMusic = 0;
    let deduplicatedCount = 0;
    let earliestMs: number | null = null;
    let latestMs: number | null = null;

    const toInsert: Array<{
      trackId: number | null;
      albumId: number | null;
      artistId: number | null;
      trackTitle: string;
      albumTitle: string;
      artistName: string;
      genre: string | null;
      durationSeconds: number;
      playedAt: number;
    }> = [];

    for (const rawItem of entries) {
      if (!rawItem || typeof rawItem !== "object") {
        skippedShortOrNonMusic++;
        continue;
      }
      const item = rawItem as Record<string, unknown>;

      let artistName: string | null = null;
      let trackTitle: string | null = null;
      let albumTitle: string | null = null;
      let msPlayed = 0;
      let playedAt: number | null = null;
      let skippedFlag = false;

      if (
        "master_metadata_track_name" in item ||
        "ts" in item ||
        "ms_played" in item
      ) {
        // Extended Streaming History format
        sawExtended = true;
        artistName =
          typeof item.master_metadata_album_artist_name === "string"
            ? item.master_metadata_album_artist_name.trim()
            : null;
        trackTitle =
          typeof item.master_metadata_track_name === "string"
            ? item.master_metadata_track_name.trim()
            : null;
        albumTitle =
          typeof item.master_metadata_album_name === "string"
            ? item.master_metadata_album_name.trim()
            : null;
        msPlayed = typeof item.ms_played === "number" ? item.ms_played : 0;
        playedAt = typeof item.ts === "string" ? parseSpotifyTimestamp(item.ts) : null;
        skippedFlag = item.skipped === true;
      } else if ("trackName" in item || "artistName" in item || "endTime" in item) {
        // Account Data (Last 12 Months) format
        sawAccount = true;
        artistName = typeof item.artistName === "string" ? item.artistName.trim() : null;
        trackTitle = typeof item.trackName === "string" ? item.trackName.trim() : null;
        msPlayed = typeof item.msPlayed === "number" ? item.msPlayed : 0;
        playedAt = typeof item.endTime === "string" ? parseSpotifyTimestamp(item.endTime) : null;
      } else {
        skippedShortOrNonMusic++;
        continue;
      }

      // Skip podcasts/audiobooks (null track/artist), invalid timestamps, or short skips
      if (
        !artistName ||
        !trackTitle ||
        !playedAt ||
        !Number.isFinite(msPlayed) ||
        msPlayed < minMs ||
        (skippedFlag && msPlayed < 90_000)
      ) {
        skippedShortOrNonMusic++;
        continue;
      }

      const nArtist = normalizeMatchText(artistName);
      const nTitle = normalizeMatchText(trackTitle);
      const songKey = `${nArtist}::${nTitle}`;

      if (isDuplicate(songKey, playedAt)) {
        deduplicatedCount++;
        continue;
      }
      addSeen(songKey, playedAt);

      // Link to user's local library when possible
      const matchedTrack = trackByArtistTitle.get(songKey);
      let trackId: number | null = null;
      let albumId: number | null = null;
      let artistId: number | null = null;
      let genre: string | null = null;
      let resolvedAlbumTitle = albumTitle || "";

      if (matchedTrack) {
        trackId = matchedTrack.trackId;
        albumId = matchedTrack.albumId;
        artistId = matchedTrack.artistId;
        genre = matchedTrack.genre;
        if (!resolvedAlbumTitle) resolvedAlbumTitle = matchedTrack.albumTitle;
        matchedLocalTracks++;
      } else {
        const matchedAlbum = albumTitle
          ? albumByArtistAlbum.get(`${nArtist}::${normalizeMatchText(albumTitle)}`)
          : undefined;
        if (matchedAlbum) {
          albumId = matchedAlbum.albumId;
          artistId = matchedAlbum.artistId;
          genre = matchedAlbum.genre;
        } else {
          artistId = artistByNormName.get(nArtist) ?? null;
        }
      }

      const durationSeconds = Math.round(msPlayed / 1000);
      toInsert.push({
        trackId,
        albumId,
        artistId,
        trackTitle: trackTitle.slice(0, 300),
        albumTitle: (resolvedAlbumTitle || "Unknown Album").slice(0, 300),
        artistName: artistName.slice(0, 300),
        genre,
        durationSeconds,
        playedAt,
      });

      if (earliestMs === null || playedAt < earliestMs) earliestMs = playedAt;
      if (latestMs === null || playedAt > latestMs) latestMs = playedAt;
    }

    if (toInsert.length > 0) {
      const insertStmt = sqlite.prepare(
        `
        INSERT INTO play_events (
          user_id, track_id, album_id, artist_id,
          track_title, album_title, artist_name, genre,
          duration_seconds, played_at, client_name, source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Spotify (Imported)', 'import')
      `,
      );
      const tx = sqlite.transaction(() => {
        for (const row of toInsert) {
          insertStmt.run(
            userId,
            row.trackId,
            row.albumId,
            row.artistId,
            row.trackTitle,
            row.albumTitle,
            row.artistName,
            row.genre,
            row.durationSeconds,
            row.playedAt,
          );
        }
      });
      tx();
      importedCount = toInsert.length;
    }

    const format =
      sawExtended && sawAccount
        ? "mixed"
        : sawExtended
          ? "extended"
          : sawAccount
            ? "account"
            : "unknown";

    return {
      format,
      totalEntries: entries.length,
      importedCount,
      matchedLocalTracks,
      skippedShortOrNonMusic,
      deduplicatedCount,
      earliestPlayedAt: earliestMs !== null ? new Date(earliestMs).toISOString() : null,
      latestPlayedAt: latestMs !== null ? new Date(latestMs).toISOString() : null,
    };
  }

  clearImportedHistory(userId: number): { deletedCount: number } {
    const info = this.dbContext.sqlite
      .prepare("DELETE FROM play_events WHERE user_id = ? AND source = 'import'")
      .run(userId);
    return { deletedCount: info.changes };
  }
}
