import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  AuthStatusResponse,
  ImportM3u8Response,
  PlaylistDetailResponse,
  PlaylistSummary,
  TrackSummary,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";

function createMinimalWav(numSamples = 800): Buffer {
  const sampleRate = 8000;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, 4, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, 4, "ascii");
  buf.write("fmt ", 12, 4, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, 4, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

describe("Playlists (M3U8) & Optional Auth", () => {
  let tmpRoot: string;
  let playlistHandle: ServerHandle;
  let authHandle: ServerHandle;
  let trackIds: number[] = [];

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-step6-"));
    const musicDir = path.join(tmpRoot, "music");
    const albumDir = path.join(musicDir, "Orbit", "TestAlbum");
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "01 - Alpha.wav"), createMinimalWav());
    fs.writeFileSync(path.join(albumDir, "02 - Beta.wav"), createMinimalWav());

    playlistHandle = await buildServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      musicDir,
      dataDir: path.join(tmpRoot, "data-pl"),
      downloadsDir: path.join(tmpRoot, "downloads-pl"),
      autoImportThreshold: 85,
      dbPath: path.join(tmpRoot, "data-pl", "musicorbit.db"),
      coversDir: path.join(tmpRoot, "data-pl", "covers"),
      artistImagesDir: path.join(tmpRoot, "data-pl", "artist-images"),
      fetchArtistImages: false,
      authEnabled: false,
      webDistDir: null,
      slskdUrl: null,
      slskdApiKey: null,
      version: "0.1.0",
    });

    await playlistHandle.scanner.runScan();
    const trRes = await playlistHandle.app.inject({ method: "GET", url: "/api/tracks" });
    trackIds = trRes.json<TrackSummary[]>().map((t) => t.id);

    authHandle = await buildServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      musicDir,
      dataDir: path.join(tmpRoot, "data-auth"),
      downloadsDir: path.join(tmpRoot, "downloads-auth"),
      autoImportThreshold: 85,
      dbPath: path.join(tmpRoot, "data-auth", "musicorbit.db"),
      coversDir: path.join(tmpRoot, "data-auth", "covers"),
      artistImagesDir: path.join(tmpRoot, "data-auth", "artist-images"),
      fetchArtistImages: false,
      authEnabled: true,
      webDistDir: null,
      slskdUrl: null,
      slskdApiKey: null,
      version: "0.1.0",
    });
  });

  after(async () => {
    await playlistHandle.app.close();
    await authHandle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("creates, reorders, exports (.m3u8), and imports playlists", async () => {
    // Create playlist
    const createRes = await playlistHandle.app.inject({
      method: "POST",
      url: "/api/playlists",
      payload: { name: "Favorites", description: "Top picks" },
    });
    assert.equal(createRes.statusCode, 201);
    const created = createRes.json<PlaylistSummary>();
    assert.equal(created.name, "Favorites");

    // Add both tracks
    const addRes = await playlistHandle.app.inject({
      method: "POST",
      url: `/api/playlists/${created.id}/tracks`,
      payload: { trackIds },
    });
    assert.equal(addRes.statusCode, 200);
    assert.equal(addRes.json<PlaylistDetailResponse>().tracks.length, 2);

    // Reorder tracks (swap)
    const reversed = [...trackIds].reverse();
    const reorderRes = await playlistHandle.app.inject({
      method: "PUT",
      url: `/api/playlists/${created.id}/tracks/reorder`,
      payload: { trackIds: reversed },
    });
    assert.equal(reorderRes.statusCode, 200);
    assert.deepEqual(
      reorderRes.json<PlaylistDetailResponse>().tracks.map((t) => t.id),
      reversed,
    );

    // Export as .m3u8
    const expRes = await playlistHandle.app.inject({
      method: "GET",
      url: `/api/playlists/${created.id}/export.m3u8`,
    });
    assert.equal(expRes.statusCode, 200);
    const m3u8 = expRes.body;
    assert.ok(m3u8.startsWith("#EXTM3U"));
    assert.ok(m3u8.includes("Orbit/TestAlbum/02 - Beta.wav"));

    // Import that exported .m3u8 plus one missing entry
    const impRes = await playlistHandle.app.inject({
      method: "POST",
      url: "/api/playlists/import",
      payload: {
        name: "Imported Favorites",
        content: `${m3u8}\n#EXTINF:200,Missing Artist - Ghost Track\nMissing/Ghost.mp3\n`,
      },
    });
    assert.equal(impRes.statusCode, 201);
    const imported = impRes.json<ImportM3u8Response>();
    assert.equal(imported.matchedCount, 2);
    assert.equal(imported.unmatchedEntries.length, 1);
  });

  it("enforces first-run admin setup, session cookie auth, login, and logout when AUTH_ENABLED=true", async () => {
    // 1. Initially needs setup and blocks protected routes
    const status0 = await authHandle.app.inject({ method: "GET", url: "/api/auth/status" });
    assert.equal(status0.statusCode, 200);
    const s0 = status0.json<AuthStatusResponse>();
    assert.equal(s0.authEnabled, true);
    assert.equal(s0.needsSetup, true);
    assert.equal(s0.authenticated, false);

    const blocked = await authHandle.app.inject({ method: "GET", url: "/api/albums" });
    assert.equal(blocked.statusCode, 401);

    // /api/health remains open for Docker healthchecks
    const health = await authHandle.app.inject({ method: "GET", url: "/api/health" });
    assert.equal(health.statusCode, 200);

    // 2. First-run setup creates admin and sets HttpOnly session cookie
    const setupRes = await authHandle.app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", password: "super-secret-password" },
    });
    assert.equal(setupRes.statusCode, 201);
    const setCookie = String(setupRes.headers["set-cookie"] ?? "");
    assert.ok(setCookie.includes("musicorbit_session="));
    assert.ok(setCookie.includes("HttpOnly"));
    const cookiePair = setCookie.split(";")[0]!;

    // Second setup attempt must be rejected with 409
    const dupSetup = await authHandle.app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "hacker", password: "super-secret-password" },
    });
    assert.equal(dupSetup.statusCode, 409);

    // 3. Authenticated request with cookie succeeds
    const allowed = await authHandle.app.inject({
      method: "GET",
      url: "/api/albums",
      headers: { cookie: cookiePair },
    });
    assert.equal(allowed.statusCode, 200);

    // 4. Logout invalidates the session
    const logoutRes = await authHandle.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: cookiePair },
    });
    assert.equal(logoutRes.statusCode, 200);

    const afterLogout = await authHandle.app.inject({
      method: "GET",
      url: "/api/albums",
      headers: { cookie: cookiePair },
    });
    assert.equal(afterLogout.statusCode, 401);

    // 5. Wrong password fails, right password logs back in
    const badLogin = await authHandle.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong-password" },
    });
    assert.equal(badLogin.statusCode, 401);

    const goodLogin = await authHandle.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "super-secret-password" },
    });
    assert.equal(goodLogin.statusCode, 200);
    assert.equal(goodLogin.json<AuthStatusResponse>().authenticated, true);
  });

  it("uploads, serves, and resets a custom playlist cover image", async () => {
    const createRes = await playlistHandle.app.inject({
      method: "POST",
      url: "/api/playlists",
      payload: { name: "Cover Art Test" },
    });
    assert.equal(createRes.statusCode, 201);
    const created = createRes.json<PlaylistSummary>();
    assert.equal(created.coverHash, null);

    // Reject non-image bytes
    const badRes = await playlistHandle.app.inject({
      method: "PUT",
      url: `/api/playlists/${created.id}/cover`,
      headers: { "content-type": "image/png" },
      payload: Buffer.from("not-a-real-image-at-all"),
    });
    assert.equal(badRes.statusCode, 400);

    // Valid minimal PNG header + bytes
    const fakePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 0x01),
    ]);
    const uploadRes = await playlistHandle.app.inject({
      method: "PUT",
      url: `/api/playlists/${created.id}/cover`,
      headers: { "content-type": "image/png" },
      payload: fakePng,
    });
    assert.equal(uploadRes.statusCode, 200);
    const updated = uploadRes.json<PlaylistSummary>();
    assert.ok(updated.coverHash?.endsWith(".png"));

    // Serve uploaded cover
    const getCover = await playlistHandle.app.inject({
      method: "GET",
      url: `/api/playlists/${created.id}/cover`,
    });
    assert.equal(getCover.statusCode, 200);
    assert.equal(getCover.headers["content-type"], "image/png");
    assert.deepEqual(getCover.rawPayload, fakePng);

    // Reset cover back to null
    const delCover = await playlistHandle.app.inject({
      method: "DELETE",
      url: `/api/playlists/${created.id}/cover`,
    });
    assert.equal(delCover.statusCode, 200);
    assert.equal(delCover.json<PlaylistSummary>().coverHash, null);

    const missingAfterReset = await playlistHandle.app.inject({
      method: "GET",
      url: `/api/playlists/${created.id}/cover`,
    });
    assert.equal(missingAfterReset.statusCode, 404);
  });
});
