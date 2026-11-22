import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  BrowseDirectoriesResponse,
  HealthResponse,
  ImportM3u8Response,
  MissingTrackBatchJobStatus,
  PlaylistDetailResponse,
  RecheckMissingTracksResponse,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { writeAudioTags } from "../services/tagWriter.js";

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

describe("CSV Playlist Import, Batch Soulseek Search & Dynamic Music Directory", () => {
  let tmpRoot: string;
  let musicDirA: string;
  let musicDirB: string;
  let handle: ServerHandle;
  let activeSlskdSearches = 0;
  let maxConcurrentSlskdSearches = 0;
  let deletedSearchCount = 0;
  const enqueuedDownloads: Array<{ username: string; filename: string }> = [];

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-csv-dir-"));
    musicDirA = path.join(tmpRoot, "music-a");
    musicDirB = path.join(tmpRoot, "music-b");
    fs.mkdirSync(path.join(musicDirA, "Adele", "30"), { recursive: true });
    fs.mkdirSync(path.join(musicDirB, "Daft Punk", "Discovery"), { recursive: true });

    const fileA = path.join(musicDirA, "Adele", "30", "01 - Easy On Me.wav");
    const fileB = path.join(musicDirB, "Daft Punk", "Discovery", "01 - One More Time.wav");
    fs.writeFileSync(fileA, createMinimalWav());
    fs.writeFileSync(fileB, createMinimalWav());
    writeAudioTags(fileA, {
      title: "Easy On Me",
      artist: "Adele",
      albumArtist: "Adele",
      album: "30",
      year: 2021,
      trackNumber: 1,
      discNumber: 1,
    });
    writeAudioTags(fileB, {
      title: "One More Time",
      artist: "Daft Punk",
      albumArtist: "Daft Punk",
      album: "Discovery",
      year: 2001,
      trackNumber: 1,
      discNumber: 1,
    });

    let searchSeq = 0;
    const searchQueries = new Map<string, string>();

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/v0/searches") && method === "POST") {
        searchSeq += 1;
        const id = `search-${searchSeq}`;
        const body = JSON.parse(String(init?.body ?? "{}")) as { searchText?: string };
        searchQueries.set(id, body.searchText ?? "");
        activeSlskdSearches += 1;
        maxConcurrentSlskdSearches = Math.max(maxConcurrentSlskdSearches, activeSlskdSearches);
        return new Response(
          JSON.stringify({ id, searchText: body.searchText ?? "", state: "InProgress", isComplete: false }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      const resMatch = /\/api\/v0\/searches\/([^/]+)\/responses$/.exec(url);
      if (resMatch?.[1] && method === "GET") {
        const q = (searchQueries.get(resMatch[1]) ?? "").toLowerCase();
        const responses = q.includes("unknown song")
          ? []
          : [
              {
                username: "losslesspeer",
                hasFreeUploadSlot: true,
                uploadSpeed: 500_000,
                queueLength: 0,
                files: [
                  {
                    filename: `@@music\\Artist\\Album\\01 - ${searchQueries.get(resMatch[1])}.flac`,
                    size: 28_000_000,
                    bitRate: 1020,
                    extension: "flac",
                  },
                ],
              },
            ];
        return new Response(JSON.stringify(responses), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const statusMatch = /\/api\/v0\/searches\/([^/]+)$/.exec(url);
      if (statusMatch?.[1] && method === "GET") {
        return new Response(
          JSON.stringify({
            id: statusMatch[1],
            searchText: searchQueries.get(statusMatch[1]) ?? "",
            state: "Completed",
            isComplete: true,
            responseCount: 1,
            fileCount: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (statusMatch?.[1] && method === "DELETE") {
        activeSlskdSearches = Math.max(0, activeSlskdSearches - 1);
        deletedSearchCount += 1;
        return new Response(null, { status: 204 });
      }

      const dlMatch = /\/api\/v0\/transfers\/downloads\/([^/]+)$/.exec(url);
      if (dlMatch?.[1] && method === "POST") {
        const files = JSON.parse(String(init?.body ?? "[]")) as Array<{ filename: string }>;
        for (const f of files) {
          enqueuedDownloads.push({ username: decodeURIComponent(dlMatch[1]), filename: f.filename });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }

      return new Response("Not Found", { status: 404 });
    };

    handle = await buildServer(
      {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        musicDir: musicDirA,
        dataDir: path.join(tmpRoot, "data"),
        downloadsDir: path.join(tmpRoot, "downloads"),
        autoImportThreshold: 85,
        dbPath: path.join(tmpRoot, "data", "musicorbit.db"),
        coversDir: path.join(tmpRoot, "data", "covers"),
        artistImagesDir: path.join(tmpRoot, "data", "artist-images"),
        fetchArtistImages: false,
        authEnabled: false,
        webDistDir: null,
        slskdUrl: "http://mock-slskd.local:5030",
        slskdApiKey: "test-key",
        version: "0.1.0",
      },
      {
        fetchImpl: mockFetch,
        batchSearchStaggerMs: 0,
        batchSearchPollMs: 10,
      },
    );

    await handle.scanner.runScan();
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("imports an Exportify Spotify CSV, matches local tracks, and persists missing tracks", async () => {
    const csv = [
      "Track URI,Track Name,Album Name,Artist Name(s),Release Date",
      'spotify:track:1,"Easy On Me","30","Adele",2021-10-15',
      'spotify:track:2,"One More Time","Discovery","Daft Punk",2000-11-30',
      'spotify:track:3,"Supermassive Black Hole","Black Holes and Revelations","Muse",2006-06-19',
      'spotify:track:4,"Unknown Song That Does Not Exist","None","Ghost Artist",2024-01-01',
    ].join("\n");

    const importRes = await handle.app.inject({
      method: "POST",
      url: "/api/playlists/import",
      payload: { name: "Spotify Mix", content: csv, format: "csv" },
    });
    assert.equal(importRes.statusCode, 201);
    const imported = importRes.json<ImportM3u8Response>();
    assert.equal(imported.format, "csv");
    assert.equal(imported.matchedCount, 1);
    assert.equal(imported.missingCount, 3);
    assert.equal(imported.playlist.missingCount, 3);

    // Run rate-limited batch search with concurrency = 2
    const startRes = await handle.app.inject({
      method: "POST",
      url: `/api/playlists/${imported.playlist.id}/missing/search-batch`,
      payload: { concurrency: 2 },
    });
    assert.equal(startRes.statusCode, 202);

    // Wait briefly for the fast mock batch to complete
    let batchStatus: MissingTrackBatchJobStatus | null = null;
    for (let i = 0; i < 40; i += 1) {
      const poll = await handle.app.inject({
        method: "GET",
        url: `/api/playlists/${imported.playlist.id}/missing/search-batch`,
      });
      batchStatus = poll.json<MissingTrackBatchJobStatus>();
      if (batchStatus.state === "completed") break;
      await new Promise((r) => setTimeout(r, 15));
    }

    assert.ok(batchStatus);
    assert.equal(batchStatus.state, "completed");
    assert.equal(batchStatus.concurrencyLimit, 2);
    assert.equal(batchStatus.foundCount, 2);
    assert.equal(batchStatus.notFoundCount, 1);
    assert.ok(maxConcurrentSlskdSearches <= 2, `Exceeded concurrency limit: ${maxConcurrentSlskdSearches}`);
    assert.equal(deletedSearchCount, 3);

    // Enqueue a found missing track download and verify it flips to "queued"
    const foundItem = batchStatus.items.find((i) => i.state === "found");
    assert.ok(foundItem && foundItem.candidates[0]);
    const dlRes = await handle.app.inject({
      method: "POST",
      url: `/api/playlists/${imported.playlist.id}/missing/${foundItem.missingTrackId}/download`,
      payload: {
        username: foundItem.candidates[0].username,
        filename: foundItem.candidates[0].filename,
        size: foundItem.candidates[0].size,
      },
    });
    assert.equal(dlRes.statusCode, 202);
    assert.equal(enqueuedDownloads.length, 1);

    const detailAfterDl = await handle.app.inject({
      method: "GET",
      url: `/api/playlists/${imported.playlist.id}`,
    });
    const detail = detailAfterDl.json<PlaylistDetailResponse>();
    const queuedRow = detail.missingTracks.find((m) => m.id === foundItem.missingTrackId);
    assert.equal(queuedRow?.status, "queued");
  });

  it("browses directories, switches musicDir via API, persists in SQLite, and re-checks missing tracks", async () => {
    const browseRes = await handle.app.inject({
      method: "GET",
      url: `/api/system/browse-dirs?path=${encodeURIComponent(tmpRoot)}`,
    });
    assert.equal(browseRes.statusCode, 200);
    const browse = browseRes.json<BrowseDirectoriesResponse>();
    assert.equal(browse.exists, true);
    assert.ok(browse.directories.some((d) => d.name === "music-b"));

    // Reject nonexistent path
    const badRes = await handle.app.inject({
      method: "PUT",
      url: "/api/system/music-dir",
      payload: { path: path.join(tmpRoot, "does-not-exist"), scanNow: false },
    });
    assert.equal(badRes.statusCode, 400);

    // Switch to musicDirB without auto-scan so we can await runScan() deterministically
    const updateRes = await handle.app.inject({
      method: "PUT",
      url: "/api/system/music-dir",
      payload: { path: musicDirB, scanNow: false },
    });
    assert.equal(updateRes.statusCode, 200);
    const updated = updateRes.json<SystemSettingsResponse>();
    assert.equal(updated.musicDir, musicDirB);
    assert.equal(updated.isOverridden, true);

    // Health endpoint immediately reflects new musicDir
    const healthRes = await handle.app.inject({ method: "GET", url: "/api/health" });
    assert.equal(healthRes.json<HealthResponse>().musicDir.path, musicDirB);

    // Scanning now indexes musicDirB ("One More Time" by Daft Punk)
    await handle.scanner.runScan();

    // Re-checking missing tracks on Spotify Mix (id 1) matches "One More Time"!
    const recheckRes = await handle.app.inject({
      method: "POST",
      url: "/api/playlists/1/recheck-missing",
    });
    assert.equal(recheckRes.statusCode, 200);
    const rechecked = recheckRes.json<RecheckMissingTracksResponse>();
    assert.equal(rechecked.newlyMatchedCount, 1);
    assert.equal(rechecked.remainingMissingCount, 2);
  });
});
