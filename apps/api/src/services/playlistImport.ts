import path from "node:path";

export interface ParsedPlaylistEntry {
  title: string;
  artist: string;
  album: string | null;
  rawPath?: string;
  rawLabel: string;
}

export interface LocalLibraryTrack {
  id: number;
  title: string;
  artistName: string;
  filePath: string;
}

/**
 * Strips accents, featured-artist / remaster parentheticals, and punctuation
 * so Spotify/Exportify titles reliably match local tags.
 */
export function normalizeForMatching(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*[\(\[](feat\.?|ft\.?|featuring|remaster(?:ed)?[^)\]]*|deluxe[^)\]]*|radio edit|album version|explicit|clean)[^)\]]*[\)\]]/gi, " ")
    .replace(/\s+-\s+(remaster(?:ed)?.*|radio edit|single version|album version)$/i, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits multi-artist fields (e.g. Exportify's "Adele;Someone Else" or "Artist A, Artist B")
 * and returns the primary artist first followed by individual artist tokens.
 */
export function extractArtistVariants(artist: string): string[] {
  const full = normalizeForMatching(artist);
  if (!full) return [];
  const parts = artist
    .split(/[;,/]|\s+(?:feat\.?|ft\.?|featuring|with|x)\s+/i)
    .map((p) => normalizeForMatching(p))
    .filter(Boolean);
  return Array.from(new Set([full, ...parts]));
}

/**
 * RFC-4180 compliant CSV parser supporting quoted commas, escaped double quotes (""),
 * UTF-8 BOM, and both CRLF and LF newlines.
 */
export function parseCsvRows(content: string): string[][] {
  const cleaned = content.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];

    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && cleaned[i + 1] === "\n") {
        i += 1;
      }
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  for (const cand of candidates) {
    const idx = normalized.indexOf(cand);
    if (idx !== -1) return idx;
  }
  // Substring fallback (e.g. "spotify track name")
  for (const cand of candidates) {
    const idx = normalized.findIndex((h) => h.includes(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parses Exportify, Soundiiz, TuneMyMusic, or generic CSV playlists into structured track entries.
 */
export function parseCsvPlaylist(content: string): ParsedPlaylistEntry[] {
  const rows = parseCsvRows(content);
  if (rows.length < 2) return [];

  const headerRow = rows[0] ?? [];
  const titleIdx = findColumnIndex(headerRow, [
    "track name",
    "title",
    "track",
    "song",
    "song name",
    "name",
  ]);
  const artistIdx = findColumnIndex(headerRow, [
    "artist name(s)",
    "artist names",
    "artist name",
    "artist",
    "artists",
    "album artist name(s)",
  ]);
  const albumIdx = findColumnIndex(headerRow, ["album name", "album"]);

  if (titleIdx === -1) {
    return [];
  }

  const entries: ParsedPlaylistEntry[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cols = rows[i] ?? [];
    const title = (cols[titleIdx] ?? "").trim();
    const rawArtist = artistIdx >= 0 ? (cols[artistIdx] ?? "").trim() : "";
    const album = albumIdx >= 0 ? (cols[albumIdx] ?? "").trim() || null : null;

    if (!title) continue;

    // Exportify joins multiple artists with ";" -> display cleanly with ", "
    const artist = rawArtist
      ? rawArtist
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(", ")
      : "Unknown Artist";

    entries.push({
      title,
      artist,
      album,
      rawLabel: rawArtist ? `${artist} - ${title}` : title,
    });
  }

  return entries;
}

function splitArtistTitleLabel(label: string): { artist: string; title: string } {
  const parts = label.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim(),
    };
  }
  return { artist: "Unknown Artist", title: label.trim() };
}

/**
 * Parses standard #EXTM3U / .m3u8 files into structured entries while preserving
 * both relative paths and #EXTINF artist/title labels.
 */
export function parseM3u8Playlist(content: string): ParsedPlaylistEntry[] {
  const rawLines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: ParsedPlaylistEntry[] = [];
  let pendingExtinf: string | null = null;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const commaIdx = line.indexOf(",");
      pendingExtinf = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : null;
      continue;
    }
    if (line.startsWith("#")) continue;

    const normalizedPath = line.replace(/\\/g, "/").replace(/^\.\//, "");
    const baseNoExt = path.posix
      .basename(normalizedPath)
      .replace(/\.[^.]+$/, "")
      .replace(/^\d{1,3}[\s._-]+/, "")
      .trim();

    const parsed = pendingExtinf
      ? splitArtistTitleLabel(pendingExtinf)
      : splitArtistTitleLabel(baseNoExt || normalizedPath);

    entries.push({
      title: parsed.title || baseNoExt || normalizedPath,
      artist: parsed.artist || "Unknown Artist",
      album: null,
      rawPath: normalizedPath,
      rawLabel: pendingExtinf || line,
    });
    pendingExtinf = null;
  }

  return entries;
}

export interface LibraryTrackMatcher {
  match: (entry: ParsedPlaylistEntry) => number | null;
}

/**
 * Builds fast lookup indexes over local SQLite tracks to match imported entries
 * by relative path, filename, or normalized title + artist.
 */
export function buildLibraryTrackMatcher(
  allTracks: LocalLibraryTrack[],
  musicDir: string,
): LibraryTrackMatcher {
  const byRelPath = new Map<string, number>();
  const byBasename = new Map<string, number>();
  const byTitle = new Map<string, Array<{ id: number; artistNorm: string; artistVariants: string[] }>>();

  for (const t of allTracks) {
    const rel = path.relative(musicDir, t.filePath).split(path.sep).join("/").toLowerCase();
    byRelPath.set(rel, t.id);
    byBasename.set(path.basename(t.filePath).toLowerCase(), t.id);

    const normTitle = normalizeForMatching(t.title);
    if (!normTitle) continue;
    const list = byTitle.get(normTitle) ?? [];
    list.push({
      id: t.id,
      artistNorm: normalizeForMatching(t.artistName),
      artistVariants: extractArtistVariants(t.artistName),
    });
    byTitle.set(normTitle, list);
  }

  return {
    match(entry: ParsedPlaylistEntry): number | null {
      // 1. Direct path / filename match (for .m3u8 files)
      if (entry.rawPath) {
        const lowerPath = entry.rawPath.toLowerCase();
        const byPath = byRelPath.get(lowerPath);
        if (byPath !== undefined) return byPath;

        const base = path.posix.basename(lowerPath);
        const byBase = byBasename.get(base);
        if (byBase !== undefined) return byBase;
      }

      // 2. Normalized title + artist match (works across Exportify CSV & #EXTINF)
      const normTitle = normalizeForMatching(entry.title);
      if (!normTitle) return null;

      const candidates = byTitle.get(normTitle);
      if (!candidates || candidates.length === 0) return null;

      const entryArtists = extractArtistVariants(entry.artist);
      if (entryArtists.length === 0 || entry.artist === "Unknown Artist") {
        // Only auto-match on title alone if there is a single unambiguous local track
        return candidates.length === 1 ? (candidates[0]?.id ?? null) : null;
      }

      // Exact artist variant match
      for (const cand of candidates) {
        if (cand.artistVariants.some((v) => entryArtists.includes(v))) {
          return cand.id;
        }
      }

      // Partial artist containment (e.g. "marina" <-> "marina and the diamonds")
      for (const cand of candidates) {
        for (const ea of entryArtists) {
          if (ea.length < 3) continue;
          if (cand.artistNorm.includes(ea) || ea.includes(cand.artistNorm)) {
            return cand.id;
          }
        }
      }

      return null;
    },
  };
}
