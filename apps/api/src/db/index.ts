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

function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Losslessly upgrades legacy single-user `artists (name TEXT NOT NULL UNIQUE)` tables to
 * multi-user `UNIQUE(user_id, name)` while preserving every existing artist ID and FK.
 */
function migrateArtistsTableForMultiUser(sqlite: Database.Database): void {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'artists'")
    .get() as { sql?: string } | undefined;
  if (!row?.sql) return;

  const hasLegacyUniqueName = /name\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(row.sql);
  if (!hasLegacyUniqueName) return;

  const cols = sqlite.prepare("PRAGMA table_info(artists)").all() as Array<{ name: string }>;
  const hasUserId = cols.some((c) => c.name === "user_id");
  const hasImageHash = cols.some((c) => c.name === "image_hash");
  const hasImageCheckedAt = cols.some((c) => c.name === "image_checked_at");

  sqlite.pragma("foreign_keys = OFF");
  try {
    const tx = sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE artists_multiuser_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL DEFAULT 1,
          name TEXT NOT NULL,
          sort_name TEXT NOT NULL,
          image_hash TEXT,
          image_checked_at INTEGER,
          mbid TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(user_id, name)
        );

        INSERT INTO artists_multiuser_new (
          id, user_id, name, sort_name, image_hash, image_checked_at, mbid, created_at, updated_at
        )
        SELECT
          id,
          ${hasUserId ? "user_id" : "1"},
          name,
          sort_name,
          ${hasImageHash ? "image_hash" : "NULL"},
          ${hasImageCheckedAt ? "image_checked_at" : "NULL"},
          mbid,
          created_at,
          updated_at
        FROM artists;

        DROP TABLE artists;
        ALTER TABLE artists_multiuser_new RENAME TO artists;
      `);
    });
    tx();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

/**
 * Opens the SQLite database in WAL mode and ensures tables exist.
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
      user_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      sort_name TEXT NOT NULL,
      image_hash TEXT,
      image_checked_at INTEGER,
      mbid TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
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
      user_id INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE IF NOT EXISTS scan_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      files_total INTEGER NOT NULL DEFAULT 0,
      files_processed INTEGER NOT NULL DEFAULT 0,
      files_added INTEGER NOT NULL DEFAULT 0,
      files_updated INTEGER NOT NULL DEFAULT 0,
      files_skipped INTEGER NOT NULL DEFAULT 0,
      files_removed INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS import_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      source_dir TEXT NOT NULL UNIQUE,
      folder_name TEXT NOT NULL,
      status TEXT NOT NULL,
      detected_artist TEXT NOT NULL,
      detected_album TEXT NOT NULL,
      detected_year INTEGER,
      track_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      matched_mbid TEXT,
      matched_artist TEXT,
      matched_album TEXT,
      matched_year INTEGER,
      matched_cover_url TEXT,
      candidates_json TEXT NOT NULL DEFAULT '[]',
      files_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover_hash TEXT,
      synced_filename TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_missing_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      status TEXT NOT NULL DEFAULT 'missing',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      music_dir TEXT,
      can_use_soulseek INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL DEFAULT 1,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );

    CREATE TABLE IF NOT EXISTS download_ownership (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      slskd_username TEXT NOT NULL,
      remote_filename TEXT NOT NULL,
      basename_norm TEXT NOT NULL,
      folder_norm TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS album_tracklist_cache (
      album_id INTEGER PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
      selected_release_id TEXT,
      provider TEXT,
      selected_release_json TEXT,
      releases_json TEXT NOT NULL DEFAULT '[]',
      tracks_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_lyrics (
      track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      synced_lrc TEXT,
      plain_lyrics TEXT,
      instrumental INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_albums_artist_id ON albums(artist_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON playlist_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_playlist_missing_tracks_playlist_id ON playlist_missing_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_download_ownership_status ON download_ownership(status, created_at DESC);
  `);

  // Non-destructive upgrades for existing SQLite databases created before these columns existed
  ensureColumn(sqlite, "artists", "image_hash", "TEXT");
  ensureColumn(sqlite, "artists", "image_checked_at", "INTEGER");
  ensureColumn(sqlite, "playlists", "cover_hash", "TEXT");
  ensureColumn(sqlite, "playlists", "synced_filename", "TEXT");
  ensureColumn(sqlite, "users", "music_dir", "TEXT");
  ensureColumn(sqlite, "users", "can_use_soulseek", "INTEGER NOT NULL DEFAULT 0");

  // Multi-user library isolation upgrades
  migrateArtistsTableForMultiUser(sqlite);
  ensureColumn(sqlite, "artists", "user_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "albums", "user_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "tracks", "user_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "playlists", "user_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "import_items", "user_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "scan_jobs", "user_id", "INTEGER NOT NULL DEFAULT 1");

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_artists_user_id ON artists(user_id);
    CREATE INDEX IF NOT EXISTS idx_albums_user_id ON albums(user_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks(user_id);
    CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);
    CREATE INDEX IF NOT EXISTS idx_import_items_user_id ON import_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_scan_jobs_user_id ON scan_jobs(user_id);
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db, dbPath };
}
