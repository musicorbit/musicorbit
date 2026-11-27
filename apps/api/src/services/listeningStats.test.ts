import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildServer } from "../server.js";
import { ListeningStatsService, normalizeClientName } from "./listeningStats.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-stats-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ListeningStats, OpenSubsonic Scrobbling & Recaps", () => {
  it("normalizes OpenSubsonic and web client names cleanly", () => {
    assert.equal(normalizeClientName("arpeggi", "subsonic"), "Arpeggi");
    assert.equal(normalizeClientName("Symfonium/10.5", "subsonic"), "Symfonium");
    assert.equal(normalizeClientName("amperfy", "subsonic"), "Amperfy");
    assert.equal(normalizeClientName("MusicOrbit PWA", "web"), "MusicOrbit PWA");
    assert.equal(normalizeClientName("", "subsonic"), "OpenSubsonic App");
    assert.equal(normalizeClientName(undefined, "web"), "MusicOrbit Web");
  });

  it("tracks plays across Web & OpenSubsonic scrobble, computes Home stats & Recaps, isolates users, and saves Top 25 playlist", async () => {
    const root = createTempDir();
    const musicDir = path.join(root, "music");
    const dataDir = path.join(root, "data");
    const downloadsDir = path.join(root, "downloads");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });

    const server = await buildServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      musicDir,
      dataDir,
      downloadsDir,
      autoImportThreshold: 85,
      dbPath: path.join(dataDir, "musicorbit.db"),
      coversDir: path.join(dataDir, "covers"),
      artistImagesDir: path.join(dataDir, "artist-images"),
      fetchArtistImages: false,
      checkUpdates: false,
      authEnabled: true,
      webDistDir: null,
      slskdUrl: null,
      slskdApiKey: null,
      version: "0.1.0",
    });

    try {
      // Create Admin (user 1)
      const setupRes = await server.app.inject({
        method: "POST",
        url: "/api/auth/setup",
        payload: { username: "bianca", password: "password123" },
      });
      assert.equal(setupRes.statusCode, 201);
      const adminCookie = setupRes.cookies.find((c) => c.name === "musicorbit_session")!;

      // Generate Subsonic App Password for Admin
      const subPassRes = await server.app.inject({
        method: "POST",
        url: "/api/auth/subsonic-password/rotate",
        cookies: { musicorbit_session: adminCookie.value },
      });
      assert.equal(subPassRes.statusCode, 200);
      const subPassword = (subPassRes.json() as { password: string }).password;

      // Create second isolated user (user 2)
      const user2Music = path.join(root, "music-user2");
      fs.mkdirSync(user2Music, { recursive: true });
      const createU2 = await server.app.inject({
        method: "POST",
        url: "/api/users",
        cookies: { musicorbit_session: adminCookie.value },
        payload: {
          username: "guest",
          password: "password123",
          role: "user",
          musicDir: user2Music,
        },
      });
      assert.equal(createU2.statusCode, 201);
      const loginU2 = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "guest", password: "password123" },
      });
      const user2Cookie = loginU2.cookies.find((c) => c.name === "musicorbit_session")!;

      // Seed 2 artists, 2 albums, 2 tracks for user 1
      const now = Date.now();
      const { sqlite } = server.dbContext;
      const a1 = Number(
        sqlite
          .prepare(
            "INSERT INTO artists (user_id, name, sort_name, created_at, updated_at) VALUES (1, ?, ?, ?, ?)",
          )
          .run("Daft Punk", "Daft Punk", now, now).lastInsertRowid,
      );
      const a2 = Number(
        sqlite
          .prepare(
            "INSERT INTO artists (user_id, name, sort_name, created_at, updated_at) VALUES (1, ?, ?, ?, ?)",
          )
          .run("Nujabes", "Nujabes", now, now).lastInsertRowid,
      );
      const al1 = Number(
        sqlite
          .prepare(
            "INSERT INTO albums (user_id, title, artist_id, year, genre, cover_hash, created_at, updated_at) VALUES (1, ?, ?, 2001, 'Electronic', 'cover1.jpg', ?, ?)",
          )
          .run("Discovery", a1, now - 10_000, now - 10_000).lastInsertRowid,
      );
      const al2 = Number(
        sqlite
          .prepare(
            "INSERT INTO albums (user_id, title, artist_id, year, genre, cover_hash, created_at, updated_at) VALUES (1, ?, ?, 2005, 'Hip-Hop', 'cover2.jpg', ?, ?)",
          )
          .run("Modal Soul", a2, now, now).lastInsertRowid,
      );
      const t1 = Number(
        sqlite
          .prepare(
            "INSERT INTO tracks (user_id, title, album_id, artist_id, track_number, duration_seconds, codec, file_path, file_size, file_mtime_ms, created_at, updated_at) VALUES (1, ?, ?, ?, 1, 240, 'FLAC', ?, 30000000, ?, ?, ?)",
          )
          .run("Digital Love", al1, a1, path.join(musicDir, "t1.flac"), now, now, now)
          .lastInsertRowid,
      );
      const t2 = Number(
        sqlite
          .prepare(
            "INSERT INTO tracks (user_id, title, album_id, artist_id, track_number, duration_seconds, codec, file_path, file_size, file_mtime_ms, created_at, updated_at) VALUES (1, ?, ?, ?, 1, 180, 'MP3', ?, 5000000, ?, ?, ?)",
          )
          .run("Feather", al2, a2, path.join(musicDir, "t2.mp3"), now, now, now).lastInsertRowid,
      );

      // 1. Record play via Web API + verify 60s deduplication
      const webPlay1 = await server.app.inject({
        method: "POST",
        url: "/api/plays",
        cookies: { musicorbit_session: adminCookie.value },
        payload: { trackId: t1, clientName: "MusicOrbit Web", playedAt: now - 3600_000 },
      });
      assert.equal(webPlay1.statusCode, 200);
      assert.equal(webPlay1.json().recorded, true);

      const webPlayDup = await server.app.inject({
        method: "POST",
        url: "/api/plays",
        cookies: { musicorbit_session: adminCookie.value },
        payload: { trackId: t1, clientName: "MusicOrbit Web", playedAt: now - 3600_000 + 15_000 },
      });
      assert.equal(webPlayDup.json().recorded, false);
      assert.equal(webPlayDup.json().deduplicated, true);

      // 2. Record offline scrobbles via OpenSubsonic (c=Arpeggi) — submission=false ignored, true recorded
      const nowPlayingPing = await server.app.inject({
        method: "GET",
        url: `/rest/scrobble.view?u=bianca&p=${encodeURIComponent(subPassword)}&v=1.16.1&c=Arpeggi&f=json&id=tr-${t2}&submission=false`,
      });
      assert.equal(nowPlayingPing.statusCode, 200);

      const tDayAgo = now - 86_400_000;
      const tTwoHrsAgo = now - 7_200_000;
      const arpeggiScrobble = await server.app.inject({
        method: "GET",
        url: `/rest/scrobble.view?u=bianca&p=${encodeURIComponent(subPassword)}&v=1.16.1&c=arpeggi&f=json&id=tr-${t1}&id=tr-${t2}&time=${tDayAgo}&time=${tTwoHrsAgo}`,
      });
      assert.equal(arpeggiScrobble.statusCode, 200);
      assert.equal(arpeggiScrobble.json()["subsonic-response"].status, "ok");

      // 3. Verify OpenSubsonic getAlbumList2?type=frequent orders Discovery (2 plays) ahead of Modal Soul (1 play)
      const frequentRes = await server.app.inject({
        method: "GET",
        url: `/rest/getAlbumList2.view?u=bianca&p=${encodeURIComponent(subPassword)}&v=1.16.1&c=Arpeggi&f=json&type=frequent`,
      });
      assert.equal(frequentRes.statusCode, 200);
      const frequentAlbums = frequentRes.json()["subsonic-response"].albumList2.album;
      assert.equal(frequentAlbums[0].name, "Discovery");

      // 4. Verify Home stats for user 1
      const homeRes = await server.app.inject({
        method: "GET",
        url: "/api/stats/home?range=30d",
        cookies: { musicorbit_session: adminCookie.value },
      });
      assert.equal(homeRes.statusCode, 200);
      const home = homeRes.json();
      assert.equal(home.listening.totalPlays, 3);
      assert.equal(home.listening.currentStreakDays, 2);
      assert.equal(home.library.trackCount, 2);
      assert.equal(home.library.losslessPercentage, 50);
      assert.equal(home.topArtists[0].artistName, "Daft Punk");
      assert.equal(home.topArtists[0].playCount, 2);
      assert.equal(home.topTracks[0].title, "Digital Love");
      assert.equal(home.topGenres[0].genre, "Electronic");

      // Verify Arpeggi & MusicOrbit Web client split
      const arpeggiClient = home.clients.find((c: { clientName: string }) => c.clientName === "Arpeggi");
      const webClient = home.clients.find((c: { clientName: string }) => c.clientName === "MusicOrbit Web");
      assert.equal(arpeggiClient?.playCount, 2);
      assert.equal(webClient?.playCount, 1);

      // 5. Verify strict user isolation: user 2 sees 0 plays
      const homeU2 = await server.app.inject({
        method: "GET",
        url: "/api/stats/home?range=all",
        cookies: { musicorbit_session: user2Cookie.value },
      });
      assert.equal(homeU2.statusCode, 200);
      assert.equal(homeU2.json().listening.allTimePlays, 0);

      // 6. Verify Monthly & Yearly Recaps + Save Top 25 as Playlist
      const yearStr = String(new Date(now).getFullYear());
      const recapRes = await server.app.inject({
        method: "GET",
        url: `/api/stats/recap?type=year&period=${yearStr}`,
        cookies: { musicorbit_session: adminCookie.value },
      });
      assert.equal(recapRes.statusCode, 200);
      const recap = recapRes.json();
      assert.equal(recap.totalPlays, 3);
      assert.equal(recap.topTrack.title, "Digital Love");
      assert.equal(recap.topArtist.artistName, "Daft Punk");
      assert.equal(recap.monthlyBreakdown.length, 12);

      const savePlRes = await server.app.inject({
        method: "POST",
        url: "/api/stats/recap/playlist",
        cookies: { musicorbit_session: adminCookie.value },
        payload: { type: "year", period: yearStr },
      });
      assert.equal(savePlRes.statusCode, 201);
      assert.equal(savePlRes.json().tracksAdded, 2);
      assert.match(savePlRes.json().playlist.name, new RegExp(yearStr));
    } finally {
      await server.app.close();
    }
  });

  it("unlocks Yearly Recap automatically on December 26 (post-Christmas)", () => {
    const root = createTempDir();
    const dbPath = path.join(root, "test.db");
    // Minimal check using ListeningStatsService with controlled clock
    const dec25 = new Date(2026, 11, 25, 18, 0, 0).getTime();
    const dec26 = new Date(2026, 11, 26, 9, 0, 0).getTime();

    // Use buildServer or initDatabase directly
    return import("../db/index.js").then(({ initDatabase }) => {
      const dbContext = initDatabase(dbPath);
      try {
        const beforeXmas = new ListeningStatsService({ dbContext, now: () => dec25 });
        const afterXmas = new ListeningStatsService({ dbContext, now: () => dec26 });

        assert.equal(beforeXmas.getRecap(1, "year", "2026").isPostChristmasUnlocked, false);
        assert.equal(afterXmas.getRecap(1, "year", "2026").isPostChristmasUnlocked, true);
        assert.equal(beforeXmas.getRecap(1, "year", "2025").isPostChristmasUnlocked, true);
      } finally {
        dbContext.sqlite.close();
      }
    });
  });

  it("imports both Spotify Account Data & Extended Streaming History JSON, matches local library, deduplicates overlap, filters skips/podcasts, and supports clear", async () => {
    const root = createTempDir();
    const musicDir = path.join(root, "music");
    const dataDir = path.join(root, "data");
    const downloadsDir = path.join(root, "downloads");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });

    const server = await buildServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      musicDir,
      dataDir,
      downloadsDir,
      autoImportThreshold: 85,
      dbPath: path.join(dataDir, "musicorbit.db"),
      coversDir: path.join(dataDir, "covers"),
      artistImagesDir: path.join(dataDir, "artist-images"),
      fetchArtistImages: false,
      checkUpdates: false,
      authEnabled: true,
      webDistDir: null,
      slskdUrl: null,
      slskdApiKey: null,
      version: "0.1.0",
    });

    try {
      const setupRes = await server.app.inject({
        method: "POST",
        url: "/api/auth/setup",
        payload: { username: "bianca", password: "password123" },
      });
      assert.equal(setupRes.statusCode, 201);
      const cookie = setupRes.cookies.find((c) => c.name === "musicorbit_session")!;

      // Seed 1 owned track to verify normalized matching ("Digital Love - 2001 Remaster" -> "Digital Love")
      const now = Date.now();
      const { sqlite } = server.dbContext;
      const a1 = Number(
        sqlite
          .prepare(
            "INSERT INTO artists (user_id, name, sort_name, created_at, updated_at) VALUES (1, ?, ?, ?, ?)",
          )
          .run("Daft Punk", "Daft Punk", now, now).lastInsertRowid,
      );
      const al1 = Number(
        sqlite
          .prepare(
            "INSERT INTO albums (user_id, title, artist_id, year, genre, cover_hash, created_at, updated_at) VALUES (1, ?, ?, 2001, 'Electronic', 'cover1.jpg', ?, ?)",
          )
          .run("Discovery", a1, now, now).lastInsertRowid,
      );
      const t1 = Number(
        sqlite
          .prepare(
            "INSERT INTO tracks (user_id, title, album_id, artist_id, track_number, duration_seconds, codec, file_path, file_size, file_mtime_ms, created_at, updated_at) VALUES (1, ?, ?, ?, 1, 298, 'FLAC', ?, 30000000, ?, ?, ?)",
          )
          .run("Digital Love", al1, a1, path.join(musicDir, "t1.flac"), now, now, now)
          .lastInsertRowid,
      );

      // Also log 1 live web play so we verify DELETE /api/stats/import/spotify leaves live plays untouched
      await server.app.inject({
        method: "POST",
        url: "/api/plays",
        cookies: { musicorbit_session: cookie.value },
        payload: { trackId: t1, clientName: "MusicOrbit Web" },
      });

      // 1. Import Spotify Account Data format (StreamingHistory_music_0.json)
      const accountImport = await server.app.inject({
        method: "POST",
        url: "/api/stats/import/spotify",
        cookies: { musicorbit_session: cookie.value },
        payload: {
          minSeconds: 30,
          entries: [
            {
              endTime: "2026-06-15 18:30",
              artistName: "Daft Punk",
              trackName: "Digital Love - 2001 Remaster",
              msPlayed: 298000,
            },
            {
              endTime: "2026-06-15 18:35",
              artistName: "Unowned Artist",
              trackName: "Unowned Track",
              msPlayed: 210000,
            },
            {
              // Too short (< 30s) -> skipped
              endTime: "2026-06-15 18:40",
              artistName: "Daft Punk",
              trackName: "Harder Better Faster Stronger",
              msPlayed: 12000,
            },
          ],
        },
      });
      assert.equal(accountImport.statusCode, 200);
      const accBody = accountImport.json();
      assert.equal(accBody.format, "account");
      assert.equal(accBody.importedCount, 2);
      assert.equal(accBody.matchedLocalTracks, 1);
      assert.equal(accBody.skippedShortOrNonMusic, 1);

      // 2. Import Extended Streaming History overlapping the first play (±65s dedupe!) + 1 new play + 1 podcast + 1 skipped track
      const extendedImport = await server.app.inject({
        method: "POST",
        url: "/api/stats/import/spotify",
        cookies: { musicorbit_session: cookie.value },
        payload: [
          {
            // Overlaps "2026-06-15 18:30" by 22 seconds -> deduplicated!
            ts: "2026-06-15T18:30:22Z",
            ms_played: 298120,
            master_metadata_track_name: "Digital Love",
            master_metadata_album_artist_name: "Daft Punk",
            master_metadata_album_name: "Discovery",
            skipped: false,
          },
          {
            // New play from 2025
            ts: "2025-11-02T22:15:00Z",
            ms_played: 245000,
            master_metadata_track_name: "Instant Crush",
            master_metadata_album_artist_name: "Daft Punk",
            master_metadata_album_name: "Random Access Memories",
            skipped: false,
          },
          {
            // Podcast (null track metadata) -> skipped
            ts: "2025-11-02T23:00:00Z",
            ms_played: 1800000,
            master_metadata_track_name: null,
            master_metadata_album_artist_name: null,
            master_metadata_album_name: null,
            episode_name: "Some Podcast",
          },
          {
            // Skipped early -> skipped
            ts: "2025-11-02T23:45:00Z",
            ms_played: 45000,
            master_metadata_track_name: "Short Skip",
            master_metadata_album_artist_name: "Someone",
            master_metadata_album_name: "Album",
            skipped: true,
          },
        ],
      });
      assert.equal(extendedImport.statusCode, 200);
      const extBody = extendedImport.json();
      assert.equal(extBody.format, "extended");
      assert.equal(extBody.importedCount, 1);
      assert.equal(extBody.deduplicatedCount, 1);
      assert.equal(extBody.skippedShortOrNonMusic, 2);

      // 3. Verify 2025 Recap populated from imported Spotify history and linked to Daft Punk artistId
      const recap2025 = await server.app.inject({
        method: "GET",
        url: "/api/stats/recap?type=year&period=2025",
        cookies: { musicorbit_session: cookie.value },
      });
      assert.equal(recap2025.statusCode, 200);
      const r25 = recap2025.json();
      assert.equal(r25.totalPlays, 1);
      assert.equal(r25.topArtist.artistId, a1);
      assert.equal(r25.clients[0].clientName, "Spotify (Imported)");

      // 4. Verify clearing imported history deletes only imported plays (3) and keeps live Web play (1)
      const clearRes = await server.app.inject({
        method: "DELETE",
        url: "/api/stats/import/spotify",
        cookies: { musicorbit_session: cookie.value },
      });
      assert.equal(clearRes.statusCode, 200);
      assert.equal(clearRes.json().deletedCount, 3);

      const homeAfterClear = await server.app.inject({
        method: "GET",
        url: "/api/stats/home?range=all",
        cookies: { musicorbit_session: cookie.value },
      });
      assert.equal(homeAfterClear.json().listening.allTimePlays, 1);
    } finally {
      await server.app.close();
    }
  });
});
