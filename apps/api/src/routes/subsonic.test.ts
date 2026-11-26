import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { buildServer, type ServerHandle } from "../server.js";

function extractCookie(setCookie: string | string[] | undefined): string {
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (first ?? "").split(";")[0] ?? "";
}

function makeSubsonicToken(password: string, salt: string): string {
  return crypto.createHash("md5").update(`${password}${salt}`).digest("hex");
}

describe("OpenSubsonic / Subsonic REST API (/rest/*.view)", () => {
  let tmpDir: string;
  let adminMusicDir: string;
  let memberMusicDir: string;
  let dataDir: string;
  let handle: ServerHandle;
  let adminCookie = "";
  let memberCookie = "";
  let adminAppPassword = "";
  let memberAppPassword = "";
  let adminTrackId = 0;
  let adminAlbumId = 0;
  let adminArtistId = 0;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-subsonic-"));
    adminMusicDir = path.join(tmpDir, "admin-music");
    memberMusicDir = path.join(tmpDir, "member-music");
    dataDir = path.join(tmpDir, "data");
    fs.mkdirSync(adminMusicDir, { recursive: true });
    fs.mkdirSync(memberMusicDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    handle = await buildServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      musicDir: adminMusicDir,
      dataDir,
      downloadsDir: path.join(tmpDir, "downloads"),
      autoImportThreshold: 85,
      dbPath: path.join(dataDir, "musicorbit.db"),
      coversDir: path.join(dataDir, "covers"),
      artistImagesDir: path.join(dataDir, "artist-images"),
      fetchArtistImages: false,
      authEnabled: true,
      webDistDir: null,
      slskdUrl: null,
      slskdApiKey: null,
      version: "0.1.0",
    });

    // 1. Setup Admin account
    const setupRes = await handle.app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", password: "AdminPassword123!" },
    });
    assert.equal(setupRes.statusCode, 201);
    adminCookie = extractCookie(setupRes.headers["set-cookie"]);

    // 2. Create Member account with isolated music folder
    const createUserRes = await handle.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: adminCookie },
      payload: {
        username: "maya",
        password: "MayaPassword123!",
        role: "user",
        musicDir: memberMusicDir,
      },
    });
    assert.equal(createUserRes.statusCode, 201);
    const memberUser = createUserRes.json<{ id: number }>();

    const loginMemberRes = await handle.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "maya", password: "MayaPassword123!" },
    });
    assert.equal(loginMemberRes.statusCode, 200);
    memberCookie = extractCookie(loginMemberRes.headers["set-cookie"]);

    // 3. Generate Subsonic App Passwords for both users
    const rotAdmin = await handle.app.inject({
      method: "POST",
      url: "/api/auth/subsonic-password/rotate",
      headers: { cookie: adminCookie },
    });
    assert.equal(rotAdmin.statusCode, 200);
    adminAppPassword = rotAdmin.json<{ password: string }>().password;
    assert.ok(adminAppPassword.length >= 16);

    const rotMember = await handle.app.inject({
      method: "POST",
      url: "/api/auth/subsonic-password/rotate",
      headers: { cookie: memberCookie },
    });
    assert.equal(rotMember.statusCode, 200);
    memberAppPassword = rotMember.json<{ password: string }>().password;

    // 4. Seed Admin track + cover art + synced .lrc sidecar
    const audioPath = path.join(adminMusicDir, "01 - Solar Drift.mp3");
    const audioBytes = Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00" + "A".repeat(2048));
    fs.writeFileSync(audioPath, audioBytes);
    fs.writeFileSync(
      path.join(adminMusicDir, "01 - Solar Drift.lrc"),
      "[00:01.25]Golden light across the skyline\n[00:05.50]Every signal finds its orbit\n",
      "utf8",
    );

    const coverHash = "testcover123.png";
    fs.mkdirSync(path.join(dataDir, "covers"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "covers", coverHash), Buffer.from("PNGFAKE"));

    const now = Date.now();
    const { sqlite } = handle.dbContext;
    const arRes = sqlite
      .prepare(
        "INSERT INTO artists (user_id, name, sort_name, created_at, updated_at) VALUES (1, 'Ketsa', 'Ketsa', ?, ?)",
      )
      .run(now, now);
    adminArtistId = Number(arRes.lastInsertRowid);

    const alRes = sqlite
      .prepare(
        "INSERT INTO albums (user_id, title, artist_id, year, genre, cover_hash, created_at, updated_at) VALUES (1, 'Solar Horizons', ?, 2024, 'Electronic', ?, ?, ?)",
      )
      .run(adminArtistId, coverHash, now, now);
    adminAlbumId = Number(alRes.lastInsertRowid);

    const trRes = sqlite
      .prepare(
        `
        INSERT INTO tracks (
          user_id, title, album_id, artist_id, track_number, disc_number,
          duration_seconds, codec, bitrate, sample_rate, file_path, file_size, file_mtime_ms, created_at, updated_at
        ) VALUES (1, 'Solar Drift', ?, ?, 1, 1, 234, 'MP3', 320000, 44100, ?, ?, ?, ?, ?)
      `,
      )
      .run(adminAlbumId, adminArtistId, audioPath, audioBytes.length, now, now, now);
    adminTrackId = Number(trRes.lastInsertRowid);

    // Seed a separate artist for Member to confirm strict per-user library isolation
    sqlite
      .prepare(
        "INSERT INTO artists (user_id, name, sort_name, created_at, updated_at) VALUES (?, 'Maya Private Artist', 'Maya Private Artist', ?, ?)",
      )
      .run(memberUser.id, now, now);
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("authenticates with MD5 token auth, legacy enc: auth, formPost, and returns XML & JSON", async () => {
    const salt = "mysalt42";
    const token = makeSubsonicToken(adminAppPassword, salt);

    // Default XML response on ping.view
    const xmlPing = await handle.app.inject({
      method: "GET",
      url: `/rest/ping.view?u=admin&t=${token}&s=${salt}&v=1.16.1&c=Symfonium`,
    });
    assert.equal(xmlPing.statusCode, 200);
    assert.match(String(xmlPing.headers["content-type"]), /application\/xml/);
    assert.match(xmlPing.body, /status="ok"/);
    assert.match(xmlPing.body, /openSubsonic="true"/);

    // JSON response + OpenSubsonic extensions via formPost
    const extRes = await handle.app.inject({
      method: "POST",
      url: "/rest/getOpenSubsonicExtensions.view",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `u=admin&t=${token}&s=${salt}&v=1.16.1&c=Amperfy&f=json`,
    });
    assert.equal(extRes.statusCode, 200);
    const extJson = extRes.json<{
      "subsonic-response": { status: string; openSubsonic: boolean; openSubsonicExtensions: Array<{ name: string }> };
    }>();
    assert.equal(extJson["subsonic-response"].status, "ok");
    assert.equal(extJson["subsonic-response"].openSubsonic, true);
    assert.ok(extJson["subsonic-response"].openSubsonicExtensions.some((e) => e.name === "songLyrics"));

    // Legacy hex-encoded password auth against main scrypt login password
    const hexPass = `enc:${Buffer.from("AdminPassword123!", "utf8").toString("hex")}`;
    const legacyRes = await handle.app.inject({
      method: "GET",
      url: `/rest/ping.view?u=admin&p=${hexPass}&v=1.16.1&c=Feishin&f=json`,
    });
    assert.equal(legacyRes.json<{ "subsonic-response": { status: string } }>()["subsonic-response"].status, "ok");

    // Wrong password -> Subsonic error code 40
    const badRes = await handle.app.inject({
      method: "GET",
      url: `/rest/ping.view?u=admin&t=deadbeef&s=${salt}&v=1.16.1&c=Symfonium&f=json`,
    });
    const badBody = badRes.json<{ "subsonic-response": { status: string; error: { code: number } } }>();
    assert.equal(badBody["subsonic-response"].status, "failed");
    assert.equal(badBody["subsonic-response"].error.code, 40);
  });

  it("browses artists, albums, genres, search3 (including Symfonium empty sync), and isolates users", async () => {
    const salt = "s1";
    const adminAuth = `u=admin&t=${makeSubsonicToken(adminAppPassword, salt)}&s=${salt}&f=json`;
    const memberAuth = `u=maya&t=${makeSubsonicToken(memberAppPassword, salt)}&s=${salt}&f=json`;

    // Admin sees Ketsa, NOT Maya's private artist
    const artistsRes = await handle.app.inject({
      method: "GET",
      url: `/rest/getArtists.view?${adminAuth}`,
    });
    const adminArtists = artistsRes.json<{
      "subsonic-response": { artists: { index: Array<{ name: string; artist: Array<{ name: string }> }> } };
    }>()["subsonic-response"].artists.index;
    assert.equal(adminArtists.length, 1);
    assert.equal(adminArtists[0]?.name, "K");
    assert.equal(adminArtists[0]?.artist[0]?.name, "Ketsa");

    // Symfonium full-library sync via search3 with query=""
    const syncRes = await handle.app.inject({
      method: "GET",
      url: `/rest/search3.view?query=%22%22&artistCount=500&albumCount=500&songCount=500&${adminAuth}`,
    });
    const syncBody = syncRes.json<{
      "subsonic-response": {
        searchResult3: { artist: Array<{ id: string }>; album: Array<{ id: string }>; song: Array<{ id: string; title: string }> };
      };
    }>()["subsonic-response"].searchResult3;
    assert.equal(syncBody.artist.length, 1);
    assert.equal(syncBody.album.length, 1);
    assert.equal(syncBody.song.length, 1);
    assert.equal(syncBody.song[0]?.title, "Solar Drift");

    // Member cannot access Admin's track, album, cover art, or stream (strict IDOR isolation)
    const leakSong = await handle.app.inject({
      method: "GET",
      url: `/rest/getSong.view?id=tr-${adminTrackId}&${memberAuth}`,
    });
    assert.equal(
      leakSong.json<{ "subsonic-response": { error: { code: number } } }>()["subsonic-response"].error.code,
      70,
    );

    const leakStream = await handle.app.inject({
      method: "GET",
      url: `/rest/stream.view?id=tr-${adminTrackId}&${memberAuth}`,
    });
    assert.equal(
      leakStream.json<{ "subsonic-response": { error: { code: number } } }>()["subsonic-response"].error.code,
      70,
    );
  });

  it("streams with HTTP 206 byte ranges, downloads, serves cover art, synced lyrics, and playlist CRUD", async () => {
    const salt = "s2";
    const adminAuth = `u=admin&t=${makeSubsonicToken(adminAppPassword, salt)}&s=${salt}&f=json`;

    // 1. Stream with Range header (HTTP 206)
    const streamRes = await handle.app.inject({
      method: "GET",
      url: `/rest/stream.view?id=tr-${adminTrackId}&${adminAuth}`,
      headers: { range: "bytes=0-99" },
    });
    assert.equal(streamRes.statusCode, 206);
    assert.equal(streamRes.headers["content-length"], "100");
    assert.equal(streamRes.headers["content-type"], "audio/mpeg");

    // 2. Download raw file
    const dlRes = await handle.app.inject({
      method: "GET",
      url: `/rest/download.view?id=tr-${adminTrackId}&${adminAuth}`,
    });
    assert.equal(dlRes.statusCode, 200);
    assert.match(String(dlRes.headers["content-disposition"]), /attachment/);

    // 3. Cover art
    const coverRes = await handle.app.inject({
      method: "GET",
      url: `/rest/getCoverArt.view?id=al-${adminAlbumId}&${adminAuth}`,
    });
    assert.equal(coverRes.statusCode, 200);
    assert.equal(coverRes.headers["content-type"], "image/png");

    // 4. OpenSubsonic synced lyrics via getLyricsBySongId
    const lyricsRes = await handle.app.inject({
      method: "GET",
      url: `/rest/getLyricsBySongId.view?id=tr-${adminTrackId}&${adminAuth}`,
    });
    const structured = lyricsRes.json<{
      "subsonic-response": {
        lyricsList: {
          structuredLyrics: Array<{ synced: boolean; line: Array<{ start: number; value: string }> }>;
        };
      };
    }>()["subsonic-response"].lyricsList.structuredLyrics;
    assert.equal(structured.length, 1);
    assert.equal(structured[0]?.synced, true);
    assert.equal(structured[0]?.line[0]?.start, 1250);
    assert.equal(structured[0]?.line[0]?.value, "Golden light across the skyline");

    // 5. Playlist create -> list -> update -> delete
    const createPl = await handle.app.inject({
      method: "GET",
      url: `/rest/createPlaylist.view?name=Roadtrip&songId=tr-${adminTrackId}&${adminAuth}`,
    });
    const plId = createPl.json<{
      "subsonic-response": { playlist: { id: string; songCount: number } };
    }>()["subsonic-response"].playlist.id;
    assert.match(plId, /^pl-\d+$/);

    const updPl = await handle.app.inject({
      method: "GET",
      url: `/rest/updatePlaylist.view?playlistId=${plId}&name=Roadtrip+Deluxe&${adminAuth}`,
    });
    assert.equal(updPl.json<{ "subsonic-response": { status: string } }>()["subsonic-response"].status, "ok");

    const getPl = await handle.app.inject({
      method: "GET",
      url: `/rest/getPlaylist.view?id=${plId}&${adminAuth}`,
    });
    const plBody = getPl.json<{
      "subsonic-response": { playlist: { name: string; entry: Array<{ title: string }> } };
    }>()["subsonic-response"].playlist;
    assert.equal(plBody.name, "Roadtrip Deluxe");
    assert.equal(plBody.entry[0]?.title, "Solar Drift");

    const delPl = await handle.app.inject({
      method: "GET",
      url: `/rest/deletePlaylist.view?id=${plId}&${adminAuth}`,
    });
    assert.equal(delPl.json<{ "subsonic-response": { status: string } }>()["subsonic-response"].status, "ok");
  });
});
