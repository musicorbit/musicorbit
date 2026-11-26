import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DbContext } from "../db/index.js";
import {
  needsBrowserTranscode,
  type AudioTranscoder,
} from "../services/audioTranscoder.js";
import { verifyPassword } from "../services/authHelpers.js";
import { type LyricsService } from "../services/lyrics.js";
import type { PlaylistSyncService } from "../services/playlistSync.js";
import type { LibraryScanner } from "../services/scanner.js";
import {
  resolveSubsonicFormat,
  sendSubsonicError,
  sendSubsonicOk,
  type SubsonicFormat,
} from "../services/subsonicXml.js";

export interface SubsonicRouteDeps {
  dbContext: DbContext;
  authEnabled: boolean;
  serverVersion: string;
  coversDir: string;
  artistImagesDir: string;
  audioTranscoder?: AudioTranscoder;
  lyricsService?: LyricsService;
  playlistSync?: PlaylistSyncService;
  scanner?: LibraryScanner;
  getUserMusicDir: (userId: number) => string;
}

interface SubsonicUser {
  id: number;
  username: string;
  role: "admin" | "user";
}

interface ParamBag {
  single: Record<string, string>;
  multi: Record<string, string[]>;
}

const AUDIO_MIME_TYPES: Record<string, string> = {
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_FAILS = 30;

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function decodeLegacyPassword(raw: string): string {
  if (raw.startsWith("enc:")) {
    const hex = raw.slice(4);
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      return Buffer.from(hex, "hex").toString("utf8");
    }
  }
  return raw;
}

function extractParams(request: FastifyRequest): ParamBag {
  const single: Record<string, string> = {};
  const multi: Record<string, string[]> = {};

  const pushParam = (k: string, v: string) => {
    single[k] = v;
    const arr = multi[k] ?? [];
    arr.push(v);
    multi[k] = arr;
  };

  // Parse raw URL query string so multi-value params (e.g. songIdToAdd=1&songIdToAdd=2) are preserved
  const qIndex = request.url.indexOf("?");
  if (qIndex >= 0) {
    const qs = new URLSearchParams(request.url.slice(qIndex + 1));
    for (const [k, v] of qs.entries()) {
      pushParam(k, v);
    }
  }

  // OpenSubsonic formPost: merge POST body params (form-urlencoded or JSON)
  if (request.body && typeof request.body === "object") {
    if (request.body instanceof URLSearchParams) {
      for (const [k, v] of request.body.entries()) {
        pushParam(k, v);
      }
    } else {
      for (const [k, v] of Object.entries(request.body as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item !== undefined && item !== null) pushParam(k, String(item));
          }
        } else if (v !== undefined && v !== null) {
          pushParam(k, String(v));
        }
      }
    }
  }

  return { single, multi };
}

function parsePrefixedId(raw: string | undefined, expectedPrefix?: string): { prefix: string | null; id: number } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = /^(?:(ar|al|tr|pl)-)?(\d+)$/.exec(trimmed);
  if (!match) return null;
  const prefix = match[1] ?? null;
  if (expectedPrefix && prefix && prefix !== expectedPrefix) return null;
  const id = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { prefix, id };
}

function parseIntParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toIsoDate(ms: number | null | undefined): string {
  return new Date(ms && ms > 0 ? ms : Date.now()).toISOString();
}

function extFromFilePath(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace(/^\./, "") || "mp3";
}

function contentTypeFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_MIME_TYPES[ext] ?? "application/octet-stream";
}

function parseByteRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  let start: number;
  let end: number;
  if (!rawStart && rawEnd) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(rawStart!, 10);
    end = rawEnd ? Number.parseInt(rawEnd, 10) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    end = Math.min(end, fileSize - 1);
  }
  if (start < 0 || start >= fileSize || end < start) return null;
  return { start, end };
}

function resolveCachedImage(
  dir: string,
  hash: string | null,
): { filePath: string; contentType: string; size: number } | null {
  if (!hash) return null;
  const safeName = path.basename(hash.trim());
  if (!safeName) return null;

  // 1. MusicOrbit stores cover_hash / image_hash with extension (e.g. "017802e2c3f9942b.jpg")
  const directPath = path.join(dir, safeName);
  if (fs.existsSync(directPath)) {
    const stat = fs.statSync(directPath);
    if (stat.isFile()) {
      const ext = path.extname(safeName).toLowerCase();
      return {
        filePath: directPath,
        contentType: IMAGE_MIME_TYPES[ext] ?? "image/jpeg",
        size: stat.size,
      };
    }
  }

  // 2. Fallback: bare hash without extension
  for (const [ext, mime] of Object.entries(IMAGE_MIME_TYPES)) {
    const candidate = path.join(dir, `${safeName}${ext}`);
    if (fs.existsSync(candidate)) {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return { filePath: candidate, contentType: mime, size: stat.size };
      }
    }
  }
  return null;
}

interface TrackJoinRow {
  id: number;
  title: string;
  albumId: number;
  albumTitle: string;
  artistId: number;
  artistName: string;
  year: number | null;
  genre: string | null;
  coverHash: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  durationSeconds: number | null;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  filePath: string;
  fileSize: number;
  createdAt: number;
}

function toSubsonicSong(row: TrackJoinRow, musicDir: string): Record<string, unknown> {
  const relPath = path.relative(musicDir, row.filePath).split(path.sep).join("/");
  const suffix = extFromFilePath(row.filePath);
  return {
    id: `tr-${row.id}`,
    parent: `al-${row.albumId}`,
    isDir: false,
    title: row.title,
    album: row.albumTitle,
    artist: row.artistName,
    track: row.trackNumber ?? undefined,
    discNumber: row.discNumber ?? 1,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    coverArt: row.coverHash ? `al-${row.albumId}` : undefined,
    size: row.fileSize,
    contentType: contentTypeFromFilePath(row.filePath),
    suffix,
    duration: Math.round(row.durationSeconds ?? 0),
    bitRate: row.bitrate ? Math.round(row.bitrate / 1000) : undefined,
    samplingRate: row.sampleRate ?? undefined,
    path: relPath.startsWith("..") ? path.basename(row.filePath) : relPath,
    isVideo: false,
    created: toIsoDate(row.createdAt),
    albumId: `al-${row.albumId}`,
    artistId: `ar-${row.artistId}`,
    type: "music",
    mediaType: "song",
  };
}

