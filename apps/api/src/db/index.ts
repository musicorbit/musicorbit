import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export interface DbContext {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  dbPath: string;
}

/**
 * Opens the SQLite database in WAL mode and ensures initial tables exist.
 *
 * Self-hosted apps should boot cleanly on an empty DATA_DIR without requiring
 * users to manually run database migration commands.
 */
export function initDatabase(dbPath: string): DbContext {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  // WAL (Write-Ahead Logging) lets readers stream/browse while background scans write.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_name TEXT NOT NULL,
      mbid TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      year INTEGER,
      genre TEXT,
      cover_hash TEXT,
      mbid TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(artist_id, title)
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      track_number INTEGER,
      disc_number INTEGER,
      duration_seconds REAL,
      codec TEXT,
      bitrate INTEGER,
      sample_rate INTEGER,
      file_path TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      file_mtime_ms INTEGER NOT NULL,
      mbid TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_albums_artist_id ON albums(artist_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db, dbPath };
}
