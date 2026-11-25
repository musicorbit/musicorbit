import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  BulkImportFolderResponse,
  OrganizeApplyResponse,
  OrganizePreviewResponse,
  PlaylistDetailResponse,
  PlaylistSummary,
  SystemSettingsResponse,
  TrackSummary,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import {
  DEFAULT_LIBRARY_ORGANIZATION,
  formatTrackRelativePath,
  getMissingOrganizationTagReason,
} from "./libraryLayout.js";
import { writeAudioTags } from "./tagWriter.js";

function createTestWavBuffer(durationSeconds = 0.25, sampleRate = 8000): Buffer {
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

describe("Library Organization, Folder Presets, Auto-Organize & Bulk Import", () => {
  let tmpRoot: string;
  let musicDir: string;
  let downloadsDir: string;
  let externalDir: string;
  let handle: ServerHandle;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-organizer-"));
    musicDir = path.join(tmpRoot, "music");
    downloadsDir = path.join(tmpRoot, "downloads");
    externalDir = path.join(tmpRoot, "old-collection");
    const dataDir = path.join(tmpRoot, "data");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.mkdirSync(externalDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    // 1. Well-tagged loose track in root of musicDir
    const loosePath = path.join(musicDir, "messy-levitating.wav");
    fs.writeFileSync(loosePath, createTestWavBuffer());
    await writeAudioTags(loosePath, {
      title: "Levitating",
      artist: "Dua Lipa",
      albumArtist: "Dua Lipa",
      album: "Future Nostalgia",
      trackNumber: 5,
      discNumber: 1,
      year: 2020,
      genre: "Pop",
      lyrics: "",
    });

    // 2. Untagged track in root (no tags at all -> Unknown Artist / Unknown Album)
    const untaggedPath = path.join(musicDir, "mystery-demo.wav");
    fs.writeFileSync(untaggedPath, createTestWavBuffer());

    // 3. Conflict pair: two files with identical artist/album/track#/title
    const conflictDir = path.join(musicDir, "Unsorted");
    fs.mkdirSync(conflictDir, { recursive: true });
    const dupA = path.join(conflictDir, "copy-a.wav");
    const dupB = path.join(conflictDir, "copy-b.wav");
    fs.writeFileSync(dupA, createTestWavBuffer());
    fs.writeFileSync(dupB, createTestWavBuffer());
    for (const p of [dupA, dupB]) {
      await writeAudioTags(p, {
        title: "Same Song",
        artist: "Orbit Band",
        albumArtist: "Orbit Band",
        album: "Twin Album",
        trackNumber: 1,
        discNumber: 1,
        year: 2022,
        genre: "Indie",
        lyrics: "",
      });
    }

    // Mock Deezer/MB so external bulk import auto-matches cleanly without real network
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://api.deezer.com/search/track?q=")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 777,
                title: "West Coast",
                artist: { name: "Lana Del Rey" },
                album: { id: 888, title: "Ultraviolence" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("https://api.deezer.com/track/777")) {
        return new Response(
          JSON.stringify({
            id: 777,
            title: "West Coast",
            track_position: 5,
            disk_number: 1,
            release_date: "2014-06-13",
            artist: { name: "Lana Del Rey" },
            album: { id: 888, title: "Ultraviolence", release_date: "2014-06-13" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("https://api.deezer.com/album/888")) {
        return new Response(
          JSON.stringify({
            id: 888,
            title: "Ultraviolence",
            release_date: "2014-06-13",
            artist: { name: "Lana Del Rey" },
            genres: { data: [{ name: "Alternative" }] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("https://musicbrainz.org/ws/2/release/?")) {
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
        dataDir,
        dbPath: path.join(dataDir, "musicorbit.db"),
        musicDir,
        coversDir: path.join(dataDir, "covers"),
        artistImagesDir: path.join(dataDir, "artist-images"),
        downloadsDir,
        autoImportThreshold: 85,
        fetchArtistImages: false,
        authEnabled: false,
        webDistDir: null,
        slskdUrl: null,
        slskdApiKey: null,
        logLevel: "silent",
        version: "0.1.0",
      },
      { fetchImpl: mockFetch, musicBrainzRateLimitMs: 0 },
    );

    await handle.scanner.runScan();
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("formats paths across all presets, modifiers, multi-disc styles, and untagged guardrails", () => {
    const sample = {
      albumArtist: "Pink Floyd",
      trackArtist: "Pink Floyd",
      album: "The Wall",
      title: "Hey You",
      year: 1979,
      trackNumber: 1,
      discNumber: 2,
      hasMultipleDiscs: true,
      extension: ".flac",
    };

    assert.equal(
      formatTrackRelativePath(sample, {
        ...DEFAULT_LIBRARY_ORGANIZATION,
        layoutPreset: "artist_album_track",
        includeYearInAlbumFolder: true,
        includeTrackNumber: true,
        multiDiscStyle: "prefix",
      }),
      path.join("Pink Floyd", "The Wall (1979)", "2-01 - Hey You.flac"),
    );

    assert.equal(
      formatTrackRelativePath(sample, {
        ...DEFAULT_LIBRARY_ORGANIZATION,
        layoutPreset: "artist_album_track",
        includeYearInAlbumFolder: false,
        includeTrackNumber: true,
        multiDiscStyle: "subfolder",
      }),
      path.join("Pink Floyd", "The Wall", "Disc 2", "01 - Hey You.flac"),
    );

    assert.equal(
      formatTrackRelativePath(sample, {
        ...DEFAULT_LIBRARY_ORGANIZATION,
        layoutPreset: "artist_track",
        includeTrackNumber: false,
      }),
      path.join("Pink Floyd", "Hey You.flac"),
    );

    assert.equal(
      formatTrackRelativePath(sample, {
        ...DEFAULT_LIBRARY_ORGANIZATION,
        layoutPreset: "flat",
      }),
      "Pink Floyd - Hey You.flac",
    );

    assert.equal(
      formatTrackRelativePath(sample, {
        ...DEFAULT_LIBRARY_ORGANIZATION,
        layoutPreset: "keep_existing",
      }),
      null,
    );

    assert.equal(
      formatTrackRelativePath(
        sample,
        { ...DEFAULT_LIBRARY_ORGANIZATION, layoutPreset: "keep_existing" },
        { forExternalImport: true },
      ),
      path.join("Pink Floyd", "The Wall", "2-01 - Hey You.flac"),
    );

    assert.ok(
      getMissingOrganizationTagReason(
        { ...sample, albumArtist: "Unknown Artist" },
        "artist_album_track",
      ),
    );
    assert.ok(
      getMissingOrganizationTagReason(
        { ...sample, album: "Unknown Album" },
        "artist_album_track",
      ),
    );
    assert.equal(
      getMissingOrganizationTagReason({ ...sample, album: "Unknown Album" }, "flat"),
      null,
    );
  });

  it("previews & applies organization safely, preserves playlists + .m3u8 sync, and skips untagged/conflicts", async () => {
    // Enable playlist .m3u8 sync and add Levitating to a playlist first
    await handle.app.inject({
      method: "PUT",
      url: "/api/system/playlist-sync",
      payload: { enabled: true },
    });

    const tracksRes = await handle.app.inject({ method: "GET", url: "/api/tracks" });
    const allTracks = tracksRes.json<TrackSummary[]>();
    const levitating = allTracks.find((t) => t.title === "Levitating")!;
    assert.ok(levitating);

    const createPl = await handle.app.inject({
      method: "POST",
      url: "/api/playlists",
      payload: { name: "Favorites" },
    });
    const pl = createPl.json<PlaylistSummary>();
    await handle.app.inject({
      method: "POST",
      url: `/api/playlists/${pl.id}/tracks`,
      payload: { trackIds: [levitating.id] },
    });

    // Configure layout: Artist / Album (Year) / 05 - Title
    const settingsRes = await handle.app.inject({
      method: "PUT",
      url: "/api/system/library-organization",
      payload: {
        layoutPreset: "artist_album_track",
        includeYearInAlbumFolder: true,
        includeTrackNumber: true,
      },
    });
    assert.equal(settingsRes.statusCode, 200);

    // Dry-run preview should move Levitating + 1 of the conflict pair, flag 1 conflict, and skip 1 untagged
    const previewRes = await handle.app.inject({
      method: "GET",
      url: "/api/system/library-organization/preview",
    });
    assert.equal(previewRes.statusCode, 200);
    const preview = previewRes.json<OrganizePreviewResponse>();
    assert.equal(preview.toMoveCount, 2);
    assert.equal(preview.skippedUntaggedCount, 1);
    assert.equal(preview.conflictCount, 1);

    // Apply organization
    const applyRes = await handle.app.inject({
      method: "POST",
      url: "/api/system/library-organization/apply",
      payload: {},
    });
    assert.equal(applyRes.statusCode, 200);
    const applied = applyRes.json<OrganizeApplyResponse>();
    assert.equal(applied.movedCount, 2);
    assert.equal(applied.skippedCount, 1);
    assert.equal(applied.conflictCount, 1);
    assert.equal(applied.errorCount, 0);
    assert.equal(applied.playlistsResynced, true);

    // Verify new file location & untouched untagged file
    const expectedLevitatingPath = path.join(
      musicDir,
      "Dua Lipa",
      "Future Nostalgia (2020)",
      "05 - Levitating.wav",
    );
    assert.ok(fs.existsSync(expectedLevitatingPath));
    assert.ok(!fs.existsSync(path.join(musicDir, "messy-levitating.wav")));
    assert.ok(fs.existsSync(path.join(musicDir, "mystery-demo.wav")));

    // Verify playlist still contains the exact same track ID & .m3u8 file updated its relative path!
    const plDetailRes = await handle.app.inject({
      method: "GET",
      url: `/api/playlists/${pl.id}`,
    });
    const plDetail = plDetailRes.json<PlaylistDetailResponse>();
    assert.equal(plDetail.tracks.length, 1);
    assert.equal(plDetail.tracks[0]?.id, levitating.id);
    assert.equal(plDetail.tracks[0]?.filePath, expectedLevitatingPath);

    const m3u8Path = path.join(musicDir, "Playlists", "Favorites.m3u8");
    assert.ok(fs.existsSync(m3u8Path));
    const m3u8Content = fs.readFileSync(m3u8Path, "utf8");
    assert.ok(
      m3u8Content.includes("../Dua Lipa/Future Nostalgia (2020)/05 - Levitating.wav"),
      `Expected updated relative path in m3u8, got:\n${m3u8Content}`,
    );
  });

  it("supports bulk importing an external folder in copy mode and rejects overlapping musicDir", async () => {
    // Guard: rejecting musicDir itself as bulk import source
    const overlapRes = await handle.app.inject({
      method: "POST",
      url: "/api/imports/bulk-folder",
      payload: { sourceDir: musicDir, fileAction: "copy" },
    });
    assert.equal(overlapRes.statusCode, 400);

    // Switch preset to artist_track to confirm importer respects the user's layout preference!
    await handle.app.inject({
      method: "PUT",
      url: "/api/system/library-organization",
      payload: {
        layoutPreset: "artist_track",
        includeTrackNumber: true,
      },
    });

    const extTrack = path.join(externalDir, "Lana Del Rey - West Coast.wav");
    fs.writeFileSync(extTrack, createTestWavBuffer());
    await writeAudioTags(extTrack, {
      title: "West Coast",
      artist: "Lana Del Rey",
      albumArtist: "Lana Del Rey",
      album: "Ultraviolence",
      trackNumber: 5,
      discNumber: 1,
      year: 2014,
      genre: "Alternative",
      lyrics: "",
    });

    const bulkRes = await handle.app.inject({
      method: "POST",
      url: "/api/imports/bulk-folder",
      payload: { sourceDir: externalDir, fileAction: "copy" },
    });
    assert.equal(bulkRes.statusCode, 200);
    const bulk = bulkRes.json<BulkImportFolderResponse>();
    assert.equal(bulk.autoImported, 1);
    assert.equal(bulk.fileAction, "copy");

    // Original file stays intact in externalDir (copy mode) AND formatted copy lands in artist_track layout
    assert.ok(fs.existsSync(extTrack));
    assert.ok(fs.existsSync(path.join(musicDir, "Lana Del Rey", "05 - West Coast.wav")));
  });

  it("auto-organizes files dropped directly into musicDir on watcher tick when opt-in is enabled", async () => {
    // Enable opt-in auto-organize with flat preset
    const enableRes = await handle.app.inject({
      method: "PUT",
      url: "/api/system/library-organization",
      payload: {
        layoutPreset: "flat",
        autoOrganizeLibrary: true,
      },
    });
    assert.equal(enableRes.statusCode, 200);
    assert.equal(enableRes.json<SystemSettingsResponse>().libraryOrganization.autoOrganizeLibrary, true);

    // Drop a brand-new tagged song in a random subfolder inside musicDir and age mtime > 15s
    const dropDir = path.join(musicDir, "RandomDrop");
    fs.mkdirSync(dropDir, { recursive: true });
    const droppedFile = path.join(dropDir, "temp-name.wav");
    fs.writeFileSync(droppedFile, createTestWavBuffer());
    await writeAudioTags(droppedFile, {
      title: "Afterlife",
      artist: "Avenged Sevenfold",
      albumArtist: "Avenged Sevenfold",
      album: "Avenged Sevenfold",
      trackNumber: 4,
      discNumber: 1,
      year: 2007,
      genre: "Metal",
      lyrics: "",
    });
    const pastTime = new Date(Date.now() - 20_000);
    fs.utimesSync(droppedFile, pastTime, pastTime);

    await handle.inboxWatcher.tick();

    assert.ok(fs.existsSync(path.join(musicDir, "Avenged Sevenfold - Afterlife.wav")));
    assert.ok(!fs.existsSync(droppedFile));
    assert.ok(!fs.existsSync(dropDir));

    // Switching to keep_existing automatically disables autoOrganizeLibrary
    const keepRes = await handle.app.inject({
      method: "PUT",
      url: "/api/system/library-organization",
      payload: { layoutPreset: "keep_existing" },
    });
    assert.equal(keepRes.json<SystemSettingsResponse>().libraryOrganization.autoOrganizeLibrary, false);
  });

  it("cleans nested empty sibling folders, blocks cross-edition duplicates, logs skips once, and quiets idle scans", async () => {
    // 1. Nested empty sibling folder + .DS_Store inside artist folder (Adele/Easy On Me + Adele/30 (2021))
    const adeleDir = path.join(musicDir, "Adele");
    const emptySiblingDir = path.join(adeleDir, "Easy On Me");
    const album30Dir = path.join(adeleDir, "30 (2021)");
    fs.mkdirSync(emptySiblingDir, { recursive: true });
    fs.mkdirSync(album30Dir, { recursive: true });
    fs.writeFileSync(path.join(adeleDir, ".DS_Store"), "junk");

    const easyOnMe = path.join(album30Dir, "02 - Easy On Me.wav");
    fs.writeFileSync(easyOnMe, createTestWavBuffer());
    await writeAudioTags(easyOnMe, {
      title: "Easy On Me",
      artist: "Adele",
      albumArtist: "Adele",
      album: "30",
      trackNumber: 2,
      discNumber: 1,
      year: 2021,
      genre: "Pop",
      lyrics: "",
    });

    await handle.scanner.runScan();

    // Switch to flat layout and apply -> entire Adele/ directory (including empty Easy On Me/ & .DS_Store) is removed!
    await handle.app.inject({
      method: "PUT",
      url: "/api/system/library-organization",
      payload: { layoutPreset: "flat", autoOrganizeLibrary: false },
    });
    await handle.app.inject({
      method: "POST",
      url: "/api/system/library-organization/apply",
      payload: {},
    });
    assert.ok(fs.existsSync(path.join(musicDir, "Adele - Easy On Me.wav")));
    assert.ok(!fs.existsSync(adeleDir), "Expected Adele/ with empty sibling subfolder to be removed");

    // 2. Cross-edition duplicate song detection: existing organized track vs renamed loose copy with different edition album tag
    await handle.app.inject({
      method: "PUT",
      url: "/api/system/library-organization",
      payload: {
        layoutPreset: "artist_album_track",
        includeYearInAlbumFolder: true,
        includeTrackNumber: true,
        autoOrganizeLibrary: true,
      },
    });
    const lanaExistingDir = path.join(
      musicDir,
      "Lana Del Rey",
      "Ultraviolence (deluxe limited edition) (2014)",
    );
    fs.mkdirSync(lanaExistingDir, { recursive: true });
    const existingShades = path.join(lanaExistingDir, "03 - Shades Of Cool.wav");
    fs.writeFileSync(existingShades, createTestWavBuffer());
    await writeAudioTags(existingShades, {
      title: "Shades Of Cool",
      artist: "Lana Del Rey",
      albumArtist: "Lana Del Rey",
      album: "Ultraviolence (deluxe limited edition)",
      trackNumber: 3,
      discNumber: 1,
      year: 2014,
      genre: "Alternative",
      lyrics: "",
    });
    await handle.scanner.runScan();

    // Drop a renamed duplicate with a different edition tag ("Ultraviolence (Deluxe)")
    const randomDup = path.join(musicDir, "random.wav");
    fs.writeFileSync(randomDup, createTestWavBuffer());
    await writeAudioTags(randomDup, {
      title: "Shades Of Cool",
      artist: "Lana Del Rey",
      albumArtist: "Lana Del Rey",
      album: "Ultraviolence (Deluxe)",
      trackNumber: 3,
      discNumber: 1,
      year: 2014,
      genre: "Alternative",
      lyrics: "",
    });
    const pastTime = new Date(Date.now() - 20_000);
    fs.utimesSync(randomDup, pastTime, pastTime);

    await handle.inboxWatcher.tick();

    // Should NOT create a second album folder "Ultraviolence (Deluxe) (2014)"!
    assert.ok(
      !fs.existsSync(path.join(musicDir, "Lana Del Rey", "Ultraviolence (Deluxe) (2014)")),
      "Duplicate song should not create a second album folder",
    );
    assert.ok(fs.existsSync(randomDup));

    // Preview should explicitly flag random.wav as a conflict with the existing library path
    const previewRes = await handle.app.inject({
      method: "GET",
      url: "/api/system/library-organization/preview",
    });
    const preview = previewRes.json<OrganizePreviewResponse>();
    const dupItem = preview.items.find((i) => i.currentRelativePath === "random.wav");
    assert.equal(dupItem?.status, "conflict");
    assert.ok(dupItem?.reason?.includes("Duplicate song"));

    // 3. Running a second idle watcher tick should NOT spam duplicate scanner or organizer logs
    const logCountAfterFirstTick = handle.activityLog.list({ limit: 500 }).total;
    await handle.inboxWatcher.tick();
    const logCountAfterIdleTick = handle.activityLog.list({ limit: 500 }).total;
    assert.equal(logCountAfterIdleTick, logCountAfterFirstTick);
  });
});