interface AlbumJoinRow {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  year: number | null;
  genre: string | null;
  coverHash: string | null;
  createdAt: number;
  songCount: number;
  duration: number;
}

function toSubsonicAlbum(row: AlbumJoinRow): Record<string, unknown> {
  return {
    id: `al-${row.id}`,
    parent: `ar-${row.artistId}`,
    isDir: true,
    name: row.title,
    title: row.title,
    album: row.title,
    artist: row.artistName,
    artistId: `ar-${row.artistId}`,
    coverArt: row.coverHash ? `al-${row.id}` : undefined,
    songCount: row.songCount,
    duration: Math.round(row.duration ?? 0),
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    created: toIsoDate(row.createdAt),
  };
}

function indexBucketLetter(sortName: string): string {
  const first = (sortName.trim()[0] ?? "#").toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

export async function registerSubsonicRoutes(
  app: FastifyInstance,
  deps: SubsonicRouteDeps,
): Promise<void> {
  const {
    dbContext,
    authEnabled,
    serverVersion,
    coversDir,
    artistImagesDir,
    audioTranscoder,
    lyricsService,
    playlistSync,
    scanner,
    getUserMusicDir,
  } = deps;
  const { sqlite } = dbContext;

  const failedAttempts = new Map<string, number[]>();

  const isRateLimited = (ip: string): boolean => {
    const now = Date.now();
    const list = (failedAttempts.get(ip) ?? []).filter((ts) => now - ts < AUTH_FAIL_WINDOW_MS);
    failedAttempts.set(ip, list);
    return list.length >= AUTH_MAX_FAILS;
  };

  const recordAuthFailure = (ip: string) => {
    const now = Date.now();
    const list = (failedAttempts.get(ip) ?? []).filter((ts) => now - ts < AUTH_FAIL_WINDOW_MS);
    list.push(now);
    failedAttempts.set(ip, list);
  };

  const authenticate = (request: FastifyRequest, params: ParamBag): SubsonicUser | null => {
    if (!authEnabled) {
      return { id: 1, username: "local", role: "admin" };
    }

    const ip = request.ip || "unknown";
    if (isRateLimited(ip)) {
      return null;
    }

    const username = params.single["u"]?.trim();
    const token = params.single["t"]?.trim();
    const salt = params.single["s"]?.trim();
    const rawPass = params.single["p"];

    if (!username) {
      recordAuthFailure(ip);
      return null;
    }

    const userRow = sqlite
      .prepare(
        `
        SELECT id, username, role, password_hash AS passwordHash, subsonic_token AS subsonicToken
        FROM users
        WHERE lower(username) = lower(?)
      `,
      )
      .get(username) as
      | {
          id: number;
          username: string;
          role: "admin" | "user";
          passwordHash: string;
          subsonicToken: string | null;
        }
      | undefined;

    if (!userRow) {
      recordAuthFailure(ip);
      return null;
    }

    // 1. Modern Subsonic token auth: t = md5(subsonicAppPassword + salt)
    if (token && salt) {
      if (userRow.subsonicToken) {
        const expected = crypto
          .createHash("md5")
          .update(`${userRow.subsonicToken}${salt}`)
          .digest("hex");
        if (timingSafeStringEqual(token.toLowerCase(), expected)) {
          return { id: userRow.id, username: userRow.username, role: userRow.role };
        }
      }
      recordAuthFailure(ip);
      return null;
    }

    // 2. Legacy password auth (p=<pw> or p=enc:<hex>): accepts either Subsonic App Password or main scrypt login password
    if (rawPass !== undefined && rawPass.length > 0) {
      const decoded = decodeLegacyPassword(rawPass);
      if (userRow.subsonicToken && timingSafeStringEqual(decoded, userRow.subsonicToken)) {
        return { id: userRow.id, username: userRow.username, role: userRow.role };
      }
      if (verifyPassword(decoded, userRow.passwordHash)) {
        return { id: userRow.id, username: userRow.username, role: userRow.role };
      }
    }

    recordAuthFailure(ip);
    return null;
  };

  const TRACK_SELECT = `
    SELECT
      t.id,
      t.title,
      t.album_id AS albumId,
      al.title AS albumTitle,
      t.artist_id AS artistId,
      ar.name AS artistName,
      al.year,
      al.genre,
      al.cover_hash AS coverHash,
      t.track_number AS trackNumber,
      t.disc_number AS discNumber,
      t.duration_seconds AS durationSeconds,
      t.codec,
      t.bitrate,
      t.sample_rate AS sampleRate,
      t.file_path AS filePath,
      t.file_size AS fileSize,
      t.created_at AS createdAt
    FROM tracks t
    JOIN albums al ON al.id = t.album_id
    JOIN artists ar ON ar.id = t.artist_id
  `;

  const ALBUM_SELECT = `
    SELECT
      al.id,
      al.title,
      al.artist_id AS artistId,
      ar.name AS artistName,
      al.year,
      al.genre,
      al.cover_hash AS coverHash,
      al.created_at AS createdAt,
      COUNT(t.id) AS songCount,
      COALESCE(SUM(t.duration_seconds), 0) AS duration
    FROM albums al
    JOIN artists ar ON ar.id = al.artist_id
    LEFT JOIN tracks t ON t.album_id = al.id AND t.user_id = al.user_id
  `;

  await app.register(async (subsonicApp) => {
    // Support OpenSubsonic formPost (application/x-www-form-urlencoded) without external plugins
    subsonicApp.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          done(null, new URLSearchParams(typeof body === "string" ? body : ""));
        } catch (err) {
          done(err as Error);
        }
      },
    );

    const handleSubsonic = async (request: FastifyRequest, reply: FastifyReply) => {
      const rawEndpoint = ((request.params as { endpoint?: string }).endpoint ?? "")
        .replace(/\.view$/i, "")
        .trim();
      const params = extractParams(request);
      const format: SubsonicFormat = resolveSubsonicFormat(params.single["f"]);
      const callback = params.single["callback"];

      const ok = (payload: Record<string, unknown> = {}) =>
        sendSubsonicOk(reply, format, serverVersion, payload, callback);
      const fail = (code: number, message: string) =>
        sendSubsonicError(reply, format, serverVersion, code, message, callback);

      const user = authenticate(request, params);
      if (!user) {
        return fail(
          40,
          "Wrong username or password. For token auth, generate a Subsonic App Password in MusicOrbit Account settings.",
        );
      }

      const musicDir = getUserMusicDir(user.id);

      switch (rawEndpoint) {
        case "ping": {
          return ok();
        }

        case "getLicense": {
          return ok({
            license: {
              valid: true,
              email: "selfhosted@musicorbit.app",
              licenseExpires: "2099-12-31T23:59:59.000Z",
            },
          });
        }

        case "getOpenSubsonicExtensions": {
          return ok({
            openSubsonicExtensions: [
              { name: "formPost", versions: [1] },
              { name: "songLyrics", versions: [1] },
            ],
          });
        }

        case "getUser": {
          return ok({
            user: {
              username: user.username,
              email: `${user.username}@local`,
              scrobblingEnabled: false,
              adminRole: user.role === "admin",
              settingsRole: user.role === "admin",
              downloadRole: true,
              uploadRole: false,
              playlistRole: true,
              coverArtRole: true,
              commentRole: false,
              podcastRole: false,
              streamRole: true,
              jukeboxRole: false,
              shareRole: false,
              videoConversionRole: false,
              folder: [1],
            },
          });
        }

        case "getMusicFolders": {
          return ok({
            musicFolders: {
              musicFolder: [{ id: 1, name: "MusicOrbit Library" }],
            },
          });
        }

        case "getScanStatus": {
          const st = scanner?.getStatus(user.id);
          const countRow = sqlite
            .prepare("SELECT COUNT(*) AS c FROM tracks WHERE user_id = ?")
            .get(user.id) as { c: number };
          return ok({
            scanStatus: {
              scanning: st?.state === "running",
              count: countRow.c,
            },
          });
        }

        case "startScan": {
          if (scanner) {
            scanner.startScan({ force: false, userId: user.id });
          }
          const countRow = sqlite
            .prepare("SELECT COUNT(*) AS c FROM tracks WHERE user_id = ?")
            .get(user.id) as { c: number };
          return ok({
            scanStatus: {
              scanning: true,
              count: countRow.c,
            },
          });
        }

        case "getArtists":
        case "getIndexes": {
          const rows = sqlite
            .prepare(
              `
              SELECT
                ar.id,
                ar.name,
                ar.sort_name AS sortName,
                ar.image_hash AS imageHash,
                COUNT(DISTINCT al.id) AS albumCount
              FROM artists ar
              LEFT JOIN albums al ON al.artist_id = ar.id AND al.user_id = ar.user_id
              WHERE ar.user_id = ?
              GROUP BY ar.id
              ORDER BY lower(ar.sort_name) ASC
            `,
            )
            .all(user.id) as Array<{
            id: number;
            name: string;
            sortName: string;
            imageHash: string | null;
            albumCount: number;
          }>;

          const buckets = new Map<string, Array<Record<string, unknown>>>();
          for (const row of rows) {
            const letter = indexBucketLetter(row.sortName || row.name);
            const list = buckets.get(letter) ?? [];
            list.push({
              id: `ar-${row.id}`,
              name: row.name,
              albumCount: row.albumCount,
              coverArt: row.imageHash ? `ar-${row.id}` : undefined,
            });
            buckets.set(letter, list);
          }

          const index = Array.from(buckets.entries())
            .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
            .map(([name, artist]) => ({ name, artist }));

          if (rawEndpoint === "getIndexes") {
            return ok({
              indexes: {
                lastModified: Date.now(),
                ignoredArticles: "The El La Los Las Le Les",
                index,
              },
            });
          }
          return ok({
            artists: {
              ignoredArticles: "The El La Los Las Le Les",
              index,
            },
          });
        }

        case "getArtist": {
          const parsed = parsePrefixedId(params.single["id"], "ar");
          if (!parsed) return fail(10, "Missing or invalid artist id");

          const artist = sqlite
            .prepare(
              `
              SELECT id, name, image_hash AS imageHash
              FROM artists
              WHERE id = ? AND user_id = ?
            `,
            )
            .get(parsed.id, user.id) as
            | { id: number; name: string; imageHash: string | null }
            | undefined;
          if (!artist) return fail(70, "Artist not found");

          const albums = sqlite
            .prepare(
              `${ALBUM_SELECT} WHERE al.artist_id = ? AND al.user_id = ? GROUP BY al.id ORDER BY al.year DESC, lower(al.title) ASC`,
            )
            .all(artist.id, user.id) as AlbumJoinRow[];

          return ok({
            artist: {
              id: `ar-${artist.id}`,
              name: artist.name,
              coverArt: artist.imageHash ? `ar-${artist.id}` : undefined,
              albumCount: albums.length,
              album: albums.map(toSubsonicAlbum),
            },
          });
        }

        case "getArtistInfo":
        case "getArtistInfo2": {
          const parsed = parsePrefixedId(params.single["id"], "ar");
          if (!parsed) return fail(10, "Missing or invalid artist id");
          const artist = sqlite
            .prepare("SELECT id, name, mbid, image_hash AS imageHash FROM artists WHERE id = ? AND user_id = ?")
            .get(parsed.id, user.id) as
            | { id: number; name: string; mbid: string | null; imageHash: string | null }
            | undefined;
          if (!artist) return fail(70, "Artist not found");

          const key = rawEndpoint === "getArtistInfo2" ? "artistInfo2" : "artistInfo";
          return ok({
            [key]: {
              musicBrainzId: artist.mbid ?? undefined,
              smallImageUrl: artist.imageHash ? `/rest/getCoverArt?id=ar-${artist.id}` : undefined,
              mediumImageUrl: artist.imageHash ? `/rest/getCoverArt?id=ar-${artist.id}` : undefined,
              largeImageUrl: artist.imageHash ? `/rest/getCoverArt?id=ar-${artist.id}` : undefined,
              similarArtist: [],
            },
          });
        }

        case "getMusicDirectory": {
          const parsed = parsePrefixedId(params.single["id"]);
          if (!parsed) return fail(10, "Missing or invalid directory id");

          if (parsed.prefix === "ar") {
            const artist = sqlite
              .prepare("SELECT id, name FROM artists WHERE id = ? AND user_id = ?")
              .get(parsed.id, user.id) as { id: number; name: string } | undefined;
            if (!artist) return fail(70, "Directory not found");
            const albums = sqlite
              .prepare(
                `${ALBUM_SELECT} WHERE al.artist_id = ? AND al.user_id = ? GROUP BY al.id ORDER BY al.year DESC, lower(al.title) ASC`,
              )
              .all(artist.id, user.id) as AlbumJoinRow[];
            return ok({
              directory: {
                id: `ar-${artist.id}`,
                name: artist.name,
                child: albums.map(toSubsonicAlbum),
              },
            });
          }

          const album = sqlite
            .prepare("SELECT id, title, artist_id AS artistId FROM albums WHERE id = ? AND user_id = ?")
            .get(parsed.id, user.id) as { id: number; title: string; artistId: number } | undefined;
          if (!album) return fail(70, "Directory not found");

          const tracks = sqlite
            .prepare(
              `${TRACK_SELECT} WHERE t.album_id = ? AND t.user_id = ? ORDER BY COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, lower(t.title) ASC`,
            )
            .all(album.id, user.id) as TrackJoinRow[];

          return ok({
            directory: {
              id: `al-${album.id}`,
              parent: `ar-${album.artistId}`,
              name: album.title,
              child: tracks.map((t) => toSubsonicSong(t, musicDir)),
            },
          });
        }

        case "getAlbumList":
        case "getAlbumList2": {
          const type = (params.single["type"] ?? "alphabeticalByName").trim();
          const size = parseIntParam(params.single["size"], 50, 1, 500);
          const offset = parseIntParam(params.single["offset"], 0, 0, 100_000);
          const fromYear = params.single["fromYear"] ? Number.parseInt(params.single["fromYear"], 10) : null;
          const toYear = params.single["toYear"] ? Number.parseInt(params.single["toYear"], 10) : null;
          const genre = params.single["genre"]?.trim();

          const where: string[] = ["al.user_id = ?"];
          const args: unknown[] = [user.id];
          let orderBy = "lower(al.title) ASC";

          if (type === "alphabeticalByArtist") {
            orderBy = "lower(ar.sort_name) ASC, lower(al.title) ASC";
          } else if (type === "newest" || type === "recent" || type === "frequent") {
            orderBy = "al.created_at DESC, al.id DESC";
          } else if (type === "random") {
            orderBy = "RANDOM()";
          } else if (type === "byYear") {
            if (fromYear !== null && toYear !== null && Number.isFinite(fromYear) && Number.isFinite(toYear)) {
              const lo = Math.min(fromYear, toYear);
              const hi = Math.max(fromYear, toYear);
              where.push("al.year >= ? AND al.year <= ?");
              args.push(lo, hi);
              orderBy = fromYear <= toYear ? "al.year ASC, lower(al.title) ASC" : "al.year DESC, lower(al.title) ASC";
            } else {
              orderBy = "al.year DESC, lower(al.title) ASC";
            }
          } else if (type === "byGenre" && genre) {
            where.push("lower(al.genre) = lower(?)");
            args.push(genre);
          } else if (type === "starred") {
            const key = rawEndpoint === "getAlbumList2" ? "albumList2" : "albumList";
            return ok({ [key]: { album: [] } });
          }

          const rows = sqlite
            .prepare(
              `${ALBUM_SELECT} WHERE ${where.join(" AND ")} GROUP BY al.id ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
            )
            .all(...args, size, offset) as AlbumJoinRow[];

          const key = rawEndpoint === "getAlbumList2" ? "albumList2" : "albumList";
          return ok({
            [key]: {
              album: rows.map(toSubsonicAlbum),
            },
          });
        }

        case "getAlbum": {
          const parsed = parsePrefixedId(params.single["id"], "al");
          if (!parsed) return fail(10, "Missing or invalid album id");

          const album = sqlite
            .prepare(`${ALBUM_SELECT} WHERE al.id = ? AND al.user_id = ? GROUP BY al.id`)
            .get(parsed.id, user.id) as AlbumJoinRow | undefined;
          if (!album) return fail(70, "Album not found");

          const tracks = sqlite
            .prepare(
              `${TRACK_SELECT} WHERE t.album_id = ? AND t.user_id = ? ORDER BY COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, lower(t.title) ASC`,
            )
            .all(album.id, user.id) as TrackJoinRow[];

          return ok({
            album: {
              ...toSubsonicAlbum(album),
              song: tracks.map((t) => toSubsonicSong(t, musicDir)),
            },
          });
        }

        case "getSong": {
          const parsed = parsePrefixedId(params.single["id"], "tr");
          if (!parsed) return fail(10, "Missing or invalid song id");

          const track = sqlite
            .prepare(`${TRACK_SELECT} WHERE t.id = ? AND t.user_id = ?`)
            .get(parsed.id, user.id) as TrackJoinRow | undefined;
          if (!track) return fail(70, "Song not found");

          return ok({ song: toSubsonicSong(track, musicDir) });
        }

        case "getGenres": {
          const rows = sqlite
            .prepare(
              `
              SELECT
                al.genre AS value,
                COUNT(DISTINCT al.id) AS albumCount,
                COUNT(t.id) AS songCount
              FROM albums al
              LEFT JOIN tracks t ON t.album_id = al.id AND t.user_id = al.user_id
              WHERE al.user_id = ? AND al.genre IS NOT NULL AND trim(al.genre) != ''
              GROUP BY lower(al.genre)
              ORDER BY lower(al.genre) ASC
            `,
            )
            .all(user.id) as Array<{ value: string; albumCount: number; songCount: number }>;

          return ok({
            genres: {
              genre: rows,
            },
          });
        }

        case "getRandomSongs": {
          const size = parseIntParam(params.single["size"], 20, 1, 500);
          const genre = params.single["genre"]?.trim();
          const fromYear = params.single["fromYear"] ? Number.parseInt(params.single["fromYear"], 10) : null;
          const toYear = params.single["toYear"] ? Number.parseInt(params.single["toYear"], 10) : null;

          const where: string[] = ["t.user_id = ?"];
          const args: unknown[] = [user.id];
          if (genre) {
            where.push("lower(al.genre) = lower(?)");
            args.push(genre);
          }
          if (fromYear !== null && Number.isFinite(fromYear)) {
            where.push("al.year >= ?");
            args.push(fromYear);
          }
          if (toYear !== null && Number.isFinite(toYear)) {
            where.push("al.year <= ?");
            args.push(toYear);
          }

          const rows = sqlite
            .prepare(`${TRACK_SELECT} WHERE ${where.join(" AND ")} ORDER BY RANDOM() LIMIT ?`)
            .all(...args, size) as TrackJoinRow[];

          return ok({
            randomSongs: {
              song: rows.map((t) => toSubsonicSong(t, musicDir)),
            },
          });
        }

        case "getSongsByGenre": {
          const genre = params.single["genre"]?.trim();
          if (!genre) return fail(10, "Missing genre parameter");
          const count = parseIntParam(params.single["count"], 50, 1, 500);
          const offset = parseIntParam(params.single["offset"], 0, 0, 100_000);

          const rows = sqlite
            .prepare(
              `${TRACK_SELECT} WHERE t.user_id = ? AND lower(al.genre) = lower(?) ORDER BY lower(ar.sort_name) ASC, lower(al.title) ASC, COALESCE(t.track_number, 9999) ASC LIMIT ? OFFSET ?`,
            )
            .all(user.id, genre, count, offset) as TrackJoinRow[];

          return ok({
            songsByGenre: {
              song: rows.map((t) => toSubsonicSong(t, musicDir)),
            },
          });
        }

        case "getTopSongs": {
          const artistName = params.single["artist"]?.trim();
          const count = parseIntParam(params.single["count"], 50, 1, 200);
          if (!artistName) return ok({ topSongs: { song: [] } });

          const rows = sqlite
            .prepare(
              `${TRACK_SELECT} WHERE t.user_id = ? AND lower(ar.name) = lower(?) ORDER BY al.year DESC, COALESCE(t.track_number, 9999) ASC LIMIT ?`,
            )
            .all(user.id, artistName, count) as TrackJoinRow[];

          return ok({
            topSongs: {
              song: rows.map((t) => toSubsonicSong(t, musicDir)),
            },
          });
        }

        case "getStarred":
        case "getStarred2": {
          const key = rawEndpoint === "getStarred2" ? "starred2" : "starred";
          return ok({ [key]: { artist: [], album: [], song: [] } });
        }

        case "search2":
        case "search3": {
          // Symfonium & other OpenSubsonic clients sync full libraries by passing query="" or empty string!
          const rawQuery = (params.single["query"] ?? "").trim();
          const normalized = rawQuery === '""' || rawQuery === "''" || rawQuery === "*" ? "" : rawQuery;
          const artistCount = parseIntParam(params.single["artistCount"], 20, 0, 500);
          const artistOffset = parseIntParam(params.single["artistOffset"], 0, 0, 100_000);
          const albumCount = parseIntParam(params.single["albumCount"], 20, 0, 500);
          const albumOffset = parseIntParam(params.single["albumOffset"], 0, 0, 100_000);
          const songCount = parseIntParam(params.single["songCount"], 20, 0, 500);
          const songOffset = parseIntParam(params.single["songOffset"], 0, 0, 100_000);

          const like = `%${normalized}%`;

          const artists =
            artistCount > 0
              ? (sqlite
                  .prepare(
                    `
                    SELECT
                      ar.id,
                      ar.name,
                      ar.image_hash AS imageHash,
                      COUNT(DISTINCT al.id) AS albumCount
                    FROM artists ar
                    LEFT JOIN albums al ON al.artist_id = ar.id AND al.user_id = ar.user_id
                    WHERE ar.user_id = ? ${normalized ? "AND lower(ar.name) LIKE lower(?)" : ""}
                    GROUP BY ar.id
                    ORDER BY lower(ar.sort_name) ASC
                    LIMIT ? OFFSET ?
                  `,
                  )
                  .all(...(normalized ? [user.id, like, artistCount, artistOffset] : [user.id, artistCount, artistOffset])) as Array<{
                  id: number;
                  name: string;
                  imageHash: string | null;
                  albumCount: number;
                }>).map((a) => ({
                  id: `ar-${a.id}`,
                  name: a.name,
                  albumCount: a.albumCount,
                  coverArt: a.imageHash ? `ar-${a.id}` : undefined,
                }))
              : [];

          const albums =
            albumCount > 0
              ? (sqlite
                  .prepare(
                    `
                    ${ALBUM_SELECT}
                    WHERE al.user_id = ? ${normalized ? "AND (lower(al.title) LIKE lower(?) OR lower(ar.name) LIKE lower(?))" : ""}
                    GROUP BY al.id
                    ORDER BY lower(al.title) ASC
                    LIMIT ? OFFSET ?
                  `,
                  )
                  .all(
                    ...(normalized
                      ? [user.id, like, like, albumCount, albumOffset]
                      : [user.id, albumCount, albumOffset]),
                  ) as AlbumJoinRow[]
                ).map(toSubsonicAlbum)
              : [];

          const songs =
            songCount > 0
              ? (sqlite
                  .prepare(
                    `
                    ${TRACK_SELECT}
                    WHERE t.user_id = ? ${normalized ? "AND (lower(t.title) LIKE lower(?) OR lower(al.title) LIKE lower(?) OR lower(ar.name) LIKE lower(?))" : ""}
                    ORDER BY lower(t.title) ASC, t.id ASC
                    LIMIT ? OFFSET ?
                  `,
                  )
                  .all(
                    ...(normalized
                      ? [user.id, like, like, like, songCount, songOffset]
                      : [user.id, songCount, songOffset]),
                  ) as TrackJoinRow[]
                ).map((t) => toSubsonicSong(t, musicDir))
              : [];

          const key = rawEndpoint === "search3" ? "searchResult3" : "searchResult2";
          return ok({
            [key]: {
              artist: artists,
              album: albums,
              song: songs,
            },
          });
        }

        case "getPlaylists": {
          const rows = sqlite
            .prepare(
              `
              SELECT
                p.id,
                p.name,
                p.description,
                p.cover_hash AS coverHash,
                p.created_at AS createdAt,
                p.updated_at AS updatedAt,
                COUNT(pt.track_id) AS songCount,
                COALESCE(SUM(t.duration_seconds), 0) AS duration
              FROM playlists p
              LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
              LEFT JOIN tracks t ON t.id = pt.track_id AND t.user_id = p.user_id
              WHERE p.user_id = ?
              GROUP BY p.id
              ORDER BY lower(p.name) ASC
            `,
            )
            .all(user.id) as Array<{
            id: number;
            name: string;
            description: string | null;
            coverHash: string | null;
            createdAt: number;
            updatedAt: number;
            songCount: number;
            duration: number;
          }>;

          return ok({
            playlists: {
              playlist: rows.map((p) => ({
                id: `pl-${p.id}`,
                name: p.name,
                comment: p.description ?? undefined,
                owner: user.username,
                public: false,
                songCount: p.songCount,
                duration: Math.round(p.duration ?? 0),
                created: toIsoDate(p.createdAt),
                changed: toIsoDate(p.updatedAt),
                coverArt: `pl-${p.id}`,
              })),
            },
          });
        }

        case "getPlaylist": {
          const parsed = parsePrefixedId(params.single["id"], "pl");
          if (!parsed) return fail(10, "Missing or invalid playlist id");

          const pl = sqlite
            .prepare(
              `
              SELECT id, name, description, cover_hash AS coverHash, created_at AS createdAt, updated_at AS updatedAt
              FROM playlists
              WHERE id = ? AND user_id = ?
            `,
            )
            .get(parsed.id, user.id) as
            | {
                id: number;
                name: string;
                description: string | null;
                coverHash: string | null;
                createdAt: number;
                updatedAt: number;
              }
            | undefined;
          if (!pl) return fail(70, "Playlist not found");

          const entries = sqlite
            .prepare(
              `
              ${TRACK_SELECT}
              JOIN playlist_tracks pt ON pt.track_id = t.id
              WHERE pt.playlist_id = ? AND t.user_id = ?
              ORDER BY pt.position ASC
            `,
            )
            .all(pl.id, user.id) as TrackJoinRow[];

          const totalDuration = entries.reduce((sum, r) => sum + (r.durationSeconds ?? 0), 0);

          return ok({
            playlist: {
              id: `pl-${pl.id}`,
              name: pl.name,
              comment: pl.description ?? undefined,
              owner: user.username,
              public: false,
              songCount: entries.length,
              duration: Math.round(totalDuration),
              created: toIsoDate(pl.createdAt),
              changed: toIsoDate(pl.updatedAt),
              coverArt: `pl-${pl.id}`,
              entry: entries.map((t) => toSubsonicSong(t, musicDir)),
            },
          });
        }

        case "createPlaylist": {
          const existingId = parsePrefixedId(params.single["playlistId"], "pl");
          const name = params.single["name"]?.trim();
          const songIds = (params.multi["songId"] ?? [])
            .map((raw) => parsePrefixedId(raw, "tr")?.id)
            .filter((id): id is number => typeof id === "number");

          const now = Date.now();
          let playlistId: number;

          if (existingId) {
            const exists = sqlite
              .prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?")
              .get(existingId.id, user.id) as { id: number } | undefined;
            if (!exists) return fail(70, "Playlist not found");
            playlistId = exists.id;
            const tx = sqlite.transaction(() => {
              if (name) {
                sqlite
                  .prepare("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?")
                  .run(name, now, playlistId);
              } else {
                sqlite.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, playlistId);
              }
              sqlite.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
              let pos = 0;
              for (const tid of songIds) {
                const owned = sqlite
                  .prepare("SELECT id FROM tracks WHERE id = ? AND user_id = ?")
                  .get(tid, user.id);
                if (owned) {
                  sqlite
                    .prepare(
                      "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
                    )
                    .run(playlistId, tid, pos++, now);
                }
              }
            });
            tx();
          } else {
            if (!name) return fail(10, "Playlist name is required");
            const tx = sqlite.transaction(() => {
              const ins = sqlite
                .prepare(
                  "INSERT INTO playlists (user_id, name, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
                )
                .run(user.id, name, now, now);
              const newId = Number(ins.lastInsertRowid);
              let pos = 0;
              for (const tid of songIds) {
                const owned = sqlite
                  .prepare("SELECT id FROM tracks WHERE id = ? AND user_id = ?")
                  .get(tid, user.id);
                if (owned) {
                  sqlite
                    .prepare(
                      "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
                    )
                    .run(newId, tid, pos++, now);
                }
              }
              return newId;
            });
            playlistId = tx();
          }

          playlistSync?.syncPlaylist(playlistId);
          const created = sqlite
            .prepare("SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM playlists WHERE id = ?")
            .get(playlistId) as {
            id: number;
            name: string;
            description: string | null;
            createdAt: number;
            updatedAt: number;
          };

          const entries = sqlite
            .prepare(
              `${TRACK_SELECT} JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ? AND t.user_id = ? ORDER BY pt.position ASC`,
            )
            .all(playlistId, user.id) as TrackJoinRow[];

          return ok({
            playlist: {
              id: `pl-${created.id}`,
              name: created.name,
              owner: user.username,
              public: false,
              songCount: entries.length,
              duration: Math.round(entries.reduce((s, t) => s + (t.durationSeconds ?? 0), 0)),
              created: toIsoDate(created.createdAt),
              changed: toIsoDate(created.updatedAt),
              coverArt: `pl-${created.id}`,
              entry: entries.map((t) => toSubsonicSong(t, musicDir)),
            },
          });
        }

        case "updatePlaylist": {
          const parsed = parsePrefixedId(params.single["playlistId"], "pl");
          if (!parsed) return fail(10, "Missing or invalid playlistId");

          const pl = sqlite
            .prepare("SELECT id, name, description FROM playlists WHERE id = ? AND user_id = ?")
            .get(parsed.id, user.id) as
            | { id: number; name: string; description: string | null }
            | undefined;
          if (!pl) return fail(70, "Playlist not found");

          const newName = params.single["name"]?.trim();
          const newComment = params.single["comment"];
          const toAdd = (params.multi["songIdToAdd"] ?? [])
            .map((raw) => parsePrefixedId(raw, "tr")?.id)
            .filter((id): id is number => typeof id === "number");
          const toRemoveIdx = new Set(
            (params.multi["songIndexToRemove"] ?? [])
              .map((raw) => Number.parseInt(raw, 10))
              .filter((n) => Number.isFinite(n) && n >= 0),
          );

          const now = Date.now();
          const tx = sqlite.transaction(() => {
            if (newName || newComment !== undefined) {
              sqlite
                .prepare("UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ?")
                .run(newName || pl.name, newComment !== undefined ? newComment : pl.description, now, pl.id);
            } else {
              sqlite.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, pl.id);
            }

            if (toRemoveIdx.size > 0 || toAdd.length > 0) {
              const currentRows = sqlite
                .prepare(
                  "SELECT track_id AS trackId FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC",
                )
                .all(pl.id) as Array<{ trackId: number }>;

              const remaining = currentRows
                .filter((_row, idx) => !toRemoveIdx.has(idx))
                .map((r) => r.trackId);

              for (const tid of toAdd) {
                const owned = sqlite
                  .prepare("SELECT id FROM tracks WHERE id = ? AND user_id = ?")
                  .get(tid, user.id);
                if (owned) remaining.push(tid);
              }

              sqlite.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(pl.id);
              remaining.forEach((tid, pos) => {
                sqlite
                  .prepare(
                    "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
                  )
                  .run(pl.id, tid, pos, now);
              });
            }
          });
          tx();

          playlistSync?.syncPlaylist(pl.id);
          return ok();
        }

        case "deletePlaylist": {
          const parsed = parsePrefixedId(params.single["id"], "pl");
          if (!parsed) return fail(10, "Missing or invalid playlist id");
          const existing = sqlite
            .prepare(
              "SELECT id, name, synced_filename AS syncedFilename FROM playlists WHERE id = ? AND user_id = ?",
            )
            .get(parsed.id, user.id) as
            | { id: number; name: string; syncedFilename: string | null }
            | undefined;
          if (!existing) return fail(70, "Playlist not found");

          sqlite.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(existing.id, user.id);
          if (existing.syncedFilename) {
            await playlistSync?.deleteSyncedPlaylist(existing.syncedFilename, existing.name, user.id);
          }
          return ok();
        }

        case "stream":
        case "download": {
          const parsed = parsePrefixedId(params.single["id"], "tr");
          if (!parsed) return fail(10, "Missing or invalid song id");

          const track = sqlite
            .prepare(
              "SELECT id, file_path AS filePath, codec, title FROM tracks WHERE id = ? AND user_id = ?",
            )
            .get(parsed.id, user.id) as
            | { id: number; filePath: string; codec: string | null; title: string }
            | undefined;
          if (!track || !fs.existsSync(track.filePath)) {
            return fail(70, "Song not found");
          }

          let streamPath = track.filePath;
          let contentType = contentTypeFromFilePath(track.filePath);

          const isRaw = rawEndpoint === "download" || params.single["format"]?.toLowerCase() === "raw";
          if (!isRaw && audioTranscoder && needsBrowserTranscode(track.codec, track.filePath)) {
            try {
              streamPath = await audioTranscoder.ensureBrowserPlayableFlac(track.filePath);
              contentType = contentTypeFromFilePath(streamPath);
            } catch {
              // Fall back to original file if transcoder unavailable
            }
          }

          const stat = await fsp.stat(streamPath);
          const fileSize = stat.size;
          const rangeHeader = request.headers.range;

          if (rawEndpoint === "download") {
            const safeFilename = path.basename(streamPath).replace(/["\r\n]/g, "_");
            reply.header("Content-Disposition", `attachment; filename="${safeFilename}"`);
          }

          if (!rangeHeader) {
            reply
              .code(200)
              .header("Content-Type", contentType)
              .header("Content-Length", fileSize)
              .header("Accept-Ranges", "bytes");
            return reply.send(fs.createReadStream(streamPath));
          }

          const range = parseByteRange(rangeHeader, fileSize);
          if (!range) {
            return reply
              .code(416)
              .header("Content-Range", `bytes */${fileSize}`)
              .send({ error: "Requested range not satisfiable" });
          }

          const chunkSize = range.end - range.start + 1;
          reply
            .code(206)
            .header("Content-Type", contentType)
            .header("Content-Length", chunkSize)
            .header("Content-Range", `bytes ${range.start}-${range.end}/${fileSize}`)
            .header("Accept-Ranges", "bytes");
          return reply.send(fs.createReadStream(streamPath, { start: range.start, end: range.end }));
        }

        case "getCoverArt": {
          const parsed = parsePrefixedId(params.single["id"]);
          if (!parsed) return reply.code(404).send("Cover art not found");

          let resolved: { filePath: string; contentType: string; size: number } | null = null;

          if (parsed.prefix === "ar") {
            const row = sqlite
              .prepare("SELECT image_hash AS imageHash FROM artists WHERE id = ? AND user_id = ?")
              .get(parsed.id, user.id) as { imageHash: string | null } | undefined;
            resolved = resolveCachedImage(artistImagesDir, row?.imageHash ?? null);
          } else if (parsed.prefix === "pl") {
            const row = sqlite
              .prepare("SELECT cover_hash AS coverHash FROM playlists WHERE id = ? AND user_id = ?")
              .get(parsed.id, user.id) as { coverHash: string | null } | undefined;
            resolved = resolveCachedImage(coversDir, row?.coverHash ?? null);
            if (!resolved) {
              // Fallback to first track's album cover in playlist
              const firstCover = sqlite
                .prepare(
                  `
                  SELECT al.cover_hash AS coverHash
                  FROM playlist_tracks pt
                  JOIN tracks t ON t.id = pt.track_id
                  JOIN albums al ON al.id = t.album_id
                  WHERE pt.playlist_id = ? AND t.user_id = ? AND al.cover_hash IS NOT NULL
                  ORDER BY pt.position ASC
                  LIMIT 1
                `,
                )
                .get(parsed.id, user.id) as { coverHash: string | null } | undefined;
              resolved = resolveCachedImage(coversDir, firstCover?.coverHash ?? null);
            }
          } else if (parsed.prefix === "tr") {
            const row = sqlite
              .prepare(
                `
                SELECT al.cover_hash AS coverHash
                FROM tracks t
                JOIN albums al ON al.id = t.album_id
                WHERE t.id = ? AND t.user_id = ?
              `,
              )
              .get(parsed.id, user.id) as { coverHash: string | null } | undefined;
            resolved = resolveCachedImage(coversDir, row?.coverHash ?? null);
          } else {
            // al-<id> or bare numeric album id
            const row = sqlite
              .prepare("SELECT cover_hash AS coverHash FROM albums WHERE id = ? AND user_id = ?")
              .get(parsed.id, user.id) as { coverHash: string | null } | undefined;
            resolved = resolveCachedImage(coversDir, row?.coverHash ?? null);
          }

          if (!resolved) {
            return reply.code(404).send("Cover art not found");
          }

          return reply
            .code(200)
            .header("Content-Type", resolved.contentType)
            .header("Content-Length", resolved.size)
            .header("Cache-Control", "public, max-age=86400")
            .send(fs.createReadStream(resolved.filePath));
        }

        case "getLyricsBySongId": {
          const parsed = parsePrefixedId(params.single["id"], "tr");
          if (!parsed) return fail(10, "Missing or invalid song id");

          const track = sqlite
            .prepare(
              `
              SELECT t.id, t.title, ar.name AS artistName
              FROM tracks t
              JOIN artists ar ON ar.id = t.artist_id
              WHERE t.id = ? AND t.user_id = ?
            `,
            )
            .get(parsed.id, user.id) as { id: number; title: string; artistName: string } | undefined;
          if (!track) return fail(70, "Song not found");

          if (!lyricsService) {
            return ok({ lyricsList: { structuredLyrics: [] } });
          }

          const res = await lyricsService.getTrackLyrics(track.id, { userId: user.id });
          if (res?.hasSynced && res.syncedLines.length > 0) {
            return ok({
              lyricsList: {
                structuredLyrics: [
                  {
                    displayArtist: track.artistName,
                    displayTitle: track.title,
                    lang: "und",
                    synced: true,
                    line: res.syncedLines.map((l) => ({
                      start: Math.max(0, Math.round(l.timeSeconds * 1000)),
                      value: l.text,
                    })),
                  },
                ],
              },
            });
          }

          if (res?.plainLyrics) {
            const plainLines = res.plainLyrics.split(/\r?\n/).map((line) => ({ value: line }));
            return ok({
              lyricsList: {
                structuredLyrics: [
                  {
                    displayArtist: track.artistName,
                    displayTitle: track.title,
                    lang: "und",
                    synced: false,
                    line: plainLines,
                  },
                ],
              },
            });
          }

          return ok({ lyricsList: { structuredLyrics: [] } });
        }

        case "getLyrics": {
          const artist = params.single["artist"]?.trim();
          const title = params.single["title"]?.trim();
          if (!title) return ok({ lyrics: {} });

          const row = sqlite
            .prepare(
              `
              SELECT t.id, t.title, ar.name AS artistName
              FROM tracks t
              JOIN artists ar ON ar.id = t.artist_id
              WHERE t.user_id = ? AND lower(t.title) = lower(?) ${artist ? "AND lower(ar.name) = lower(?)" : ""}
              LIMIT 1
            `,
            )
            .get(...(artist ? [user.id, title, artist] : [user.id, title])) as
            | { id: number; title: string; artistName: string }
            | undefined;

          if (!row || !lyricsService) {
            return ok({ lyrics: { artist, title } });
          }

          const res = await lyricsService.getTrackLyrics(row.id, { userId: user.id });
          const text =
            res?.plainLyrics ??
            (res?.syncedLines && res.syncedLines.length > 0
              ? res.syncedLines.map((l) => l.text).join("\n")
              : undefined);
          return ok({
            lyrics: {
              artist: row.artistName,
              title: row.title,
              value: text,
            },
          });
        }

        case "scrobble":
        case "setRating":
        case "star":
        case "unstar": {
          // Graceful no-op acknowledgments so mobile Subsonic clients report playback cleanly
          return ok();
        }

        default: {
          return fail(0, `Unsupported Subsonic endpoint: ${rawEndpoint}`);
        }
      }
    };

    subsonicApp.get("/rest/:endpoint", handleSubsonic);
    subsonicApp.post("/rest/:endpoint", handleSubsonic);
  });
}
