import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  AcquisitionStatusResponse,
  DownloadsListResponse,
  SoulseekSearchResultsResponse,
  SoulseekSearchSummary,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { groupSearchResponses, splitSoulseekPath } from "../services/acquisition/slskd.js";

describe("slskd Acquisition Service & Routes", () => {
  let tmpRoot: string;
  let unconfiguredHandle: ServerHandle;
  let configuredHandle: ServerHandle;
  const capturedRequests: Array<{ method: string; url: string; apiKey: string | null }> = [];

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-acq-"));

    unconfiguredHandle = await buildServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      musicDir: path.join(tmpRoot, "music-1"),
      dataDir: path.join(tmpRoot, "data-1"),
      downloadsDir: path.join(tmpRoot, "downloads-1"),
      autoImportThreshold: 85,
      dbPath: path.join(tmpRoot, "data-1", "musicorbit.db"),
      coversDir: path.join(tmpRoot, "data-1", "covers"),
      artistImagesDir: path.join(tmpRoot, "data-1", "artist-images"),
      fetchArtistImages: false,
      authEnabled: false,
      webDistDir: null,
      slskdUrl: null,
      slskdApiKey: null,
      version: "0.1.0",
    });

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      capturedRequests.push({ method, url, apiKey: headers.get("X-API-Key") });

      if (url.endsWith("/api/v0/application")) {
        return new Response(
          JSON.stringify({
            version: { full: "0.22.3" },
            server: { state: "Connected, LoggedIn", isConnected: true, isLoggedIn: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (method === "POST" && url.endsWith("/api/v0/searches")) {
        return new Response(
          JSON.stringify({
            id: "search-123",
            searchText: "Adele 30",
            state: "InProgress",
            isComplete: false,
            responseCount: 0,
            fileCount: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (method === "GET" && url.endsWith("/api/v0/searches/search-123")) {
        return new Response(
          JSON.stringify({
            id: "search-123",
            searchText: "Adele 30",
            state: "Completed, TimedOut",
            isComplete: true,
            responseCount: 2,
            fileCount: 4,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (method === "GET" && url.endsWith("/api/v0/searches/search-123/responses")) {
        return new Response(
          JSON.stringify([
            {
              username: "mp3peer",
              hasFreeUploadSlot: false,
              uploadSpeed: 200_000,
              queueLength: 10,
              files: [
                {
                  filename: "@@music\\Adele\\30 (MP3)\\01 - Strangers.mp3",
                  size: 8_000_000,
                  bitRate: 320,
                  length: 180,
                },
                {
                  filename: "@@music\\Adele\\30 (MP3)\\cover.jpg",
                  size: 120_000,
                },
              ],
            },
            {
              username: "flacpeer",
              hasFreeUploadSlot: true,
              uploadSpeed: 2_500_000,
              queueLength: 0,
              files: [
                {
                  filename: "@@lossless\\Adele - 30 (2021) [FLAC]\\01 - Strangers.flac",
                  size: 28_000_000,
                  bitRate: 980,
                  sampleRate: 44100,
                  bitDepth: 16,
                  length: 180,
                },
                {
                  filename: "@@lossless\\Adele - 30 (2021) [FLAC]\\02 - Easy On Me.flac",
                  size: 30_000_000,
                  bitRate: 1010,
                  sampleRate: 44100,
                  bitDepth: 16,
                  length: 224,
                },
              ],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (method === "POST" && url.includes("/api/v0/transfers/downloads/flacpeer")) {
        return new Response(null, { status: 201 });
      }

      if (method === "GET" && url.endsWith("/api/v0/transfers/downloads")) {
        return new Response(
          JSON.stringify([
            {
              username: "flacpeer",
              directories: [
                {
                  directory: "@@lossless\\Adele - 30 (2021) [FLAC]",
                  files: [
                    {
                      id: "tx-1",
                      username: "flacpeer",
                      filename: "@@lossless\\Adele - 30 (2021) [FLAC]\\02 - Easy On Me.flac",
                      size: 30_000_000,
                      bytesTransferred: 15_000_000,
                      percentComplete: 50,
                      averageSpeed: 1_200_000,
                      state: "InProgress",
                      requestedAt: "2026-11-22T12:00:00Z",
                    },
                    {
                      id: "tx-2",
                      username: "flacpeer",
                      filename: "@@lossless\\Adele - 30 (2021) [FLAC]\\01 - Strangers.flac",
                      size: 28_000_000,
                      bytesTransferred: 28_000_000,
                      percentComplete: 100,
                      averageSpeed: 1_500_000,
                      state: "Completed, Succeeded",
                      requestedAt: "2026-11-22T11:59:00Z",
                      endedAt: "2026-11-22T11:59:30Z",
                    },
                  ],
                },
              ],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response("Not found", { status: 404 });
    };

    configuredHandle = await buildServer(
      {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        musicDir: path.join(tmpRoot, "music-2"),
        dataDir: path.join(tmpRoot, "data-2"),
        downloadsDir: path.join(tmpRoot, "downloads-2"),
        autoImportThreshold: 85,
        dbPath: path.join(tmpRoot, "data-2", "musicorbit.db"),
        coversDir: path.join(tmpRoot, "data-2", "covers"),
        artistImagesDir: path.join(tmpRoot, "data-2", "artist-images"),
        fetchArtistImages: false,
        authEnabled: false,
        webDistDir: null,
        slskdUrl: "http://slskd.local:5030",
        slskdApiKey: "test-secret-key",
        version: "0.1.0",
      },
      { fetchImpl: mockFetch },
    );
  });

  after(async () => {
    await unconfiguredHandle.app.close();
    await configuredHandle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("splits Soulseek Windows and Unix paths cleanly", () => {
    assert.deepEqual(splitSoulseekPath("@@music\\Adele\\30\\01.flac"), {
      directoryPath: "@@music\\Adele\\30",
      folderName: "30",
      basename: "01.flac",
    });
    assert.deepEqual(splitSoulseekPath("/share/Artist/Album/track.opus"), {
      directoryPath: "share\\Artist\\Album",
      folderName: "Album",
      basename: "track.opus",
    });
  });

  it("groups audio files by folder, ignores non-audio files, and ranks FLAC + free-slot peers first", () => {
    const groups = groupSearchResponses([
      {
        username: "slowmp3",
        hasFreeUploadSlot: false,
        uploadSpeed: 50_000,
        queueLength: 20,
        files: [
          { filename: "a\\Album\\01.mp3", size: 5_000_000, bitRate: 192 },
          { filename: "a\\Album\\notes.txt", size: 500 },
        ],
      },
      {
        username: "fastflac",
        hasFreeUploadSlot: true,
        uploadSpeed: 3_000_000,
        queueLength: 0,
        files: [
          { filename: "b\\Album FLAC\\01.flac", size: 25_000_000, bitRate: 950 },
          { filename: "b\\Album FLAC\\02.flac", size: 27_000_000, bitRate: 980 },
        ],
      },
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.username, "fastflac");
    assert.equal(groups[0]?.format, "FLAC");
    assert.equal(groups[0]?.isLossless, true);
    assert.equal(groups[0]?.trackCount, 2);
    assert.equal(groups[1]?.username, "slowmp3");
    assert.equal(groups[1]?.trackCount, 1); // notes.txt filtered out
  });

  it("reports unconfigured status cleanly when SLSKD_URL is unset", async () => {
    const statusRes = await unconfiguredHandle.app.inject({
      method: "GET",
      url: "/api/acquisition/status",
    });
    assert.equal(statusRes.statusCode, 200);
    const body = statusRes.json<AcquisitionStatusResponse>();
    assert.equal(body.configured, false);
    assert.equal(body.connected, false);

    const searchRes = await unconfiguredHandle.app.inject({
      method: "POST",
      url: "/api/acquisition/search",
      payload: { query: "Adele" },
    });
    assert.equal(searchRes.statusCode, 503);
  });

  it("searches, ranks results, enqueues downloads, and lists/clears transfers via slskd", async () => {
    // 1. Status check
    const statusRes = await configuredHandle.app.inject({
      method: "GET",
      url: "/api/acquisition/status",
    });
    assert.equal(statusRes.statusCode, 200);
    const status = statusRes.json<AcquisitionStatusResponse>();
    assert.equal(status.configured, true);
    assert.equal(status.connected, true);
    assert.equal(status.version, "0.22.3");

    // 2. Start search
    const startRes = await configuredHandle.app.inject({
      method: "POST",
      url: "/api/acquisition/search",
      payload: { query: "Adele 30" },
    });
    assert.equal(startRes.statusCode, 201);
    const started = startRes.json<SoulseekSearchSummary>();
    assert.equal(started.id, "search-123");

    // 3. Poll grouped search results
    const resultsRes = await configuredHandle.app.inject({
      method: "GET",
      url: "/api/acquisition/search/search-123",
    });
    assert.equal(resultsRes.statusCode, 200);
    const results = resultsRes.json<SoulseekSearchResultsResponse>();
    assert.equal(results.search.isComplete, true);
    assert.equal(results.groups.length, 2);
    assert.equal(results.groups[0]?.username, "flacpeer");
    assert.equal(results.groups[0]?.isLossless, true);
    assert.equal(results.groups[1]?.trackCount, 1); // cover.jpg skipped

    // 4. Enqueue album download
    const dlRes = await configuredHandle.app.inject({
      method: "POST",
      url: "/api/acquisition/downloads",
      payload: {
        username: "flacpeer",
        files: results.groups[0]!.files.map((f) => ({ filename: f.filename, size: f.size })),
      },
    });
    assert.equal(dlRes.statusCode, 202);

    // 5. List transfers
    const listRes = await configuredHandle.app.inject({
      method: "GET",
      url: "/api/acquisition/downloads",
    });
    assert.equal(listRes.statusCode, 200);
    const list = listRes.json<DownloadsListResponse>();
    assert.equal(list.activeCount, 1);
    assert.equal(list.completedCount, 1);
    assert.equal(list.transfers[0]?.id, "tx-1"); // Active transfer sorted first

    // 6. Clear completed & verify X-API-Key header was sent
    const clearRes = await configuredHandle.app.inject({
      method: "DELETE",
      url: "/api/acquisition/downloads/completed",
    });
    assert.equal(clearRes.statusCode, 204);
    assert.ok(capturedRequests.every((r) => r.apiKey === "test-secret-key"));
  });

  it("supports configuring, testing, persisting, and disconnecting slskd from the UI without .env", async () => {
    const uiDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-slskd-ui-"));
    const musicDir = path.join(uiDir, "music");
    const dataDir = path.join(uiDir, "data");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const seenKeys: Array<string | null> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);
      seenKeys.push(headers.get("X-API-Key"));
      if (url.endsWith("/api/v0/application")) {
        if (headers.get("X-API-Key") !== "ui-secret-99") {
          return new Response("Unauthorized", { status: 401 });
        }
        return new Response(
          JSON.stringify({ version: { full: "0.22.9" }, server: { isConnected: true, isLoggedIn: true } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    };

    const makeServer = () =>
      buildServer(
        {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          musicDir,
          dataDir,
          downloadsDir: path.join(uiDir, "downloads"),
          autoImportThreshold: 85,
          dbPath: path.join(dataDir, "musicorbit.db"),
          coversDir: path.join(dataDir, "covers"),
          artistImagesDir: path.join(dataDir, "artist-images"),
          fetchArtistImages: false,
          authEnabled: false,
          webDistDir: null,
          slskdUrl: null,
          slskdApiKey: null,
          version: "0.1.0",
        },
        { fetchImpl: mockFetch },
      );

    let handle = await makeServer();
    try {
      // 1. Test candidate credentials before saving (should not mutate live config)
      const testRes = await handle.app.inject({
        method: "POST",
        url: "/api/system/slskd/test",
        payload: { url: "http://slskd.ui:5030/", apiKey: "ui-secret-99" },
      });
      assert.equal(testRes.statusCode, 200);
      const tested = testRes.json<AcquisitionStatusResponse>();
      assert.equal(tested.connected, true);
      assert.equal(tested.version, "0.22.9");
      assert.equal(tested.url, "http://slskd.ui:5030");
      assert.equal(JSON.stringify(tested).includes("ui-secret-99"), false);

      // Still unconfigured before saving
      const beforeStatus = (
        await handle.app.inject({ method: "GET", url: "/api/acquisition/status" })
      ).json<AcquisitionStatusResponse>();
      assert.equal(beforeStatus.configured, false);

      // 2. Reject invalid protocol
      const badRes = await handle.app.inject({
        method: "PUT",
        url: "/api/system/slskd",
        payload: { url: "ftp://slskd.ui:5030" },
      });
      assert.equal(badRes.statusCode, 400);

      // 3. Save in UI (SQLite) — takes effect immediately
      const saveRes = await handle.app.inject({
        method: "PUT",
        url: "/api/system/slskd",
        payload: { url: "http://slskd.ui:5030", apiKey: "ui-secret-99" },
      });
      assert.equal(saveRes.statusCode, 200);
      const saved = saveRes.json<AcquisitionStatusResponse>();
      assert.equal(saved.configured, true);
      assert.equal(saved.connected, true);
      assert.equal(saved.hasApiKey, true);
      assert.equal(saved.source, "ui");
      assert.equal(JSON.stringify(saved).includes("ui-secret-99"), false);

      // 4. Updating URL with omitted API key preserves the saved key
      const urlUpdateRes = await handle.app.inject({
        method: "PUT",
        url: "/api/system/slskd",
        payload: { url: "http://slskd.ui:5030/" },
      });
      assert.equal(urlUpdateRes.statusCode, 200);
      assert.equal(urlUpdateRes.json<AcquisitionStatusResponse>().connected, true);

      // 5. Persists across restart with no .env variables
      await handle.app.close();
      handle = await makeServer();
      const afterRestart = (
        await handle.app.inject({ method: "GET", url: "/api/acquisition/status" })
      ).json<AcquisitionStatusResponse>();
      assert.equal(afterRestart.configured, true);
      assert.equal(afterRestart.connected, true);
      assert.equal(afterRestart.source, "ui");
      assert.equal(afterRestart.hasApiKey, true);

      // 6. Disconnect clears config
      const discRes = await handle.app.inject({
        method: "PUT",
        url: "/api/system/slskd",
        payload: { url: "", clearApiKey: true },
      });
      assert.equal(discRes.statusCode, 200);
      const disc = discRes.json<AcquisitionStatusResponse>();
      assert.equal(disc.configured, false);
      assert.equal(disc.hasApiKey, false);
      assert.ok(seenKeys.includes("ui-secret-99"));
    } finally {
      await handle.app.close();
      fs.rmSync(uiDir, { recursive: true, force: true });
    }
  });
});
