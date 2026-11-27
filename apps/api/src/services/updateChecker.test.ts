import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildServer } from "../server.js";
import { isNewerVersion, parseSemver, UpdateChecker } from "./updateChecker.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-updates-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("UpdateChecker semver comparison", () => {
  it("parses standard and v-prefixed semver versions", () => {
    assert.deepEqual(parseSemver("v1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: null });
    assert.deepEqual(parseSemver("0.1.0-beta.2+build42"), {
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: "beta.2",
    });
    assert.equal(parseSemver("not-a-version"), null);
  });

  it("compares versions accurately", () => {
    assert.equal(isNewerVersion("v0.2.0", "0.1.0"), true);
    assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
    assert.equal(isNewerVersion("0.1.1", "0.1.0"), true);
    assert.equal(isNewerVersion("0.2.0", "0.2.0-rc.1"), true);
    assert.equal(isNewerVersion("0.2.0-rc.1", "0.2.0"), false);
    assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
    assert.equal(isNewerVersion("0.0.9", "0.1.0"), false);
    assert.equal(isNewerVersion("invalid", "0.1.0"), false);
  });
});

describe("UpdateChecker caching and privacy behavior", () => {
  it("makes zero network calls when disabled via CHECK_UPDATES=false", async () => {
    let calls = 0;
    const checker = new UpdateChecker({
      currentVersion: "0.1.0",
      enabled: false,
      fetchImpl: (async () => {
        calls++;
        throw new Error("Should never be called");
      }) as typeof fetch,
    });

    const result = await checker.check({ force: true });
    assert.equal(calls, 0);
    assert.equal(result.enabled, false);
    assert.equal(result.updateAvailable, false);
    assert.equal(result.currentVersion, "0.1.0");
  });

  it("detects newer GitHub release, caches result, and bypasses cache on force=true", async () => {
    let calls = 0;
    let fakeNow = 1_700_000_000_000;
    const checker = new UpdateChecker({
      currentVersion: "0.1.0",
      enabled: true,
      cacheTtlMs: 60_000,
      now: () => fakeNow,
      fetchImpl: (async (url) => {
        calls++;
        assert.equal(String(url), "https://api.github.com/repos/musicorbit/musicorbit/releases/latest");
        return new Response(
          JSON.stringify({
            tag_name: calls === 1 ? "v0.2.0" : "v0.3.0",
            name: calls === 1 ? "MusicOrbit 0.2.0" : "MusicOrbit 0.3.0",
            html_url: "https://github.com/musicorbit/musicorbit/releases/tag/v0.2.0",
            published_at: "2026-12-01T00:00:00Z",
            draft: false,
            prerelease: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });

    const first = await checker.check();
    assert.equal(calls, 1);
    assert.equal(first.updateAvailable, true);
    assert.equal(first.latestVersion, "0.2.0");
    assert.equal(first.releaseUrl, "https://github.com/musicorbit/musicorbit/releases/tag/v0.2.0");
    assert.equal(first.error, null);

    // Cached within TTL
    fakeNow += 10_000;
    const cached = await checker.check();
    assert.equal(calls, 1);
    assert.equal(cached.latestVersion, "0.2.0");

    // Force bypasses cache
    const forced = await checker.check({ force: true });
    assert.equal(calls, 2);
    assert.equal(forced.latestVersion, "0.3.0");
  });

  it("treats HTTP 404 (no published releases yet) cleanly as up to date", async () => {
    const checker = new UpdateChecker({
      currentVersion: "0.1.0",
      enabled: true,
      fetchImpl: (async () => new Response("Not Found", { status: 404 })) as typeof fetch,
    });

    const result = await checker.check();
    assert.equal(result.enabled, true);
    assert.equal(result.updateAvailable, false);
    assert.equal(result.latestVersion, null);
    assert.equal(result.error, null);
  });

  it("handles offline/network failures gracefully without throwing", async () => {
    const checker = new UpdateChecker({
      currentVersion: "0.1.0",
      enabled: true,
      fetchImpl: (async () => {
        throw new Error("ENOTFOUND api.github.com");
      }) as typeof fetch,
    });

    const result = await checker.check();
    assert.equal(result.enabled, true);
    assert.equal(result.updateAvailable, false);
    assert.match(result.error ?? "", /ENOTFOUND/);
  });
});

describe("GET /api/system/updates route authorization", () => {
  it("allows Admins and blocks Members with HTTP 403", async () => {
    const root = createTempDir();
    const musicDir = path.join(root, "music");
    const dataDir = path.join(root, "data");
    const downloadsDir = path.join(root, "downloads");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });

    const server = await buildServer(
      {
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
        checkUpdates: true,
        authEnabled: true,
        webDistDir: null,
        slskdUrl: null,
        slskdApiKey: null,
        version: "0.1.0",
      },
      {
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              tag_name: "v0.2.5",
              name: "v0.2.5",
              html_url: "https://github.com/musicorbit/musicorbit/releases/tag/v0.2.5",
              published_at: "2026-12-01T12:00:00Z",
              draft: false,
              prerelease: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )) as typeof fetch,
      },
    );

    try {
      // Create initial admin
      const setupRes = await server.app.inject({
        method: "POST",
        url: "/api/auth/setup",
        payload: { username: "admin", password: "password123" },
      });
      assert.equal(setupRes.statusCode, 201);
      const adminCookie = setupRes.cookies.find((c) => c.name === "musicorbit_session")!;

      // Admin can check updates
      const adminRes = await server.app.inject({
        method: "GET",
        url: "/api/system/updates",
        cookies: { musicorbit_session: adminCookie.value },
      });
      assert.equal(adminRes.statusCode, 200);
      const adminBody = adminRes.json();
      assert.equal(adminBody.updateAvailable, true);
      assert.equal(adminBody.latestVersion, "0.2.5");

      // Create member account and log in as member
      const memberMusicDir = path.join(root, "listener-music");
      fs.mkdirSync(memberMusicDir, { recursive: true });
      const createUserRes = await server.app.inject({
        method: "POST",
        url: "/api/users",
        cookies: { musicorbit_session: adminCookie.value },
        payload: {
          username: "listener",
          password: "password123",
          role: "user",
          musicDir: memberMusicDir,
        },
      });
      assert.equal(createUserRes.statusCode, 201);

      const loginRes = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "listener", password: "password123" },
      });
      assert.equal(loginRes.statusCode, 200);
      const memberCookie = loginRes.cookies.find((c) => c.name === "musicorbit_session")!;

      // Member is forbidden from checking server updates
      const memberRes = await server.app.inject({
        method: "GET",
        url: "/api/system/updates",
        cookies: { musicorbit_session: memberCookie.value },
      });
      assert.equal(memberRes.statusCode, 403);
    } finally {
      await server.app.close();
    }
  });
});
