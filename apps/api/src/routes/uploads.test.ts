import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  FinalizeUploadBatchResponse,
  StartUploadBatchResponse,
  TrackSummary,
  UploadFileResponse,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { writeAudioTags } from "../services/tagWriter.js";
import { sanitizeUploadRelativePath } from "./uploads.js";

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

describe("Browser Direct Music Upload Routes", () => {
  let tmpRoot: string;
  let musicDir: string;
  let dataDir: string;
  let handle: ServerHandle;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-uploads-"));
    musicDir = path.join(tmpRoot, "music");
    const downloadsDir = path.join(tmpRoot, "downloads");
    dataDir = path.join(tmpRoot, "data");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://api.deezer.com/search/track?q=")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 505,
                title: "Levitating",
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
            album: { id: 606, title: "Future Nostalgia", release_date: "2020-03-27" },
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
      {
        fetchImpl: mockFetch,
        musicBrainzRateLimitMs: 0,
        maxUploadFileBytes: 64 * 1024, // 64 KB cap in test so we can verify 413 cleanly
      },
    );
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("sanitizes upload paths and rejects traversal or unsupported extensions", () => {
    assert.equal(
      sanitizeUploadRelativePath("Future Nostalgia/05 - Levitating.flac"),
      path.join("Future Nostalgia", "05 - Levitating.flac"),
    );
    assert.equal(sanitizeUploadRelativePath("../escape.flac"), null);
    assert.equal(sanitizeUploadRelativePath("Album/../../secret.mp3"), null);
    assert.equal(sanitizeUploadRelativePath("malware.exe"), null);
    assert.equal(sanitizeUploadRelativePath("Album/cover.jpg"), path.join("Album", "cover.jpg"));
    assert.equal(sanitizeUploadRelativePath("Album/song.lrc"), path.join("Album", "song.lrc"));
  });

  it("streams an uploaded song, auto-imports into library layout, and cleans up staging", async () => {
    // Prepare a tagged WAV buffer to upload
    const sourceWav = path.join(tmpRoot, "upload-source.wav");
    fs.writeFileSync(sourceWav, createTestWavBuffer());
    await writeAudioTags(sourceWav, {
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
    const wavBytes = fs.readFileSync(sourceWav);

    // 1. Start batch
    const startRes = await handle.app.inject({ method: "POST", url: "/api/uploads/start" });
    assert.equal(startRes.statusCode, 200);
    const { batchId } = startRes.json<StartUploadBatchResponse>();
    assert.ok(batchId);

    // 2. Upload binary stream
    const uploadRes = await handle.app.inject({
      method: "POST",
      url: `/api/uploads/${batchId}/file`,
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-relative-path": encodeURIComponent("Levitating.wav"),
      },
      payload: wavBytes,
    });
    assert.equal(uploadRes.statusCode, 200);
    const uploaded = uploadRes.json<UploadFileResponse>();
    assert.equal(uploaded.relativePath, "Levitating.wav");
    assert.equal(uploaded.sizeBytes, wavBytes.length);

    // 3. Finalize -> post-processes & moves into MUSIC_DIR
    const finRes = await handle.app.inject({
      method: "POST",
      url: `/api/uploads/${batchId}/finalize`,
    });
    assert.equal(finRes.statusCode, 200);
    const fin = finRes.json<FinalizeUploadBatchResponse>();
    assert.equal(fin.uploadedFiles, 1);
    assert.equal(fin.autoImported, 1);

    // Track is indexed in SQLite and moved to formatted path; staging batch dir is cleaned up
    const expectedPath = path.join(musicDir, "Dua Lipa", "Future Nostalgia", "05 - Levitating.wav");
    assert.ok(fs.existsSync(expectedPath));
    assert.ok(!fs.existsSync(path.join(dataDir, "uploads", batchId)));

    const tracksRes = await handle.app.inject({ method: "GET", url: "/api/tracks" });
    const tracksList = tracksRes.json<TrackSummary[]>();
    assert.equal(tracksList.length, 1);
    assert.equal(tracksList[0]?.title, "Levitating");
  });

  it("enforces extension checks, path traversal rejection, size limits, and cancel cleanup", async () => {
    const startRes = await handle.app.inject({ method: "POST", url: "/api/uploads/start" });
    const { batchId } = startRes.json<StartUploadBatchResponse>();

    // Reject unsupported extension
    const badExt = await handle.app.inject({
      method: "POST",
      url: `/api/uploads/${batchId}/file`,
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-relative-path": encodeURIComponent("script.sh"),
      },
      payload: Buffer.from("#!/bin/sh"),
    });
    assert.equal(badExt.statusCode, 400);

    // Reject path traversal
    const badPath = await handle.app.inject({
      method: "POST",
      url: `/api/uploads/${batchId}/file`,
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-relative-path": encodeURIComponent("../evil.wav"),
      },
      payload: createTestWavBuffer(),
    });
    assert.equal(badPath.statusCode, 400);

    // Reject oversized file (cap is 64 KB in test)
    const oversized = await handle.app.inject({
      method: "POST",
      url: `/api/uploads/${batchId}/file`,
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-relative-path": encodeURIComponent("huge.flac"),
      },
      payload: Buffer.alloc(70 * 1024, 1),
    });
    assert.equal(oversized.statusCode, 413);

    // Cancel removes staging folder cleanly
    const delRes = await handle.app.inject({
      method: "DELETE",
      url: `/api/uploads/${batchId}`,
    });
    assert.equal(delRes.statusCode, 200);
    assert.ok(!fs.existsSync(path.join(dataDir, "uploads", batchId)));
  });
});
