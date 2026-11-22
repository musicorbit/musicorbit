import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Core SQLite schema for MusicOrbit.
 *
 * Defined early in Step 1 so the database initializes cleanly on first boot.
 * Step 2's library scanner will populate these tables from your audio files.
 */

export const artists = sqliteTable("artists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sortName: text("sort_name").notNull(),
  mbid: text("mbid"), // MusicBrainz Artist ID (populated in Step 2/5)
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const albums = sqliteTable("albums", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  artistId: integer("artist_id")
    .notNull()
    .references(() => artists.id, { onDelete: "cascade" }),
  year: integer("year"),
  genre: text("genre"),
  coverHash: text("cover_hash"), // SHA-256 prefix pointing to cached cover art in DATA_DIR/covers
  mbid: text("mbid"), // MusicBrainz Release ID
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

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
