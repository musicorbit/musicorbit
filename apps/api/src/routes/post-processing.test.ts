import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  ImportM3u8Response,
  InboxScanResult,
  PlaylistDetailResponse,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { computeAudioQualityScore } from "../services/importer.js";
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

describe("Post-Processing Pipeline (Single-Track, Backfill, Stability, Settings)", () => {
  let tmpRoot: string;
  let musicDir: string;
  let downloadsDir: string;
  let dataDir: string;
  let handle: ServerHandle;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-pp-"));
    musicDir = path.join(tmpRoot, "music");
    downloadsDir = path.join(tmpRoot, "downloads");
    dataDir = path.join(tmpRoot, "data");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      // MusicBrainz returns no release matches so single-track Deezer mode kicks in cleanly
      if (url.includes("musicbrainz.org/ws/2/release")) {
        return new Response(JSON.stringify({ releases: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      // Deezer track search returns a confident match for "Digital Love" by Daft Punk
      if (url.includes("api.deezer.com/search")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 3135556,
                title: "Digital Love",
                track_position: 3,
                disk_number: 1,
                artist: { id: 27, name: "Daft Punk" },
                album: {
                  id: 302127,
                  title: "Discovery",
                  cover_xl: "https://e-cdns-images.dzcdn.net/images/cover/abc/1000x1000.jpg",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("api.deezer.com/track/3135556")) {
        return new Response(
          JSON.stringify({
            id: 3135556,
            title: "Digital Love",
            track_position: 3,
            disk_number: 1,
            release_date: "2001-03-12",
            bpm: 124,
            artist: { id: 27, name: "Daft Punk" },
            album: {
              id: 302127,
              title: "Discovery",
              release_date: "2001-03-12",
              genres: { data: [{ name: "Electronic" }] },
              cover_xl: "https://e-cdns-images.dzcdn.net/images/cover/abc/1000x1000.jpg",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("dzcdn.net/images/cover")) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }

      return new Response("Not Found", { status: 404 });
    };

    handle = await buildServer(
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
        authEnabled: false,
        webDistDir: null,
        slskdUrl: null,
        slskdApiKey: null,
        version: "0.1.0",
      },
      { fetchImpl: mockFetch, musicBrainzRateLimitMs: 0 },
    );
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("ranks lossless audio above lossy formats for duplicate quality comparisons", () => {
    const flac = computeAudioQualityScore("FLAC", 1020000);
    const opus160 = computeAudioQualityScore("opus", 160000);
    const mp3320 = computeAudioQualityScore("mp3", 320000);
    const mp3128 = computeAudioQualityScore("mp3", 128000);
    assert.ok(flac > mp3320);
    assert.ok(mp3320 > opus160);
    assert.ok(opus160 > mp3128);
  });

  it("updates post-processing settings via API, auto-imports a single track via Deezer, and backfills missing playlist tracks", async () => {
    // Enable year-in-folder naming & copy mode first
    const ppRes = await handle.app.inject({
      method: "PUT",
      url: "/api/system/post-processing",
      payload: {
        includeYearInAlbumFolder: true,
        fileAction: "copy",
        duplicatePolicy: "skip",
        autoWatchEnabled: false,
      },
    });
    assert.equal(ppRes.statusCode, 200);
    const sys = ppRes.json<SystemSettingsResponse>();
    assert.equal(sys.postProcessing.includeYearInAlbumFolder, true);
    assert.equal(sys.postProcessing.fileAction, "copy");
    assert.equal(sys.postProcessing.duplicatePolicy, "skip");

    // 1. Create a playlist via CSV containing "Digital Love" (currently missing from library)
    const csv = [
      "Track Name,Artist Name(s),Album Name",
      '"Digital Love","Daft Punk","Discovery"',
    ].join("\n");
    const importPlRes = await handle.app.inject({
      method: "POST",
      url: "/api/playlists/import",
      payload: { name: "French House", content: csv, format: "csv" },
    });
    assert.equal(importPlRes.statusCode, 201);
    const pl = importPlRes.json<ImportM3u8Response>();
    assert.equal(pl.matchedCount, 0);
    assert.equal(pl.missingCount, 1);

    // 2. Drop a single downloaded track in DOWNLOADS_DIR (plus an incomplete folder with .part to verify stability guard)
    const singleDir = path.join(downloadsDir, "Daft Punk - Digital Love");
    fs.mkdirSync(singleDir, { recursive: true });
    const singleFile = path.join(singleDir, "03 - Digital Love.wav");
    fs.writeFileSync(singleFile, createMinimalWav());
    writeAudioTags(singleFile, {
      title: "Digital Love",
      artist: "Daft Punk",
      albumArtist: "Daft Punk",
      album: "Discovery",
      year: 2001,
      trackNumber: 3,
      discNumber: 1,
    });

    const partialDir = path.join(downloadsDir, "Still Downloading");
    fs.mkdirSync(partialDir, { recursive: true });
    fs.writeFileSync(path.join(partialDir, "01 - Track.wav"), createMinimalWav());
    fs.writeFileSync(path.join(partialDir, "02 - Track.flac.part"), Buffer.from("partial"));

    // Watcher tick (requireStableFiles: true) must skip newly written / .part folders
    const watcherSkipped = await handle.importer.scanInbox({
      requireStableFiles: true,
      stabilityWindowMs: 60_000,
    });
    assert.equal(watcherSkipped.autoImported, 0);
    assert.equal(watcherSkipped.skipped, 2);

    // Clean up partial folder and run immediate inbox scan
    fs.rmSync(partialDir, { recursive: true, force: true });
    const scanRes = await handle.app.inject({ method: "POST", url: "/api/imports/scan" });
    assert.equal(scanRes.statusCode, 200);
    const summary = scanRes.json<InboxScanResult>();
    assert.equal(summary.autoImported, 1);

    // File organized with Album (Year) and original kept intact because fileAction === "copy"
    const expectedDest = path.join(musicDir, "Daft Punk", "Discovery (2001)", "03 - Digital Love.wav");
    assert.ok(fs.existsSync(expectedDest));
    assert.ok(fs.existsSync(singleFile));

    // Re-running scan must skip the already-copied folder (no duplicate re-import!)
    const secondScan = await handle.app.inject({ method: "POST", url: "/api/imports/scan" });
    assert.equal(secondScan.json<InboxScanResult>().skipped, 1);

    // Playlist "French House" was AUTOMATICALLY backfilled: 1 track playable, 0 missing!
    const plDetailRes = await handle.app.inject({
      method: "GET",
      url: `/api/playlists/${pl.playlist.id}`,
    });
    const plDetail = plDetailRes.json<PlaylistDetailResponse>();
    assert.equal(plDetail.tracks.length, 1);
    assert.equal(plDetail.tracks[0]?.title, "Digital Love");
    assert.equal(plDetail.missingTracks.length, 0);
  });

  it("handles loose root files in downloads/, cleans up .DS_Store folders, and never renames a single track to its album name", async () => {
    // Switch back to move mode and disable year-in-folder
    await handle.app.inject({
      method: "PUT",
      url: "/api/system/post-processing",
      payload: {
        fileAction: "move",
        duplicatePolicy: "review",
        includeYearInAlbumFolder: false,
      },
    });

    // 1. Loose file dropped directly at the root of downloads/ (outside any subfolder)
    const looseFile = path.join(downloadsDir, "Lana Del Rey - West Coast.wav");
    fs.writeFileSync(looseFile, createMinimalWav());
    writeAudioTags(looseFile, {
      title: "West Coast",
      artist: "Lana Del Rey",
      albumArtist: "Various Artists", // Compilation tag should NOT override track artist on a single!
      album: "Ultraviolence",
      year: 2014,
      trackNumber: 8,
      discNumber: 1,
    });

    // 2. Folder containing a single track + macOS .DS_Store junk file
    const dsDir = path.join(downloadsDir, "Folder With DSStore");
    fs.mkdirSync(dsDir, { recursive: true });
    fs.writeFileSync(path.join(dsDir, ".DS_Store"), Buffer.from("junk"));
    const dsTrack = path.join(dsDir, "Digital Love.wav");
    fs.writeFileSync(dsTrack, createMinimalWav());
    writeAudioTags(dsTrack, {
      title: "Digital Love",
      artist: "Daft Punk",
      albumArtist: "Daft Punk",
      album: "Discovery",
      year: 2001,
      trackNumber: 3,
      discNumber: 1,
    });

    const scanRes = await handle.app.inject({ method: "POST", url: "/api/imports/scan" });
    assert.equal(scanRes.statusCode, 200);

    // Check Review Queue items: loose file detected artist "Lana Del Rey" (not Various Artists)
    // and Digital Love duplicate detected with existing duplicate info
    const importsRes = await handle.app.inject({
      method: "GET",
      url: "/api/imports?status=needs_review",
    });
    const list = importsRes.json<{
      items: Array<{
        id: number;
        folderName: string;
        detectedArtist: string;
        files: Array<{ filePath: string; currentTitle: string; currentArtist: string }>;
        duplicates?: Array<{ existingTitle: string }>;
      }>;
    }>();

    const looseItem = list.items.find((i) => i.folderName === "Lana Del Rey - West Coast.wav");
    assert.ok(looseItem, "Loose root audio file must appear as its own import item");
    assert.equal(looseItem.detectedArtist, "Lana Del Rey");
    assert.equal(looseItem.files[0]?.currentTitle, "West Coast");

    const dupItem = list.items.find((i) => i.folderName === "Folder With DSStore");
    assert.ok(dupItem);
    assert.equal(dupItem.duplicates?.[0]?.existingTitle, "Digital Love");

    // Approve duplicate with duplicateResolution: "replace" -> replaces cleanly & deletes .DS_Store folder!
    const applyRes = await handle.app.inject({
      method: "POST",
      url: `/api/imports/${dupItem.id}/apply`,
      payload: {
        artist: "Daft Punk",
        album: "Discovery",
        year: 2001,
        duplicateResolution: "replace",
        tracks: [
          {
            filePath: dupItem.files[0]!.filePath,
            title: "Digital Love",
            artist: "Daft Punk",
            trackNumber: 3,
            discNumber: 1,
          },
        ],
      },
    });
    assert.equal(applyRes.statusCode, 200);
    assert.equal(fs.existsSync(dsDir), false, "Folder with leftover .DS_Store must be removed");

    // Verify only ONE "Digital Love" exists in SQLite (no duplicate left behind!)
    const tracksRes = await handle.app.inject({ method: "GET", url: "/api/tracks?q=Digital+Love" });
    assert.equal(tracksRes.json<Array<{ title: string }>>().length, 1);

    // Verify the old empty "Discovery (2001)" folder inside musicDir was cleanly removed
    assert.equal(
      fs.existsSync(path.join(musicDir, "Daft Punk", "Discovery (2001)")),
      false,
      "Empty old album folder inside musicDir must be removed after replacing/upgrading track",
    );

    // Verify "French House" playlist STILL has "Digital Love" (migrated seamlessly to the new track ID!)
    const playlistsRes = await handle.app.inject({ method: "GET", url: "/api/playlists" });
    const frenchHouse = playlistsRes
      .json<Array<{ id: number; name: string }>>()
      .find((p) => p.name === "French House");
    assert.ok(frenchHouse);
    const plAfterReplace = await handle.app.inject({
      method: "GET",
      url: `/api/playlists/${frenchHouse.id}`,
    });
    const plDetailAfter = plAfterReplace.json<PlaylistDetailResponse>();
    assert.equal(plDetailAfter.tracks.length, 1);
    assert.equal(plDetailAfter.tracks[0]?.title, "Digital Love");

    // Verify GET /api/imports/lookup-track endpoint works for Review Queue song diffing
    const lookupRes = await handle.app.inject({
      method: "GET",
      url: "/api/imports/lookup-track?provider=deezer&title=Digital+Love&artist=Daft+Punk",
    });
    assert.equal(lookupRes.statusCode, 200);
    assert.equal(lookupRes.json<Array<{ title: string }>>()[0]?.title, "Digital Love");

    // Verify Activity Logs captured startup, imports, scanner, and supports filtering/export/clear
    const logsRes = await handle.app.inject({ method: "GET", url: "/api/system/logs" });
    assert.equal(logsRes.statusCode, 200);
    const logs = logsRes.json<{ total: number; entries: Array<{ category: string; message: string }> }>();
    assert.ok(logs.total >= 4, "Activity logs should record startup, settings, imports, and scans");
    assert.ok(logs.entries.some((e) => e.category === "importer"));
    assert.ok(logs.entries.some((e) => e.category === "scanner"));

    const filteredRes = await handle.app.inject({
      method: "GET",
      url: "/api/system/logs?category=importer&q=Digital+Love",
    });
    assert.equal(filteredRes.statusCode, 200);
    assert.ok(filteredRes.json<{ entries: unknown[] }>().entries.length >= 1);

    const exportRes = await handle.app.inject({ method: "GET", url: "/api/system/logs/export" });
    assert.equal(exportRes.statusCode, 200);
    assert.ok(exportRes.body.includes("[importer]"));

    const clearRes = await handle.app.inject({ method: "DELETE", url: "/api/system/logs" });
    assert.equal(clearRes.statusCode, 200);
    const afterClear = await handle.app.inject({ method: "GET", url: "/api/system/logs" });
    assert.equal(afterClear.json<{ total: number }>().total, 0);
  });
});
