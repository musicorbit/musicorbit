import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  ActivityLogsResponse,
  AlbumSummary,
  AuthStatusResponse,
  DeleteLibraryItemsResponse,
  DownloadsListResponse,
  FinalizeUploadBatchResponse,
  PlaylistSummary,
  StartUploadBatchResponse,
  TrackSummary,
  UserSummary,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { needsBrowserTranscode } from "../services/audioTranscoder.js";
import { writeAudioTags } from "../services/tagWriter.js";

function createTestWavBuffer(durationSeconds = 0.2, sampleRate = 8000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function extractSessionCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  assert.ok(raw, "Expected Set-Cookie header");
  const pair = raw.split(";")[0] ?? "";
  assert.ok(pair.startsWith("musicorbit_session="), `Unexpected cookie: ${pair}`);
  return pair;
}

describe("Multi-User Authentication, Security, Isolation & slskd Routing", () => {
  let tmpRoot: string;
  let adminMusicDir: string;
  let downloadsDir: string;
  let dataDir: string;
  let handle: ServerHandle;

  let adminCookie = "";
  let alexCookie = "";
  let alexUser!: UserSummary;
  let adminTrackId = 0;
  let adminAlbumId = 0;
  let adminPlaylistId = 0;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-multiuser-"));
    adminMusicDir = path.join(tmpRoot, "admin-music");
    downloadsDir = path.join(tmpRoot, "downloads");
    dataDir = path.join(tmpRoot, "data");
    fs.mkdirSync(adminMusicDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    // Place one pre-existing track in Admin's music directory before setup
    const adminSongPath = path.join(adminMusicDir, "Dua Lipa", "Future Nostalgia", "01 - Physical.wav");
    fs.mkdirSync(path.dirname(adminSongPath), { recursive: true });
    fs.writeFileSync(adminSongPath, createTestWavBuffer());
    writeAudioTags(adminSongPath, {
      title: "Physical",
      artist: "Dua Lipa",
      albumArtist: "Dua Lipa",
      album: "Future Nostalgia",
      trackNumber: 1,
      discNumber: 1,
      year: 2020,
    });

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      // Mock slskd endpoints
      if (url.startsWith("http://slskd.test/api/v0/application")) {
        return new Response(JSON.stringify({ version: "0.22.0", server: { isLoggedIn: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("http://slskd.test/api/v0/transfers/downloads/") && method === "POST") {
        return new Response("", { status: 201 });
      }
      if (url === "http://slskd.test/api/v0/transfers/downloads" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              username: "peer_a",
              directories: [
                {
                  directory: "@@music\\Dua Lipa - Future Nostalgia",
                  files: [
                    {
                      id: "tx-alex-1",
                      username: "peer_a",
                      filename: "@@music\\Dua Lipa - Future Nostalgia\\05 - Levitating.wav",
                      size: 4000,
                      state: "Completed, Succeeded",
                      percentComplete: 100,
                      bytesTransferred: 4000,
                      averageSpeed: 1000,
                    },
                  ],
                },
              ],
            },
            {
              username: "peer_b",
              directories: [
                {
                  directory: "@@music\\Admin Exclusive",
                  files: [
                    {
                      id: "tx-admin-1",
                      username: "peer_b",
                      filename: "@@music\\Admin Exclusive\\01 - Secret Track.wav",
                      size: 4000,
                      state: "Completed, Succeeded",
                      percentComplete: 100,
                      bytesTransferred: 4000,
                      averageSpeed: 1000,
                    },
                  ],
                },
              ],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Mock Deezer single-track match for Levitating & Hallucinate
      if (url.startsWith("https://api.deezer.com/search/track?q=")) {
        const isLevitating = url.toLowerCase().includes("levitating");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: isLevitating ? 505 : 506,
                title: isLevitating ? "Levitating" : "Hallucinate",
                artist: { name: "Dua Lipa" },
                album: { id: 606, title: "Future Nostalgia" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("https://api.deezer.com/track/505")) {
        return new Response(
          JSON.stringify({
            id: 505,
            title: "Levitating",
            track_position: 5,
            disk_number: 1,
            release_date: "2020-03-27",
            artist: { name: "Dua Lipa" },
            album: { id: 606, title: "Future Nostalgia" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("https://api.deezer.com/track/506")) {
        return new Response(
          JSON.stringify({
            id: 506,
            title: "Hallucinate",
            track_position: 7,
            disk_number: 1,
            release_date: "2020-03-27",
            artist: { name: "Dua Lipa" },
            album: { id: 606, title: "Future Nostalgia" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("https://api.deezer.com/album/606")) {
        return new Response(
          JSON.stringify({
            id: 606,
            title: "Future Nostalgia",
            release_date: "2020-03-27",
            artist: { name: "Dua Lipa" },
            genres: { data: [{ name: "Pop" }] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Mock MusicBrainz empty so single-track Deezer auto-import runs cleanly
      if (url.startsWith("https://musicbrainz.org/")) {
        return new Response(JSON.stringify({ releases: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    };

    handle = await buildServer(
      {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        version: "0.1.0",
        musicDir: adminMusicDir,
        dataDir,
        dbPath: path.join(dataDir, "musicorbit.db"),
        coversDir: path.join(dataDir, "covers"),
        artistImagesDir: path.join(dataDir, "artist-images"),
        fetchArtistImages: false,
        slskdUrl: "http://slskd.test",
        slskdApiKey: "test-slskd-key",
        downloadsDir,
        autoImportThreshold: 85,
        authEnabled: true,
        webDistDir: null,
      },
      { fetchImpl: mockFetch, musicBrainzRateLimitMs: 0 },
    );
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("hashes passwords with scrypt (never plaintext), hashes session tokens, and enforces change-password session revocation", async () => {
    // 1. Unauthenticated requests to protected routes must be rejected
    const unauthTracks = await handle.app.inject({ method: "GET", url: "/api/tracks" });
    assert.equal(unauthTracks.statusCode, 401);

    // 2. First-run admin setup
    const adminPassword = "SuperSecureAdminPassword!99";
    const setupRes = await handle.app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", password: adminPassword },
    });
    assert.equal(setupRes.statusCode, 201);
    const setupBody = setupRes.json() as AuthStatusResponse;
    assert.equal(setupBody.authenticated, true);
    assert.equal(setupBody.user?.role, "admin");
    assert.equal(setupBody.user?.canUseSoulseek, true);
    assert.equal(setupBody.user?.onboardingCompleted, false);
    adminCookie = extractSessionCookie(setupRes.headers["set-cookie"]);

    // Verify onboarding completion persists per user in SQLite
    const onboardRes = await handle.app.inject({
      method: "POST",
      url: "/api/auth/onboarding",
      headers: { cookie: adminCookie },
      payload: { completed: true },
    });
    assert.equal(onboardRes.statusCode, 200);
    const statusAfterOnboard = (
      await handle.app.inject({
        method: "GET",
        url: "/api/auth/status",
        headers: { cookie: adminCookie },
      })
    ).json() as AuthStatusResponse;
    assert.equal(statusAfterOnboard.user?.onboardingCompleted, true);

    // Verify password is stored as salted scrypt hash — NEVER plaintext
    const dbUser = handle.dbContext.sqlite
      .prepare("SELECT password_hash AS passwordHash FROM users WHERE username = 'admin'")
      .get() as { passwordHash: string };
    assert.ok(dbUser.passwordHash.startsWith("scrypt:"));
    assert.ok(!dbUser.passwordHash.includes(adminPassword));
    assert.equal(dbUser.passwordHash.split(":").length, 3);

    // Verify raw session cookie token is NOT stored verbatim in SQLite
    const rawCookieValue = adminCookie.split("=")[1]!;
    const rawMatch = handle.dbContext.sqlite
      .prepare("SELECT token_hash FROM sessions WHERE token_hash = ?")
      .get(rawCookieValue);
    assert.equal(rawMatch, undefined, "Raw session token must never be stored in SQLite");

    // 3. Create a second admin session, then change password from session #1 -> session #2 must be revoked!
    const login2 = await handle.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: adminPassword },
    });
    assert.equal(login2.statusCode, 200);
    const secondAdminCookie = extractSessionCookie(login2.headers["set-cookie"]);

    const newAdminPassword = "RotatedAdminPassword!2026";
    const changeRes = await handle.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: adminCookie },
      payload: { currentPassword: adminPassword, newPassword: newAdminPassword },
    });
    assert.equal(changeRes.statusCode, 200);

    // Current session stays valid
    const stillValid = await handle.app.inject({
      method: "GET",
      url: "/api/auth/status",
      headers: { cookie: adminCookie },
    });
    assert.equal((stillValid.json() as AuthStatusResponse).authenticated, true);

    // Other session is immediately revoked
    const revoked = await handle.app.inject({
      method: "GET",
      url: "/api/tracks",
      headers: { cookie: secondAdminCookie },
    });
    assert.equal(revoked.statusCode, 401);

    // Old password rejected, new password works
    const oldLogin = await handle.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: adminPassword },
    });
    assert.equal(oldLogin.statusCode, 401);

    // Scan Admin's pre-existing track & create an Admin playlist for isolation checks
    await handle.scanner.runScan({ userId: 1 });
    const adminTracksRes = await handle.app.inject({
      method: "GET",
      url: "/api/tracks",
      headers: { cookie: adminCookie },
    });
    const adminTracks = adminTracksRes.json() as TrackSummary[];
    assert.equal(adminTracks.length, 1);
    adminTrackId = adminTracks[0]!.id;
    adminAlbumId = adminTracks[0]!.albumId;

    const plRes = await handle.app.inject({
      method: "POST",
      url: "/api/playlists",
      headers: { cookie: adminCookie },
      payload: { name: "Admin Favorites" },
    });
    assert.equal(plRes.statusCode, 201);
    adminPlaylistId = (plRes.json() as PlaylistSummary).id;
  });

  it("creates non-admin users with Soulseek OFF by default, isolated folder, and rejects overlapping folders & privilege escalation", async () => {
    // Reject overlapping folder inside Admin's musicDir
    const overlapRes = await handle.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: adminCookie },
      payload: {
        username: "baduser",
        password: "Password1234!",
        musicDir: path.join(adminMusicDir, "nested"),
      },
    });
    assert.equal(overlapRes.statusCode, 400);

    // Create Alex without specifying canUseSoulseek -> MUST default to false!
    const createRes = await handle.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: adminCookie },
      payload: {
        username: "alex",
        password: "AlexPassword!2026",
      },
    });
    assert.equal(createRes.statusCode, 201);
    alexUser = createRes.json() as UserSummary;
    assert.equal(alexUser.role, "user");
    assert.equal(alexUser.canUseSoulseek, false);
    assert.ok(fs.existsSync(alexUser.musicDir), "Alex's isolated musicDir should be auto-created");
    assert.notEqual(path.resolve(alexUser.musicDir), path.resolve(adminMusicDir));

    // Sign in as Alex
    const alexLogin = await handle.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alex", password: "AlexPassword!2026" },
    });
    assert.equal(alexLogin.statusCode, 200);
    alexCookie = extractSessionCookie(alexLogin.headers["set-cookie"]);

    // Verify Alex is blocked from Admin-only and Soulseek endpoints (403 Forbidden)
    for (const [method, url, payload] of [
      ["GET", "/api/users", undefined],
      ["DELETE", "/api/system/logs", undefined],
      ["GET", "/api/system/browse-dirs", undefined],
      ["PUT", "/api/system/music-dir", { path: alexUser.musicDir }],
      ["PUT", "/api/system/post-processing", { autoWatchEnabled: true }],
      ["POST", "/api/imports/scan", undefined],
      ["POST", "/api/imports/bulk-folder", { sourceDir: downloadsDir, fileAction: "copy" }],
      ["POST", "/api/acquisition/search", { query: "Dua Lipa" }],
      ["GET", "/api/acquisition/downloads", undefined],
    ] as const) {
      const res = await handle.app.inject({
        method,
        url,
        headers: { cookie: alexCookie },
        ...(payload ? { payload } : {}),
      });
      assert.equal(res.statusCode, 403, `Expected 403 for non-admin ${method} ${url}, got ${res.statusCode}`);
    }
  });

  it("enforces strict per-user library, playlist, upload, and IDOR isolation", async () => {
    // Alex starts with 0 albums, 0 tracks, 0 playlists (cannot see Admin's library)
    const alexAlbums = (
      await handle.app.inject({ method: "GET", url: "/api/albums", headers: { cookie: alexCookie } })
    ).json() as AlbumSummary[];
    assert.equal(alexAlbums.length, 0);

    const alexPlaylists = (
      await handle.app.inject({ method: "GET", url: "/api/playlists", headers: { cookie: alexCookie } })
    ).json() as PlaylistSummary[];
    assert.equal(alexPlaylists.length, 0);

    // Direct IDOR probes against Admin's resources must return 404
    for (const url of [
      `/api/albums/${adminAlbumId}`,
      `/api/tracks/${adminTrackId}/stream`,
      `/api/tracks/${adminTrackId}/metadata`,
      `/api/tracks/${adminTrackId}/lyrics`,
      `/api/playlists/${adminPlaylistId}`,
    ]) {
      const res = await handle.app.inject({ method: "GET", url, headers: { cookie: alexCookie } });
      assert.equal(res.statusCode, 404, `Expected 404 for cross-user IDOR ${url}, got ${res.statusCode}`);
    }

    // Admin starts an upload batch — Alex must NOT be able to finalize or upload to Admin's batch
    const adminBatchRes = await handle.app.inject({
      method: "POST",
      url: "/api/uploads/start",
      headers: { cookie: adminCookie },
    });
    const adminBatch = adminBatchRes.json() as StartUploadBatchResponse;
    const crossFinalize = await handle.app.inject({
      method: "POST",
      url: `/api/uploads/${adminBatch.batchId}/finalize`,
      headers: { cookie: alexCookie },
    });
    assert.equal(crossFinalize.statusCode, 404);
    await handle.app.inject({
      method: "DELETE",
      url: `/api/uploads/${adminBatch.batchId}`,
      headers: { cookie: adminCookie },
    });

    // Alex uploads a Dua Lipa track (SAME artist name as Admin!) via browser Upload API
    const tmpUpload = path.join(tmpRoot, "hallucinate.wav");
    fs.writeFileSync(tmpUpload, createTestWavBuffer());
    writeAudioTags(tmpUpload, {
      title: "Hallucinate",
      artist: "Dua Lipa",
      albumArtist: "Dua Lipa",
      album: "Future Nostalgia",
      trackNumber: 7,
      discNumber: 1,
      year: 2020,
    });
    const uploadBytes = fs.readFileSync(tmpUpload);

    const startRes = await handle.app.inject({
      method: "POST",
      url: "/api/uploads/start",
      headers: { cookie: alexCookie },
    });
    const batch = startRes.json() as StartUploadBatchResponse;

    const fileRes = await handle.app.inject({
      method: "POST",
      url: `/api/uploads/${batch.batchId}/file`,
      headers: {
        cookie: alexCookie,
        "content-type": "application/octet-stream",
        "x-upload-relative-path": encodeURIComponent("07 - Hallucinate.wav"),
      },
      payload: uploadBytes,
    });
    assert.equal(fileRes.statusCode, 200);

    const finRes = await handle.app.inject({
      method: "POST",
      url: `/api/uploads/${batch.batchId}/finalize`,
      headers: { cookie: alexCookie },
    });
    assert.equal(finRes.statusCode, 200);
    const finBody = finRes.json() as FinalizeUploadBatchResponse;
    assert.equal(finBody.autoImported, 1);

    // Verify Alex sees ONLY Hallucinate (stored strictly inside Alex's musicDir), and Admin still sees ONLY Physical!
    const alexTracks = (
      await handle.app.inject({ method: "GET", url: "/api/tracks", headers: { cookie: alexCookie } })
    ).json() as TrackSummary[];
    assert.equal(alexTracks.length, 1);
    assert.equal(alexTracks[0]!.title, "Hallucinate");
    assert.ok(
      path.resolve(alexTracks[0]!.filePath).startsWith(path.resolve(alexUser.musicDir)),
      "Alex's uploaded track must live inside Alex's isolated musicDir",
    );

    const adminTracksAfter = (
      await handle.app.inject({ method: "GET", url: "/api/tracks", headers: { cookie: adminCookie } })
    ).json() as TrackSummary[];
    assert.equal(adminTracksAfter.length, 1);
    assert.equal(adminTracksAfter[0]!.title, "Physical");

    // Non-admin Alex CAN view Activity Logs (200) and sees ONLY Alex's own logs (not Admin's)
    const alexLogsRes = await handle.app.inject({
      method: "GET",
      url: "/api/system/logs",
      headers: { cookie: alexCookie },
    });
    assert.equal(alexLogsRes.statusCode, 200);
    const alexLogs = alexLogsRes.json() as ActivityLogsResponse;
    assert.ok(alexLogs.entries.length > 0, "Alex should see their own upload/import/scan logs");
    assert.ok(
      alexLogs.entries.every((entry) => entry.details?.userId === alexUser.id),
      "Non-admin logs must only include entries belonging to that user",
    );
  });

  it("detects browser-incompatible lossless codecs like ALAC for lossless FLAC transcoding", () => {
    assert.equal(needsBrowserTranscode("ALAC", "/music/song.m4a"), true);
    assert.equal(needsBrowserTranscode("Apple Lossless", "/music/song.m4a"), true);
    assert.equal(needsBrowserTranscode("AAC", "/music/song.m4a"), false);
    assert.equal(needsBrowserTranscode("FLAC", "/music/song.flac"), false);
    assert.equal(needsBrowserTranscode("MPEG 1 Layer 3", "/music/song.mp3"), false);
  });

  it("routes shared slskd downloads straight into the requesting user's private library via download_ownership", async () => {
    // Admin grants Alex Soulseek permission
    const grantRes = await handle.app.inject({
      method: "PUT",
      url: `/api/users/${alexUser.id}`,
      headers: { cookie: adminCookie },
      payload: { canUseSoulseek: true },
    });
    assert.equal(grantRes.statusCode, 200);
    assert.equal((grantRes.json() as UserSummary).canUseSoulseek, true);

    // Alex enqueues a download from peer_a
    const enqueueRes = await handle.app.inject({
      method: "POST",
      url: "/api/acquisition/downloads",
      headers: { cookie: alexCookie },
      payload: {
        username: "peer_a",
        files: [
          {
            filename: "@@music\\Dua Lipa - Future Nostalgia\\05 - Levitating.wav",
            size: 4000,
          },
        ],
      },
    });
    assert.equal(enqueueRes.statusCode, 202);

    // Alex's GET /api/acquisition/downloads MUST only show Alex's transfer (not peer_b's transfer)
    const alexDlRes = await handle.app.inject({
      method: "GET",
      url: "/api/acquisition/downloads",
      headers: { cookie: alexCookie },
    });
    assert.equal(alexDlRes.statusCode, 200);
    const alexDl = alexDlRes.json() as DownloadsListResponse;
    assert.equal(alexDl.transfers.length, 1);
    assert.equal(alexDl.transfers[0]!.id, "tx-alex-1");

    // Admin's GET /api/acquisition/downloads sees ALL transfers
    const adminDlRes = await handle.app.inject({
      method: "GET",
      url: "/api/acquisition/downloads",
      headers: { cookie: adminCookie },
    });
    assert.equal(adminDlRes.statusCode, 200);
    assert.equal((adminDlRes.json() as DownloadsListResponse).transfers.length, 2);

    // Simulate slskd finishing the download into the shared DOWNLOADS_DIR
    const dlFolder = path.join(downloadsDir, "Dua Lipa - Future Nostalgia");
    fs.mkdirSync(dlFolder, { recursive: true });
    const dlFile = path.join(dlFolder, "05 - Levitating.wav");
    fs.writeFileSync(dlFile, createTestWavBuffer());
    writeAudioTags(dlFile, {
      title: "Levitating",
      artist: "Dua Lipa",
      albumArtist: "Dua Lipa",
      album: "Future Nostalgia",
      trackNumber: 5,
      discNumber: 1,
      year: 2020,
    });

    // Trigger post-processing scanInbox -> must route straight to Alex's library, NOT Admin's!
    const scanResult = await handle.importer.scanInbox();
    assert.equal(scanResult.autoImported, 1);

    const alexTracksNow = (
      await handle.app.inject({ method: "GET", url: "/api/tracks", headers: { cookie: alexCookie } })
    ).json() as TrackSummary[];
    assert.equal(alexTracksNow.length, 2);
    const levitating = alexTracksNow.find((t) => t.title === "Levitating");
    assert.ok(levitating, "Levitating should appear in Alex's library");
    assert.ok(
      path.resolve(levitating.filePath).startsWith(path.resolve(alexUser.musicDir)),
      "Routed Soulseek download must live inside Alex's musicDir",
    );

    // Admin's library remains completely untouched (still only 1 track: Physical)
    const adminTracksStill = (
      await handle.app.inject({ method: "GET", url: "/api/tracks", headers: { cookie: adminCookie } })
    ).json() as TrackSummary[];
    assert.equal(adminTracksStill.length, 1);
    assert.equal(adminTracksStill[0]!.title, "Physical");
  });

  it("permanently deletes tracks and albums with .lrc sidecar & empty-folder cleanup while enforcing user isolation", async () => {
    // 1. Cross-user IDOR guard: Alex must NOT be able to delete Admin's track or album
    const crossDelTrack = await handle.app.inject({
      method: "DELETE",
      url: `/api/tracks/${adminTrackId}`,
      headers: { cookie: alexCookie },
    });
    assert.equal(crossDelTrack.statusCode, 404);

    const crossDelAlbum = await handle.app.inject({
      method: "DELETE",
      url: `/api/albums/${adminAlbumId}`,
      headers: { cookie: alexCookie },
    });
    assert.equal(crossDelAlbum.statusCode, 404);

    // 2. Alex has 2 tracks in Future Nostalgia (Hallucinate + Levitating); add a .lrc sidecar & playlist entry
    const alexTracksBefore = (
      await handle.app.inject({ method: "GET", url: "/api/tracks", headers: { cookie: alexCookie } })
    ).json() as TrackSummary[];
    assert.equal(alexTracksBefore.length, 2);
    const hallucinate = alexTracksBefore.find((t) => t.title === "Hallucinate")!;
    const levitating = alexTracksBefore.find((t) => t.title === "Levitating")!;

    const lrcPath = hallucinate.filePath.replace(/\.wav$/i, ".lrc");
    fs.writeFileSync(lrcPath, "[00:01.00] Test lyric line\n", "utf8");

    const alexPlRes = await handle.app.inject({
      method: "POST",
      url: "/api/playlists",
      headers: { cookie: alexCookie },
      payload: { name: "Alex Mix" },
    });
    const alexPl = alexPlRes.json() as PlaylistSummary;
    await handle.app.inject({
      method: "POST",
      url: `/api/playlists/${alexPl.id}/tracks`,
      headers: { cookie: alexCookie },
      payload: { trackIds: [hallucinate.id, levitating.id] },
    });

    // Delete single track (Hallucinate)
    const delTrackRes = await handle.app.inject({
      method: "DELETE",
      url: `/api/tracks/${hallucinate.id}`,
      headers: { cookie: alexCookie },
    });
    assert.equal(delTrackRes.statusCode, 200);
    const delTrackBody = delTrackRes.json() as DeleteLibraryItemsResponse;
    assert.equal(delTrackBody.deleted, true);
    assert.deepEqual(delTrackBody.deletedTrackIds, [hallucinate.id]);
    assert.equal(delTrackBody.albumRemoved, false);
    assert.equal(delTrackBody.playlistsUpdated, 1);
    assert.equal(fs.existsSync(hallucinate.filePath), false, "Audio file should be deleted from disk");
    assert.equal(fs.existsSync(lrcPath), false, "Paired .lrc sidecar should be deleted from disk");
    assert.equal(fs.existsSync(levitating.filePath), true, "Sibling track must remain untouched");

    // Delete entire remaining album
    const delAlbumRes = await handle.app.inject({
      method: "DELETE",
      url: `/api/albums/${levitating.albumId}`,
      headers: { cookie: alexCookie },
    });
    assert.equal(delAlbumRes.statusCode, 200);
    const delAlbumBody = delAlbumRes.json() as DeleteLibraryItemsResponse;
    assert.equal(delAlbumBody.deleted, true);
    assert.equal(delAlbumBody.albumRemoved, true);
    assert.equal(fs.existsSync(levitating.filePath), false, "Album track should be deleted from disk");
    assert.equal(fs.existsSync(alexUser.musicDir), true, "User's root musicDir itself must stay intact");
    assert.equal(
      fs.existsSync(path.join(alexUser.musicDir, "Dua Lipa")),
      false,
      "Empty artist/album folders should be cleaned up",
    );

    const alexTracksAfter = (
      await handle.app.inject({ method: "GET", url: "/api/tracks", headers: { cookie: alexCookie } })
    ).json() as TrackSummary[];
    assert.equal(alexTracksAfter.length, 0);

    // Admin's track & file remain completely untouched
    const adminTracksStill = (
      await handle.app.inject({ method: "GET", url: "/api/tracks", headers: { cookie: adminCookie } })
    ).json() as TrackSummary[];
    assert.equal(adminTracksStill.length, 1);
    assert.equal(fs.existsSync(adminTracksStill[0]!.filePath), true);
  });

  it("supports separate username and displayName across setup, profile, and user management", async () => {
    // Admin updates their own displayName via self-service PUT /api/auth/profile
    const profileRes = await handle.app.inject({
      method: "PUT",
      url: "/api/auth/profile",
      headers: { cookie: adminCookie },
      payload: { displayName: "Bianca" },
    });
    assert.equal(profileRes.statusCode, 200);
    assert.equal(profileRes.json().user.username, "admin");
    assert.equal(profileRes.json().user.displayName, "Bianca");

    // Auth status reflects the displayName immediately
    const statusRes = await handle.app.inject({
      method: "GET",
      url: "/api/auth/status",
      headers: { cookie: adminCookie },
    });
    assert.equal(statusRes.statusCode, 200);
    assert.equal(statusRes.json().user.displayName, "Bianca");

    // Creating a new user with displayName persists and can be updated by Admin
    const createRes = await handle.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: adminCookie },
      payload: {
        username: "sam_login",
        displayName: "Sam Rivera",
        password: "SamPassword123!",
        role: "user",
      },
    });
    assert.equal(createRes.statusCode, 201);
    const sam = createRes.json() as UserSummary;
    assert.equal(sam.username, "sam_login");
    assert.equal(sam.displayName, "Sam Rivera");

    const updateRes = await handle.app.inject({
      method: "PUT",
      url: `/api/users/${sam.id}`,
      headers: { cookie: adminCookie },
      payload: { displayName: "Sam" },
    });
    assert.equal(updateRes.statusCode, 200);
    assert.equal((updateRes.json() as UserSummary).displayName, "Sam");
  });

  it("rate-limits repeated failed login attempts with HTTP 429", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await handle.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "ratelimit_probe_user", password: "WrongPassword123!" },
      });
      lastStatus = res.statusCode;
    }
    assert.equal(lastStatus, 429);
  });
});
