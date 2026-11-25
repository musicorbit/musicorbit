import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  LyricsLibraryStatsResponse,
  TrackLyricsResponse,
  TrackSummary,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { getSidecarLrcPath, parseLrc } from "./lyrics.js";
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

describe("Synced Sing-Along Lyrics (LRCLIB, .lrc Sidecars, Organizer & Batch Fetch)", () => {
  let tmpRoot: string;
  let musicDir: string;
  let handle: ServerHandle;
  let levitatingId: number;
  let instrumentalId: number;
  let lrclibFetchCount = 0;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-lyrics-"));
    musicDir = path.join(tmpRoot, "music");
    const downloadsDir = path.join(tmpRoot, "downloads");
    const dataDir = path.join(tmpRoot, "data");
    fs.mkdirSync(path.join(musicDir, "Dua Lipa", "Future Nostalgia"), { recursive: true });
    fs.mkdirSync(path.join(musicDir, "Ambient Band", "Drift"), { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const trackA = path.join(musicDir, "Dua Lipa", "Future Nostalgia", "05 - Levitating.wav");
    fs.writeFileSync(trackA, createTestWavBuffer());
    await writeAudioTags(trackA, {
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

    const trackB = path.join(musicDir, "Ambient Band", "Drift", "01 - Horizon.wav");
    fs.writeFileSync(trackB, createTestWavBuffer());
    await writeAudioTags(trackB, {
      title: "Horizon",
      artist: "Ambient Band",
      albumArtist: "Ambient Band",
      album: "Drift",
      trackNumber: 1,
      discNumber: 1,
      year: 2023,
      genre: "Ambient",
      lyrics: "",
    });

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://lrclib.net/api/get")) {
        lrclibFetchCount++;
        const parsed = new URL(url);
        const title = parsed.searchParams.get("track_name") ?? "";
        if (title === "Levitating") {
          return new Response(
            JSON.stringify({
              id: 101,
              trackName: "Levitating",
              artistName: "Dua Lipa",
              albumName: "Future Nostalgia",
              duration: 203,
              instrumental: false,
              syncedLyrics:
                "[00:08.50]If you wanna run away with me\n[00:12.00]I know a galaxy and I can take you for a ride\n",
              plainLyrics:
                "If you wanna run away with me\nI know a galaxy and I can take you for a ride",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (title === "Horizon") {
          return new Response(
            JSON.stringify({
              id: 202,
              trackName: "Horizon",
              artistName: "Ambient Band",
              instrumental: true,
              syncedLyrics: null,
              plainLyrics: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (title === "West Coast") {
          return new Response(
            JSON.stringify({
              id: 303,
              trackName: "West Coast",
              artistName: "Lana Del Rey",
              albumName: "Ultraviolence",
              duration: 256,
              instrumental: false,
              syncedLyrics: "[00:15.00]Down on the West Coast they got a sayin'\n",
              plainLyrics: "Down on the West Coast they got a sayin'",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not Found", { status: 404 });
      }
      if (url.startsWith("https://lrclib.net/api/search")) {
        lrclibFetchCount++;
        return new Response(JSON.stringify([]), {
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
      { fetchImpl: mockFetch, lyricsBatchDelayMs: 0 },
    );

    await handle.scanner.runScan();
    const tracksRes = await handle.app.inject({ method: "GET", url: "/api/tracks" });
    const list = tracksRes.json<TrackSummary[]>();
    levitatingId = list.find((t) => t.title === "Levitating")!.id;
    instrumentalId = list.find((t) => t.title === "Horizon")!.id;
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("parses standard, millisecond, multi-timestamp, and offset LRC lines accurately", () => {
    const raw = [
      "[ar:Dua Lipa]",
      "[offset:500]",
      "[00:10.50][01:05.250]Repeated chorus line",
      "[00:05.00]First verse",
    ].join("\n");

    const parsed = parseLrc(raw);
    assert.equal(parsed.length, 3);
    assert.deepEqual(parsed[0], { timeSeconds: 4.5, text: "First verse" });
    assert.deepEqual(parsed[1], { timeSeconds: 10, text: "Repeated chorus line" });
    assert.deepEqual(parsed[2], { timeSeconds: 64.75, text: "Repeated chorus line" });
  });

  it("fetches synced lyrics from LRCLIB, writes .lrc sidecar, caches, and moves sidecar on organize", async () => {
    const res = await handle.app.inject({
      method: "GET",
      url: `/api/tracks/${levitatingId}/lyrics`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json<TrackLyricsResponse>();

    assert.equal(body.hasSynced, true);
    assert.equal(body.source, "lrclib");
    assert.equal(body.syncedLines.length, 2);
    assert.equal(body.syncedLines[0]?.timeSeconds, 8.5);
    assert.equal(body.syncedLines[0]?.text, "If you wanna run away with me");

    // Verify .lrc sidecar was written next to the audio file
    const originalLrc = getSidecarLrcPath(
      path.join(musicDir, "Dua Lipa", "Future Nostalgia", "05 - Levitating.wav"),
    );
    assert.ok(fs.existsSync(originalLrc));
    assert.equal(body.lrcPath, originalLrc);

    // Repeat request uses local .lrc sidecar / SQLite cache with ZERO external fetches
    const fetchesBefore = lrclibFetchCount;
    const secondRes = await handle.app.inject({
      method: "GET",
      url: `/api/tracks/${levitatingId}/lyrics`,
    });
    assert.equal(secondRes.statusCode, 200);
    assert.equal(lrclibFetchCount, fetchesBefore);
    assert.equal(secondRes.json<TrackLyricsResponse>().source, "sidecar");

    // Reorganize library to flat layout -> .lrc sidecar must move alongside the audio file & old folder cleans up!
    await handle.app.inject({
      method: "PUT",
      url: "/api/system/library-organization",
      payload: { layoutPreset: "flat" },
    });
    await handle.app.inject({
      method: "POST",
      url: "/api/system/library-organization/apply",
      payload: {},
    });

    const movedAudio = path.join(musicDir, "Dua Lipa - Levitating.wav");
    const movedLrc = path.join(musicDir, "Dua Lipa - Levitating.lrc");
    assert.ok(fs.existsSync(movedAudio));
    assert.ok(fs.existsSync(movedLrc), "Expected .lrc sidecar to move alongside audio file");
    assert.ok(!fs.existsSync(originalLrc));
    assert.ok(!fs.existsSync(path.join(musicDir, "Dua Lipa")));
  });

  it("runs batch fetch for remaining missing tracks and reports coverage stats", async () => {
    const startRes = await handle.app.inject({
      method: "POST",
      url: "/api/system/lyrics/fetch-missing",
      payload: {},
    });
    assert.ok(startRes.statusCode === 200 || startRes.statusCode === 202);

    // Wait briefly for the 0ms-delay background job to finish
    let stats: LyricsLibraryStatsResponse | null = null;
    for (let i = 0; i < 30; i++) {
      const sRes = await handle.app.inject({ method: "GET", url: "/api/system/lyrics/status" });
      stats = sRes.json<LyricsLibraryStatsResponse>();
      if (stats.job.state !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.ok(stats);
    assert.equal(stats.totalTracks, 2);
    assert.equal(stats.withSyncedLyrics, 1);
    assert.equal(stats.instrumental, 1);
    assert.equal(stats.missingLyrics, 0);

    // Instrumental track should report instrumental: true cleanly
    const instRes = await handle.app.inject({
      method: "GET",
      url: `/api/tracks/${instrumentalId}/lyrics`,
    });
    assert.equal(instRes.json<TrackLyricsResponse>().instrumental, true);
  });

  it("automatically fetches .lrc sidecar for newly scanned tracks when autoFetchLyrics is enabled", async () => {
    await handle.app.inject({
      method: "PUT",
      url: "/api/system/post-processing",
      payload: { autoFetchLyrics: true },
    });

    const newTrackPath = path.join(musicDir, "Lana Del Rey - West Coast.wav");
    fs.writeFileSync(newTrackPath, createTestWavBuffer());
    await writeAudioTags(newTrackPath, {
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

    await handle.scanner.runScan();

    // Wait briefly for the background onTracksAdded lyrics fetch to write the .lrc sidecar
    const expectedLrc = getSidecarLrcPath(newTrackPath);
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(expectedLrc)) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.ok(fs.existsSync(expectedLrc), "Expected .lrc sidecar to be auto-fetched on scan");
    assert.ok(fs.readFileSync(expectedLrc, "utf8").includes("Down on the West Coast"));
  });
});
