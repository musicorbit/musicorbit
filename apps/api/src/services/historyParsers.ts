import type { HistoryImportFormat } from "@musicorbit/shared";

export interface NormalizedHistoryPlay {
  artistName: string;
  trackTitle: string;
  albumTitle: string | null;
  /** Played duration in seconds, or null if the export format doesn't store track duration (e.g. Last.fm). */
  durationSeconds: number | null;
  playedAt: number;
  clientName: string;
}

export interface ParsedHistoryBatch {
  format: HistoryImportFormat;
  detectedSources: string[];
  totalEntries: number;
  skippedShortOrNonMusic: number;
  plays: NormalizedHistoryPlay[];
}

/**
 * RFC-4180 compliant CSV parser supporting quoted fields, embedded commas/newlines,
 * escaped double quotes (""), and UTF-8 BOM stripping.
 */
export function parseCsvRows(rawInput: string): string[][] {
  const input = rawInput.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) {
    rows.push(row);
  }
  return rows;
}

export function parseFlexibleTimestamp(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw < 1e11 ? Math.round(raw * 1000) : Math.round(raw);
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Numeric Unix timestamp as string (seconds or milliseconds)
  if (/^\d{9,13}$/.test(trimmed)) {
    const n = Number(trimmed);
    return n < 1e11 ? n * 1000 : n;
  }

  // ISO-8601 (Spotify Extended, Apple Music)
  if (trimmed.includes("T")) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }

  // Spotify Account Data: "YYYY-MM-DD HH:mm" or "YYYY-MM-DD HH:mm:ss" (UTC)
  const spMatch = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (spMatch) {
    const ms = Date.parse(`${spMatch[1]}T${spMatch[2]}:${spMatch[3] ?? "00"}Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  // Last.fm CSV date strings like "15 Oct 2025 21:43" or "15 Oct 2025, 21:43" (UTC)
  const cleanedLastFm = trimmed.replace(",", "");
  const msUtc = Date.parse(`${cleanedLastFm} UTC`);
  if (Number.isFinite(msUtc)) return msUtc;

  const fallback = Date.parse(trimmed);
  return Number.isFinite(fallback) ? fallback : null;
}

function readTextField(val: unknown): string | null {
  if (typeof val === "string") {
    const t = val.trim();
    return t.length > 0 ? t : null;
  }
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const text = obj["#text"] ?? obj.name ?? obj.title;
    if (typeof text === "string" && text.trim().length > 0) {
      return text.trim();
    }
  }
  return null;
}

export function parseJsonHistoryEntries(
  entries: unknown[],
  minSeconds = 30,
): ParsedHistoryBatch {
  const minMs = Math.max(5, Math.min(300, minSeconds)) * 1000;
  const plays: NormalizedHistoryPlay[] = [];
  const formatsSeen = new Set<HistoryImportFormat>();
  const sourcesSeen = new Set<string>();
  let skippedShortOrNonMusic = 0;

  for (const rawItem of entries) {
    if (!rawItem || typeof rawItem !== "object") {
      skippedShortOrNonMusic++;
      continue;
    }
    const item = rawItem as Record<string, unknown>;

    // 1. ListenBrainz ({ listened_at, track_metadata: { artist_name, track_name, release_name } })
    if ("track_metadata" in item && "listened_at" in item) {
      formatsSeen.add("listenbrainz");
      const meta =
        item.track_metadata && typeof item.track_metadata === "object"
          ? (item.track_metadata as Record<string, unknown>)
          : null;
      const artistName = readTextField(meta?.artist_name);
      const trackTitle = readTextField(meta?.track_name);
      const albumTitle = readTextField(meta?.release_name);
      const playedAt = parseFlexibleTimestamp(item.listened_at);
      const addInfo =
        meta?.additional_info && typeof meta.additional_info === "object"
          ? (meta.additional_info as Record<string, unknown>)
          : null;
      const durMs =
        typeof addInfo?.duration_ms === "number" && addInfo.duration_ms > 0
          ? addInfo.duration_ms
          : typeof addInfo?.duration === "number" && addInfo.duration > 0
            ? addInfo.duration * 1000
            : null;

      if (!artistName || !trackTitle || !playedAt) {
        skippedShortOrNonMusic++;
        continue;
      }
      sourcesSeen.add("ListenBrainz");
      plays.push({
        artistName,
        trackTitle,
        albumTitle,
        durationSeconds: durMs !== null ? Math.round(durMs / 1000) : null,
        playedAt,
        clientName: "ListenBrainz (Imported)",
      });
      continue;
    }

    // 2. Spotify Extended Streaming History
    if ("master_metadata_track_name" in item || "ms_played" in item || "ts" in item) {
      formatsSeen.add("spotify_extended");
      const artistName = readTextField(item.master_metadata_album_artist_name);
      const trackTitle = readTextField(item.master_metadata_track_name);
      const albumTitle = readTextField(item.master_metadata_album_name);
      const msPlayed = typeof item.ms_played === "number" ? item.ms_played : 0;
      const playedAt = parseFlexibleTimestamp(item.ts);
      const skippedFlag = item.skipped === true;

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
      sourcesSeen.add("Spotify");
      plays.push({
        artistName,
        trackTitle,
        albumTitle,
        durationSeconds: Math.round(msPlayed / 1000),
        playedAt,
        clientName: "Spotify (Imported)",
      });
      continue;
    }

    // 3. Spotify Account Data (Last 12 Months)
    if ("trackName" in item || "msPlayed" in item || "endTime" in item) {
      formatsSeen.add("spotify_account");
      const artistName = readTextField(item.artistName);
      const trackTitle = readTextField(item.trackName);
      const msPlayed = typeof item.msPlayed === "number" ? item.msPlayed : 0;
      const playedAt = parseFlexibleTimestamp(item.endTime);

      if (!artistName || !trackTitle || !playedAt || !Number.isFinite(msPlayed) || msPlayed < minMs) {
        skippedShortOrNonMusic++;
        continue;
      }
      sourcesSeen.add("Spotify");
      plays.push({
        artistName,
        trackTitle,
        albumTitle: null,
        durationSeconds: Math.round(msPlayed / 1000),
        playedAt,
        clientName: "Spotify (Imported)",
      });
      continue;
    }

    // 4. Last.fm JSON export ({ artist, album, name/track, date/uts/timestamp })
    if ("artist" in item && ("name" in item || "track" in item)) {
      formatsSeen.add("lastfm");
      const artistName = readTextField(item.artist);
      const trackTitle = readTextField(item.track ?? item.name);
      const albumTitle = readTextField(item.album);
      const rawDate =
        item.date && typeof item.date === "object"
          ? ((item.date as Record<string, unknown>).uts ??
            (item.date as Record<string, unknown>)["#text"])
          : (item.uts ?? item.timestamp ?? item.date);
      const playedAt = parseFlexibleTimestamp(rawDate);

      if (!artistName || !trackTitle || !playedAt) {
        skippedShortOrNonMusic++;
        continue;
      }
      sourcesSeen.add("Last.fm");
      plays.push({
        artistName,
        trackTitle,
        albumTitle,
        durationSeconds: null,
        playedAt,
        clientName: "Last.fm (Imported)",
      });
      continue;
    }

    skippedShortOrNonMusic++;
  }

  let format: HistoryImportFormat = "unknown";
  if (formatsSeen.size === 1) {
    format = Array.from(formatsSeen)[0]!;
  } else if (formatsSeen.size > 1) {
    format = "mixed";
  }

  return {
    format,
    detectedSources: Array.from(sourcesSeen),
    totalEntries: entries.length,
    skippedShortOrNonMusic,
    plays,
  };
}

function parseCsvHistory(rawCsv: string, minSeconds = 30): ParsedHistoryBatch {
  const rows = parseCsvRows(rawCsv);
  if (rows.length === 0) {
    return {
      format: "unknown",
      detectedSources: [],
      totalEntries: 0,
      skippedShortOrNonMusic: 0,
      plays: [],
    };
  }

  const firstRowLower = rows[0]!.map((c) => c.trim().toLowerCase());
  const minMs = Math.max(5, Math.min(300, minSeconds)) * 1000;

  // 1. Apple Music Play Activity CSV (official Apple Privacy Export)
  const songIdx = firstRowLower.findIndex((h) => h === "song name" || h === "track description");
  const appleTimeIdx = firstRowLower.findIndex(
    (h) => h === "event end timestamp" || h === "event start timestamp" || h === "date played",
  );
  if (songIdx >= 0 && appleTimeIdx >= 0) {
    const artistIdx = firstRowLower.findIndex((h) => h === "artist name");
    const albumIdx = firstRowLower.findIndex(
      (h) => h === "container name" || h === "album name",
    );
    const durIdx = firstRowLower.findIndex((h) => h === "play duration milliseconds");
    const mediaTypeIdx = firstRowLower.findIndex((h) => h === "media type");

    const dataRows = rows.slice(1);
    const plays: NormalizedHistoryPlay[] = [];
    let skipped = 0;

    for (const r of dataRows) {
      const mediaType = mediaTypeIdx >= 0 ? (r[mediaTypeIdx] ?? "").trim().toUpperCase() : "";
      if (mediaType && mediaType !== "AUDIO") {
        skipped++;
        continue;
      }

      let songName = (r[songIdx] ?? "").trim();
      let artistName = artistIdx >= 0 ? (r[artistIdx] ?? "").trim() : "";

      // Apple's "Play History Daily Tracks" sometimes combines "Artist - Song" in Track Description
      if (!artistName && songName.includes(" - ")) {
        const dashIdx = songName.indexOf(" - ");
        artistName = songName.slice(0, dashIdx).trim();
        songName = songName.slice(dashIdx + 3).trim();
      }

      const albumName = albumIdx >= 0 ? (r[albumIdx] ?? "").trim() || null : null;
      const playedAt = parseFlexibleTimestamp(r[appleTimeIdx]);
      const rawDur = durIdx >= 0 ? Number((r[durIdx] ?? "").trim()) : NaN;
      const hasDur = Number.isFinite(rawDur) && rawDur > 0;

      if (!songName || !artistName || !playedAt || (durIdx >= 0 && (!hasDur || rawDur < minMs))) {
        skipped++;
        continue;
      }

      plays.push({
        artistName,
        trackTitle: songName,
        albumTitle: albumName,
        durationSeconds: hasDur ? Math.round(rawDur / 1000) : null,
        playedAt,
        clientName: "Apple Music (Imported)",
      });
    }

    return {
      format: "apple_music",
      detectedSources: plays.length > 0 ? ["Apple Music"] : [],
      totalEntries: dataRows.length,
      skippedShortOrNonMusic: skipped,
      plays,
    };
  }

  // 2. Last.fm CSV (headed: uts/utc_time/artist/album/track or artist/album/track/date)
  const lfmArtistIdx = firstRowLower.findIndex((h) => h === "artist" || h === "artist name");
  const lfmTrackIdx = firstRowLower.findIndex(
    (h) => h === "track" || h === "track name" || h === "song" || h === "title",
  );
  const lfmAlbumIdx = firstRowLower.findIndex((h) => h === "album" || h === "album name");
  const lfmDateIdx = firstRowLower.findIndex(
    (h) =>
      h === "uts" ||
      h === "utc_time" ||
      h === "date" ||
      h === "timestamp" ||
      h === "played_at" ||
      h === "time",
  );

  if (lfmArtistIdx >= 0 && lfmTrackIdx >= 0 && lfmDateIdx >= 0) {
    const dataRows = rows.slice(1);
    const plays: NormalizedHistoryPlay[] = [];
    let skipped = 0;

    for (const r of dataRows) {
      const artistName = (r[lfmArtistIdx] ?? "").trim();
      const trackTitle = (r[lfmTrackIdx] ?? "").trim();
      const albumTitle = lfmAlbumIdx >= 0 ? (r[lfmAlbumIdx] ?? "").trim() || null : null;
      const playedAt = parseFlexibleTimestamp(r[lfmDateIdx]);

      if (!artistName || !trackTitle || !playedAt) {
        skipped++;
        continue;
      }

      plays.push({
        artistName,
        trackTitle,
        albumTitle,
        durationSeconds: null,
        playedAt,
        clientName: "Last.fm (Imported)",
      });
    }

    return {
      format: "lastfm",
      detectedSources: plays.length > 0 ? ["Last.fm"] : [],
      totalEntries: dataRows.length,
      skippedShortOrNonMusic: skipped,
      plays,
    };
  }

  // 3. Headerless 4-column Last.fm CSV (benjaminbenben.com/lastfm-to-csv: Artist,Album,Track,Date)
  if (rows[0]!.length === 4 && parseFlexibleTimestamp(rows[0]![3]) !== null) {
    const plays: NormalizedHistoryPlay[] = [];
    let skipped = 0;

    for (const r of rows) {
      const artistName = (r[0] ?? "").trim();
      const albumTitle = (r[1] ?? "").trim() || null;
      const trackTitle = (r[2] ?? "").trim();
      const playedAt = parseFlexibleTimestamp(r[3]);

      if (!artistName || !trackTitle || !playedAt) {
        skipped++;
        continue;
      }

      plays.push({
        artistName,
        trackTitle,
        albumTitle,
        durationSeconds: null,
        playedAt,
        clientName: "Last.fm (Imported)",
      });
    }

    return {
      format: "lastfm",
      detectedSources: plays.length > 0 ? ["Last.fm"] : [],
      totalEntries: rows.length,
      skippedShortOrNonMusic: skipped,
      plays,
    };
  }

  return {
    format: "unknown",
    detectedSources: [],
    totalEntries: rows.length,
    skippedShortOrNonMusic: rows.length,
    plays: [],
  };
}

/**
 * Auto-detects and parses listening history files from Spotify (JSON),
 * Apple Music (CSV), Last.fm (CSV/JSON), and ListenBrainz (JSON/JSONL).
 */
export function parseListeningHistoryContent(
  rawContent: string,
  options?: { filename?: string; minSeconds?: number },
): ParsedHistoryBatch {
  const minSeconds = options?.minSeconds ?? 30;
  const trimmed = rawContent.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return {
      format: "unknown",
      detectedSources: [],
      totalEntries: 0,
      skippedShortOrNonMusic: 0,
      plays: [],
    };
  }

  const lowerName = (options?.filename ?? "").toLowerCase();
  const looksJson =
    trimmed.startsWith("[") ||
    trimmed.startsWith("{") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".jsonl");

  if (looksJson) {
    // Try standard JSON first (array or wrapped object like { recenttracks: { track: [...] } } or { listens: [...] })
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parseJsonHistoryEntries(parsed, minSeconds);
      }
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const nested =
          (Array.isArray(obj.listens) ? obj.listens : null) ??
          (Array.isArray(obj.tracks) ? obj.tracks : null) ??
          (Array.isArray(obj.scrobbles) ? obj.scrobbles : null) ??
          (obj.recenttracks &&
          typeof obj.recenttracks === "object" &&
          Array.isArray((obj.recenttracks as Record<string, unknown>).track)
            ? ((obj.recenttracks as Record<string, unknown>).track as unknown[])
            : null);
        if (nested) {
          return parseJsonHistoryEntries(nested, minSeconds);
        }
        return parseJsonHistoryEntries([parsed], minSeconds);
      }
    } catch {
      // Fall through to JSONL (ListenBrainz exports one JSON object per line)
    }

    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const jsonlEntries: unknown[] = [];
    for (const line of lines) {
      try {
        jsonlEntries.push(JSON.parse(line));
      } catch {
        // Ignore malformed line
      }
    }
    if (jsonlEntries.length > 0) {
      return parseJsonHistoryEntries(jsonlEntries, minSeconds);
    }
  }

  return parseCsvHistory(trimmed, minSeconds);
}
