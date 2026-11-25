import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Core SQLite schema for MusicOrbit.
 */

export const artists = sqliteTable("artists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sortName: text("sort_name").notNull(),
  imageHash: text("image_hash"), // Cached portrait filename in DATA_DIR/artist-images
  imageCheckedAt: integer("image_checked_at", { mode: "timestamp_ms" }),
  mbid: text("mbid"), // MusicBrainz Artist ID
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const albums = sqliteTable(
  "albums",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    year: integer("year"),
    genre: text("genre"),
    coverHash: text("cover_hash"), // Cached filename in DATA_DIR/covers
    mbid: text("mbid"), // MusicBrainz Release ID
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("idx_albums_artist_title").on(table.artistId, table.title)],
);

export const tracks = sqliteTable("tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  albumId: integer("album_id")
    .notNull()
    .references(() => albums.id, { onDelete: "cascade" }),
  artistId: integer("artist_id")
    .notNull()
    .references(() => artists.id, { onDelete: "cascade" }),
  trackNumber: integer("track_number"),
  discNumber: integer("disc_number"),
  durationSeconds: real("duration_seconds"),
  codec: text("codec"),
  bitrate: integer("bitrate"),
  sampleRate: integer("sample_rate"),
  filePath: text("file_path").notNull().unique(),
  fileSize: integer("file_size").notNull(),
  fileMtimeMs: integer("file_mtime_ms").notNull(),
  mbid: text("mbid"), // MusicBrainz Recording ID
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const scanJobs = sqliteTable("scan_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull(), // "running" | "completed" | "failed"
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  filesTotal: integer("files_total").notNull().default(0),
  filesProcessed: integer("files_processed").notNull().default(0),
  filesAdded: integer("files_added").notNull().default(0),
  filesUpdated: integer("files_updated").notNull().default(0),
  filesSkipped: integer("files_skipped").notNull().default(0),
  filesRemoved: integer("files_removed").notNull().default(0),
  errorMessage: text("error_message"),
});

export const importItems = sqliteTable("import_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceDir: text("source_dir").notNull().unique(),
  folderName: text("folder_name").notNull(),
  status: text("status").notNull(), // "needs_review" | "imported" | "failed" | "dismissed"
  detectedArtist: text("detected_artist").notNull(),
  detectedAlbum: text("detected_album").notNull(),
  detectedYear: integer("detected_year"),
  trackCount: integer("track_count").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  matchedMbid: text("matched_mbid"),
  matchedArtist: text("matched_artist"),
  matchedAlbum: text("matched_album"),
  matchedYear: integer("matched_year"),
  matchedCoverUrl: text("matched_cover_url"),
  candidatesJson: text("candidates_json").notNull().default("[]"),
  filesJson: text("files_json").notNull().default("[]"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const playlists = sqliteTable("playlists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  coverHash: text("cover_hash"),
  syncedFilename: text("synced_filename"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const playlistTracks = sqliteTable("playlist_tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playlistId: integer("playlist_id")
    .notNull()
    .references(() => playlists.id, { onDelete: "cascade" }),
  trackId: integer("track_id")
    .notNull()
    .references(() => tracks.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
});

export const playlistMissingTracks = sqliteTable("playlist_missing_tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playlistId: integer("playlist_id")
    .notNull()
    .references(() => playlists.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  album: text("album"),
  status: text("status").notNull().default("missing"), // "missing" | "queued"
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const activityLogs = sqliteTable("activity_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  level: text("level").notNull(), // "info" | "success" | "warn" | "error"
  category: text("category").notNull(),
  message: text("message").notNull(),
  detailsJson: text("details_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"), // "admin" | "user"
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const albumTracklistCache = sqliteTable("album_tracklist_cache", {
  albumId: integer("album_id")
    .primaryKey()
    .references(() => albums.id, { onDelete: "cascade" }),
  selectedReleaseId: text("selected_release_id"),
  provider: text("provider"),
  selectedReleaseJson: text("selected_release_json"),
  releasesJson: text("releases_json").notNull().default("[]"),
  tracksJson: text("tracks_json").notNull().default("[]"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const trackLyrics = sqliteTable("track_lyrics", {
  trackId: integer("track_id")
    .primaryKey()
    .references(() => tracks.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // "sidecar" | "embedded" | "lrclib" | "none"
  syncedLrc: text("synced_lrc"),
  plainLyrics: text("plain_lyrics"),
  instrumental: integer("instrumental").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
