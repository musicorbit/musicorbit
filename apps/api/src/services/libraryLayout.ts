import path from "node:path";
import type { LibraryLayoutPreset, LibraryOrganizationSettings } from "@musicorbit/shared";

export interface TrackLayoutInput {
  albumArtist: string;
  trackArtist?: string;
  album: string;
  title: string;
  year?: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  hasMultipleDiscs?: boolean;
  extension: string; // e.g. ".flac"
}

export const DEFAULT_LIBRARY_ORGANIZATION: LibraryOrganizationSettings = {
  layoutPreset: "artist_album_track",
  includeYearInAlbumFolder: false,
  includeTrackNumber: true,
  multiDiscStyle: "prefix",
  autoOrganizeLibrary: false,
};

/**
 * Sanitizes a path segment (artist, album, or track title) so it is safe on macOS,
 * Linux, Windows, SMB/NAS mounts, and Docker bind mounts.
 */
export function sanitizeLayoutSegment(value: string, fallback = "Unknown"): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function isPlaceholderTag(value: string | null | undefined, placeholders: string[]): boolean {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed) return true;
  return placeholders.includes(trimmed);
}

/**
 * Checks whether a track has enough metadata to be safely organized into the chosen layout.
 * Prevents dumping poorly-tagged files into "Unknown Artist/Unknown Album/".
 */
export function getMissingOrganizationTagReason(
  input: TrackLayoutInput,
  preset: LibraryLayoutPreset,
): string | null {
  if (preset === "keep_existing") return null;

  const missingArtist = isPlaceholderTag(input.albumArtist || input.trackArtist, [
    "unknown artist",
    "unknown",
  ]);
  const missingAlbum = isPlaceholderTag(input.album, ["unknown album", "unknown"]);
  const missingTitle = isPlaceholderTag(input.title, ["untitled", "unknown", "track"]);

  if (missingTitle) {
    return "Missing track title tag — edit track metadata before organizing.";
  }
  if (missingArtist) {
    return "Missing Artist tag — edit tags or Fix Tags before organizing.";
  }
  if (preset === "artist_album_track" && missingAlbum) {
    return "Missing Album tag — edit tags or Fix Tags before organizing.";
  }
  return null;
}

/**
 * Computes the relative target path (POSIX or OS path segments) inside MUSIC_DIR
 * for a track according to the user's LibraryOrganizationSettings.
 *
 * When `forExternalImport` is true and preset is `keep_existing`, falls back to
 * `artist_album_track` because external downloads/bulk imports still need a target
 * location inside MUSIC_DIR.
 */
export function formatTrackRelativePath(
  input: TrackLayoutInput,
  settings: LibraryOrganizationSettings,
  options?: { forExternalImport?: boolean },
): string | null {
  const effectivePreset: LibraryLayoutPreset =
    settings.layoutPreset === "keep_existing"
      ? options?.forExternalImport
        ? "artist_album_track"
        : "keep_existing"
      : settings.layoutPreset;

  if (effectivePreset === "keep_existing") {
    return null;
  }

  const ext = input.extension.startsWith(".")
    ? input.extension.toLowerCase()
    : `.${input.extension.toLowerCase()}`;
  const safeAlbumArtist = sanitizeLayoutSegment(
    input.albumArtist || input.trackArtist || "",
    "Unknown Artist",
  );
  const safeTrackArtist = sanitizeLayoutSegment(
    input.trackArtist || input.albumArtist || "",
    safeAlbumArtist,
  );
  const safeTitle = sanitizeLayoutSegment(input.title, "Untitled");

  const trackNum =
    input.trackNumber && input.trackNumber > 0 ? Math.floor(input.trackNumber) : null;
  const discNum = input.discNumber && input.discNumber > 0 ? Math.floor(input.discNumber) : 1;
  const multiDisc = Boolean(input.hasMultipleDiscs);

  const buildNumberedFilename = (useDiscPrefix: boolean): string => {
    if (!settings.includeTrackNumber || trackNum === null) {
      return `${safeTitle}${ext}`;
    }
    const padded = String(trackNum).padStart(2, "0");
    if (multiDisc && useDiscPrefix) {
      return `${discNum}-${padded} - ${safeTitle}${ext}`;
    }
    return `${padded} - ${safeTitle}${ext}`;
  };

  if (effectivePreset === "flat") {
    return `${safeTrackArtist} - ${safeTitle}${ext}`;
  }

  if (effectivePreset === "artist_track") {
    const filename = buildNumberedFilename(true);
    return path.join(safeAlbumArtist, filename);
  }

  // Default: "artist_album_track"
  const safeAlbum = sanitizeLayoutSegment(input.album, "Unknown Album");
  const albumFolder =
    settings.includeYearInAlbumFolder && input.year && input.year > 0
      ? `${safeAlbum} (${input.year})`
      : safeAlbum;

  if (multiDisc && settings.multiDiscStyle === "subfolder") {
    const filename = buildNumberedFilename(false);
    return path.join(safeAlbumArtist, albumFolder, `Disc ${discNum}`, filename);
  }

  const filename = buildNumberedFilename(true);
  return path.join(safeAlbumArtist, albumFolder, filename);
}
