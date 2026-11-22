import fsp from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import { ByteVector, File as TagLibFile, Picture, PictureType } from "node-taglib-sharp";
import type { EditableTrackTags, TrackMetadataResponse } from "@musicorbit/shared";

export interface AudioTagWriteInput {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre?: string | null;
  musicBrainzReleaseId?: string | null;
  musicBrainzArtistId?: string | null;
  musicBrainzTrackId?: string | null;
}

function splitList(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Rewrites core embedded audio metadata tags in-place (used by the Import Pipeline
 * and Album-level "Fix Tags").
 */
export function writeAudioTags(filePath: string, input: AudioTagWriteInput): void {
  const file = TagLibFile.createFromPath(filePath);
  try {
    file.tag.title = input.title;
    file.tag.album = input.album;
    file.tag.performers = [input.artist];
    file.tag.albumArtists = [input.albumArtist];

    if (input.trackNumber !== null && input.trackNumber > 0) {
      file.tag.track = input.trackNumber;
    }
    if (input.discNumber !== null && input.discNumber > 0) {
      file.tag.disc = input.discNumber;
    }
    if (input.year !== null && input.year > 0) {
      file.tag.year = input.year;
    }
    if (input.genre !== undefined) {
      file.tag.genres = input.genre && input.genre.trim().length > 0 ? splitList(input.genre) : [];
    }
    if (input.musicBrainzReleaseId) {
      file.tag.musicBrainzReleaseId = input.musicBrainzReleaseId;
    }
    if (input.musicBrainzArtistId) {
      file.tag.musicBrainzReleaseArtistId = input.musicBrainzArtistId;
      file.tag.musicBrainzArtistId = input.musicBrainzArtistId;
    }
    if (input.musicBrainzTrackId) {
      file.tag.musicBrainzTrackId = input.musicBrainzTrackId;
    }

    file.save();
  } finally {
    file.dispose();
  }
}

/**
 * Reads every editable metadata tag plus technical audio stream info from a file.
 */
export async function readFullTrackMetadata(
  trackId: number,
  albumId: number,
  filePath: string,
): Promise<TrackMetadataResponse> {
  const [stat, parsed] = await Promise.all([
    fsp.stat(filePath),
    parseFile(filePath, { duration: true }),
  ]);

  const tlFile = TagLibFile.createFromPath(filePath);
  try {
    const tag = tlFile.tag;
    const pic = tag.pictures?.[0] ?? null;

    const tags: EditableTrackTags = {
      title: tag.title || parsed.common.title || path.basename(filePath, path.extname(filePath)),
      artists:
        tag.performers?.filter(Boolean).join(", ") ||
        parsed.common.artists?.join(", ") ||
        parsed.common.artist ||
        "",
      albumArtist:
        tag.albumArtists?.filter(Boolean).join(", ") || parsed.common.albumartist || "",
      album: tag.album || parsed.common.album || "",
      trackNumber: tag.track > 0 ? tag.track : (parsed.common.track.no ?? null),
      trackTotal: tag.trackCount > 0 ? tag.trackCount : (parsed.common.track.of ?? null),
      discNumber: tag.disc > 0 ? tag.disc : (parsed.common.disk.no ?? null),
      discTotal: tag.discCount > 0 ? tag.discCount : (parsed.common.disk.of ?? null),
      year: tag.year > 0 ? tag.year : (parsed.common.year && parsed.common.year > 0 ? parsed.common.year : null),
      genres: tag.genres?.filter(Boolean).join(", ") || parsed.common.genre?.join(", ") || "",
      composers:
        tag.composers?.filter(Boolean).join(", ") || parsed.common.composer?.join(", ") || "",
      bpm: tag.beatsPerMinute > 0 ? tag.beatsPerMinute : (parsed.common.bpm ? Math.round(parsed.common.bpm) : null),
      grouping: tag.grouping || parsed.common.grouping || "",
      publisher: tag.publisher || parsed.common.label?.join(", ") || "",
      comment: tag.comment || "",
      lyrics: tag.lyrics || "",
      musicBrainzTrackId: tag.musicBrainzTrackId || parsed.common.musicbrainz_recordingid || "",
      musicBrainzReleaseId: tag.musicBrainzReleaseId || parsed.common.musicbrainz_albumid || "",
      musicBrainzArtistId:
        tag.musicBrainzArtistId || parsed.common.musicbrainz_artistid?.[0] || "",
      musicBrainzReleaseArtistId:
        tag.musicBrainzReleaseArtistId || parsed.common.musicbrainz_albumartistid?.[0] || "",
    };

    const embeddedPic = parsed.common.picture?.[0];
    const hasEmbeddedCover = Boolean(pic || embeddedPic);
    const embeddedCoverMime = pic?.mimeType || embeddedPic?.format || null;
    const embeddedCoverSizeBytes = pic?.data?.length ?? embeddedPic?.data?.byteLength ?? null;

    return {
      trackId,
      albumId,
      filePath,
      basename: path.basename(filePath),
      fileSize: stat.size,
      technical: {
        codec: parsed.format.codec ?? null,
        container: parsed.format.container ?? null,
        bitrate: parsed.format.bitrate ? Math.round(parsed.format.bitrate) : null,
        sampleRate: parsed.format.sampleRate ? Math.round(parsed.format.sampleRate) : null,
        bitsPerSample: parsed.format.bitsPerSample ?? null,
        channels: parsed.format.numberOfChannels ?? null,
        durationSeconds: parsed.format.duration ?? null,
        tagTypes: parsed.format.tagTypes ?? [],
      },
      tags,
      hasEmbeddedCover,
      embeddedCoverMime,
      embeddedCoverSizeBytes,
    };
  } finally {
    tlFile.dispose();
  }
}

/**
 * Writes every editable tag field directly into the audio file.
 */
export function writeFullTrackMetadata(filePath: string, tags: EditableTrackTags): void {
  const file = TagLibFile.createFromPath(filePath);
  try {
    file.tag.title = tags.title.trim();
    file.tag.performers = splitList(tags.artists);
    file.tag.albumArtists = splitList(tags.albumArtist);
    file.tag.album = tags.album.trim();
    file.tag.track = tags.trackNumber && tags.trackNumber > 0 ? tags.trackNumber : 0;
    file.tag.trackCount = tags.trackTotal && tags.trackTotal > 0 ? tags.trackTotal : 0;
    file.tag.disc = tags.discNumber && tags.discNumber > 0 ? tags.discNumber : 0;
    file.tag.discCount = tags.discTotal && tags.discTotal > 0 ? tags.discTotal : 0;
    file.tag.year = tags.year && tags.year > 0 ? tags.year : 0;
    file.tag.genres = splitList(tags.genres);
    file.tag.composers = splitList(tags.composers);
    file.tag.beatsPerMinute = tags.bpm && tags.bpm > 0 ? tags.bpm : 0;
    file.tag.grouping = tags.grouping.trim();
    file.tag.publisher = tags.publisher.trim();
    file.tag.comment = tags.comment;
    file.tag.lyrics = tags.lyrics;
    file.tag.musicBrainzTrackId = tags.musicBrainzTrackId.trim();
    file.tag.musicBrainzReleaseId = tags.musicBrainzReleaseId.trim();
    file.tag.musicBrainzArtistId = tags.musicBrainzArtistId.trim();
    file.tag.musicBrainzReleaseArtistId = tags.musicBrainzReleaseArtistId.trim();

    file.save();
  } finally {
    file.dispose();
  }
}

/**
 * Embeds a cover art image directly inside the audio file.
 */
export function writeEmbeddedCover(
  filePath: string,
  bytes: Uint8Array,
  mimeType: string,
): void {
  const file = TagLibFile.createFromPath(filePath);
  try {
    const data = ByteVector.fromByteArray(bytes);
    const picture = Picture.fromData(data);
    picture.mimeType = mimeType;
    picture.type = PictureType.FrontCover;
    picture.description = "Front Cover";
    file.tag.pictures = [picture];
    file.save();
  } finally {
    file.dispose();
  }
}

/**
 * Removes embedded cover art from an audio file.
 */
export function clearEmbeddedCover(filePath: string): void {
  const file = TagLibFile.createFromPath(filePath);
  try {
    file.tag.pictures = [];
    file.save();
  } finally {
    file.dispose();
  }
}
