import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  AlbumSummary,
  ApplyImportResponse,
  ImportsListResponse,
  InboxScanResult,
  MusicBrainzReleaseCandidate,
  MusicBrainzReleaseDetail,
  RetagAlbumResponse,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { parseFolderHints, sanitizePathSegment } from "../services/importer.js";

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

describe("Import Pipeline, MusicBrainz & Review Queue", () => {
  let tmpRoot: string;
  let musicDir: string;
  let downloadsDir: string;
  let handle: ServerHandle;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-import-"));
    musicDir = path.join(tmpRoot, "music");
    downloadsDir = path.join(tmpRoot, "downloads");
    const dataDir = path.join(tmpRoot, "data");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("musicbrainz.org/ws/2/release/?query=")) {
        const decoded = decodeURIComponent(url).toLowerCase();
        // High-confidence exact match for "Discovery"
        if (decoded.includes("discovery")) {
          return new Response(
            JSON.stringify({
              releases: [
                {
                  id: "mb-release-discovery-1",
                  title: "Discovery",
                  score: 100,
                  date: "2001-03-12",
                  country: "FR",
                  "track-count": 2,
                  "artist-credit": [{ name: "Daft Punk", artist: { id: "mb-dp", name: "Daft Punk" } }],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        // Low-confidence / mismatched track count for "Mystery Rip"
        return new Response(
          JSON.stringify({
            releases: [
              {
                id: "mb-release-mystery-1",
                title: "Mystery Album",
                score: 65,
                date: "2023-05-01",
                country: "US",
                "track-count": 10,
                "artist-credit": [
                  { name: "Mystery Band", artist: { id: "mb-mb", name: "Mystery Band" } },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("musicbrainz.org/ws/2/release/mb-release-discovery-1")) {
        return new Response(
          JSON.stringify({
            id: "mb-release-discovery-1",
            title: "Discovery",
            date: "2001-03-12",
            country: "FR",
            "artist-credit": [{ name: "Daft Punk", artist: { id: "mb-dp", name: "Daft Punk" } }],
            media: [
              {
                position: 1,
                tracks: [
                  {
                    position: 1,
                    title: "One More Time",
                    length: 320000,
                    recording: { id: "rec-1", title: "One More Time" },
                  },
                  {
                    position: 2,
                    title: "Aerodynamic",
                    length: 212000,
                    recording: { id: "rec-2", title: "Aerodynamic" },
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not found", { status: 404 });
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

  it("parses artist/album/year hints from Soulseek folder names and sanitizes path segments", () => {
    assert.deepEqual(parseFolderHints("Daft Punk - Discovery (2001) [FLAC]"), {
      artist: "Daft Punk",
      album: "Discovery",
      year: 2001,
    });
    assert.equal(sanitizePathSegment('AC/DC: "Back*In?Black"'), "AC DC Back In Black");
  });

  it("auto-imports high-confidence albums and queues uncertain albums for review", async () => {
    // 1. High-confidence folder (exact 2-track match for Discovery)
    const dpDir = path.join(downloadsDir, "Daft Punk - Discovery (2001) [FLAC]");
    fs.mkdirSync(dpDir, { recursive: true });
    fs.writeFileSync(path.join(dpDir, "01.wav"), createMinimalWav());
    fs.writeFileSync(path.join(dpDir, "02.wav"), createMinimalWav());

    // 2. Low-confidence folder (1 track vs 10-track candidate -> must go to Review Queue)
    const mysteryDir = path.join(downloadsDir, "Mystery Rip");
    fs.mkdirSync(mysteryDir, { recursive: true });
    fs.writeFileSync(path.join(mysteryDir, "track_a.wav"), createMinimalWav());

    const scanRes = await handle.app.inject({ method: "POST", url: "/api/imports/scan" });
    assert.equal(scanRes.statusCode, 200);
    const summary = scanRes.json<InboxScanResult>();
    assert.equal(summary.discoveredFolders, 2);
    assert.equal(summary.autoImported, 1);
    assert.equal(summary.needsReview, 1);

    // Discovery should already be tagged, moved into MUSIC_DIR/Daft Punk/Discovery, and indexed!
    assert.ok(fs.existsSync(path.join(musicDir, "Daft Punk", "Discovery", "01 - One More Time.wav")));
    assert.ok(fs.existsSync(path.join(musicDir, "Daft Punk", "Discovery", "02 - Aerodynamic.wav")));
    assert.equal(fs.existsSync(dpDir), false); // Empty inbox folder cleaned up

    const albumsRes = await handle.app.inject({ method: "GET", url: "/api/albums" });
    const albumsList = albumsRes.json<AlbumSummary[]>();
    assert.equal(albumsList.length, 1);
    assert.equal(albumsList[0]?.title, "Discovery");
    assert.equal(albumsList[0]?.artistName, "Daft Punk");
    assert.equal(albumsList[0]?.year, 2001);

    // Mystery Rip should be waiting in the Review Queue
    const importsRes = await handle.app.inject({ method: "GET", url: "/api/imports" });
    assert.equal(importsRes.statusCode, 200);
    const importsList = importsRes.json<ImportsListResponse>();
    assert.equal(importsList.needsReviewCount, 1);
    const reviewItem = importsList.items.find((i) => i.status === "needs_review");
    assert.ok(reviewItem);
    assert.equal(reviewItem.folderName, "Mystery Rip");
    assert.equal(reviewItem.candidates.length, 1);

    // Manually approve & apply tags to the Review Queue item
    const applyRes = await handle.app.inject({
      method: "POST",
      url: `/api/imports/${reviewItem.id}/apply`,
      payload: {
        artist: "Mystery Band",
        album: "Mystery Album",
        year: 2023,
        mbid: "mb-release-mystery-1",
        tracks: [
          {
            filePath: reviewItem.files[0]!.filePath,
            title: "Opening Track",
            trackNumber: 1,
            discNumber: 1,
          },
        ],
      },
    });
    assert.equal(applyRes.statusCode, 200);
    const applied = applyRes.json<ApplyImportResponse>();
    assert.equal(applied.filesImported, 1);
    assert.ok(
      fs.existsSync(path.join(musicDir, "Mystery Band", "Mystery Album", "01 - Opening Track.wav")),
    );
  });

  it("supports MusicBrainz search/detail endpoints and retagging an existing library album", async () => {
    const searchRes = await handle.app.inject({
      method: "GET",
      url: "/api/musicbrainz/search?artist=Daft+Punk&album=Discovery&trackCount=2",
    });
    assert.equal(searchRes.statusCode, 200);
    const cands = searchRes.json<MusicBrainzReleaseCandidate[]>();
    assert.equal(cands[0]?.mbid, "mb-release-discovery-1");

    const detailRes = await handle.app.inject({
      method: "GET",
      url: "/api/musicbrainz/releases/mb-release-discovery-1",
    });
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.json<MusicBrainzReleaseDetail>();
    assert.equal(detail.tracks.length, 2);

    // Retag the Mystery Album in place
    const albumsRes = await handle.app.inject({ method: "GET", url: "/api/albums" });
    const mystery = albumsRes.json<AlbumSummary[]>().find((a) => a.title === "Mystery Album");
    assert.ok(mystery);

    const albumDetailRes = await handle.app.inject({
      method: "GET",
      url: `/api/albums/${mystery.id}`,
    });
    const trackFilePath = albumDetailRes.json<{ tracks: Array<{ filePath: string }> }>().tracks[0]!
      .filePath;

    const retagRes = await handle.app.inject({
      method: "POST",
      url: `/api/albums/${mystery.id}/retag`,
      payload: {
        artist: "Mystery Band",
        album: "Mystery Album (Remastered)",
        year: 2024,
        tracks: [
          {
            filePath: trackFilePath,
            title: "Opening Track (Remastered)",
            trackNumber: 1,
            discNumber: 1,
          },
        ],
      },
    });
    assert.equal(retagRes.statusCode, 200);
    assert.equal(retagRes.json<RetagAlbumResponse>().filesUpdated, 1);

    const refreshed = await handle.app.inject({ method: "GET", url: "/api/albums" });
    assert.ok(
      refreshed.json<AlbumSummary[]>().some((a) => a.title === "Mystery Album (Remastered)"),
    );
  });
});
