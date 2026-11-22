import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AlbumSummary, TrackMetadataResponse, TrackSummary } from "@musicorbit/shared";
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

describe("On-Demand Track Metadata Editor Routes", () => {
  let tmpRoot: string;
  let handle: ServerHandle;
  let trackId: number;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-meta-"));
    const musicDir = path.join(tmpRoot, "music");
    const dataDir = path.join(tmpRoot, "data");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.writeFileSync(path.join(musicDir, "song.wav"), createMinimalWav());

    handle = await buildServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      musicDir,
      dataDir,
      downloadsDir: path.join(tmpRoot, "downloads"),
      autoImportThreshold: 85,
      dbPath: path.join(dataDir, "musicorbit.db"),
      coversDir: path.join(dataDir, "covers"),
      artistImagesDir: path.join(dataDir, "artist-images"),
      fetchArtistImages: false,
      slskdUrl: null,
      slskdApiKey: null,
      version: "0.1.0",
    });

    await handle.scanner.runScan();
    const tracksRes = await handle.app.inject({ method: "GET", url: "/api/tracks" });
    trackId = tracksRes.json<TrackSummary[]>()[0]!.id;
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("reads and writes all editable track metadata fields and updates SQLite", async () => {
    const initialRes = await handle.app.inject({
      method: "GET",
      url: `/api/tracks/${trackId}/metadata`,
    });
    assert.equal(initialRes.statusCode, 200);
    const initial = initialRes.json<TrackMetadataResponse>();
    assert.equal(initial.basename, "song.wav");
    assert.equal(initial.technical.sampleRate, 8000);

    const updateRes = await handle.app.inject({
      method: "PUT",
      url: `/api/tracks/${trackId}/metadata`,
      payload: {
        title: "Easy On Me",
        artists: "Adele",
        albumArtist: "Adele",
        album: "30",
        trackNumber: 2,
        trackTotal: 12,
        discNumber: 1,
        discTotal: 1,
        year: 2021,
        genres: "Pop, Soul",
        composers: "Adele Adkins, Greg Kurstin",
        bpm: 142,
        grouping: "Favorites",
        publisher: "Columbia",
        comment: "Cleaned via MusicOrbit",
        lyrics: "There ain't no gold in this river",
        musicBrainzTrackId: "mb-track-1",
        musicBrainzReleaseId: "mb-rel-1",
        musicBrainzArtistId: "mb-art-1",
        musicBrainzReleaseArtistId: "mb-art-1",
      },
    });
    assert.equal(updateRes.statusCode, 200);
    const updated = updateRes.json<TrackMetadataResponse>();
    assert.equal(updated.tags.title, "Easy On Me");
    assert.equal(updated.tags.album, "30");
    assert.equal(updated.tags.year, 2021);
    assert.equal(updated.tags.trackNumber, 2);
    assert.equal(updated.tags.genres, "Pop, Soul");
    assert.equal(updated.tags.composers, "Adele Adkins, Greg Kurstin");
    assert.equal(updated.tags.bpm, 142);
    assert.equal(updated.tags.comment, "Cleaned via MusicOrbit");
    assert.equal(updated.tags.lyrics, "There ain't no gold in this river");

    // Verify SQLite album & track listings immediately reflect the rewritten tags
    const albumsRes = await handle.app.inject({ method: "GET", url: "/api/albums" });
    const album = albumsRes.json<AlbumSummary[]>()[0];
    assert.equal(album?.title, "30");
    assert.equal(album?.artistName, "Adele");
    assert.equal(album?.year, 2021);
  });

  it("embeds and removes cover art directly inside the audio file", async () => {
    const fakeJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    const putRes = await handle.app.inject({
      method: "PUT",
      url: `/api/tracks/${trackId}/cover`,
      headers: { "content-type": "image/jpeg" },
      payload: fakeJpg,
    });
    assert.equal(putRes.statusCode, 200);
    const withCover = putRes.json<TrackMetadataResponse>();
    assert.equal(withCover.hasEmbeddedCover, true);

    const delRes = await handle.app.inject({
      method: "DELETE",
      url: `/api/tracks/${trackId}/cover`,
    });
    assert.equal(delRes.statusCode, 200);
    assert.equal(delRes.json<TrackMetadataResponse>().hasEmbeddedCover, false);
  });
});
