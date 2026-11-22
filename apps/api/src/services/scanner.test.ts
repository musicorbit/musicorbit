import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  AlbumDetailResponse,
  AlbumSummary,
  ArtistSummary,
  TrackSummary,
} from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { makeSortName } from "./scanner.js";

/**
 * Builds a minimal valid PCM WAV buffer with a RIFF INFO metadata chunk
 * so music-metadata can parse tags and duration without external fixtures.
 */
function createSyntheticWav(tags: {
  title: string;
  artist: string;
  album: string;
  year?: string;
}): Buffer {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = 800; // 0.1 seconds
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);

  // Build LIST/INFO subchunks
  const infoParts: Buffer[] = [Buffer.from("INFO", "ascii")];
  const addInfo = (id: string, value: string) => {
    const strBuf = Buffer.from(`${value}\0`, "utf8");
    const paddedLen = strBuf.length + (strBuf.length % 2);
    const chunk = Buffer.alloc(8 + paddedLen);
    chunk.write(id, 0, 4, "ascii");
    chunk.writeUInt32LE(strBuf.length, 4);
    strBuf.copy(chunk, 8);
    infoParts.push(chunk);
  };

  addInfo("INAM", tags.title);
  addInfo("IART", tags.artist);
  addInfo("IPRD", tags.album);
  if (tags.year) addInfo("ICRD", tags.year);

  const listPayload = Buffer.concat(infoParts);
  const listChunk = Buffer.alloc(8 + listPayload.length);
  listChunk.write("LIST", 0, 4, "ascii");
  listChunk.writeUInt32LE(listPayload.length, 4);
  listPayload.copy(listChunk, 8);

  const fmtChunk = Buffer.alloc(24);
  fmtChunk.write("fmt ", 0, 4, "ascii");
  fmtChunk.writeUInt32LE(16, 4); // PCM chunk size
  fmtChunk.writeUInt16LE(1, 8); // PCM format
  fmtChunk.writeUInt16LE(numChannels, 10);
  fmtChunk.writeUInt32LE(sampleRate, 12);
  fmtChunk.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 16);
  fmtChunk.writeUInt16LE(numChannels * (bitsPerSample / 8), 20);
  fmtChunk.writeUInt16LE(bitsPerSample, 22);

  const dataChunk = Buffer.alloc(8 + dataSize);
  dataChunk.write("data", 0, 4, "ascii");
  dataChunk.writeUInt32LE(dataSize, 4);

  const body = Buffer.concat([fmtChunk, dataChunk, listChunk]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WAVE", 8, 4, "ascii");

  return Buffer.concat([header, body]);
}

describe("LibraryScanner & Library API", () => {
  let tmpRoot: string;
  let musicDir: string;
  let dataDir: string;
  let coversDir: string;
  let handle: ServerHandle;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-test-"));
    musicDir = path.join(tmpRoot, "music");
    dataDir = path.join(tmpRoot, "data");
    coversDir = path.join(dataDir, "covers");

    const albumDir = path.join(musicDir, "The Orbiters", "First Light");
    fs.mkdirSync(albumDir, { recursive: true });

    fs.writeFileSync(
      path.join(albumDir, "01 - Sunrise.wav"),
      createSyntheticWav({
        title: "Sunrise",
        artist: "The Orbiters",
        album: "First Light",
        year: "2025",
      }),
    );
    fs.writeFileSync(
      path.join(albumDir, "02 - Horizon.wav"),
      createSyntheticWav({
        title: "Horizon",
        artist: "The Orbiters",
        album: "First Light",
        year: "2025",
      }),
    );
    // Minimal dummy cover image in album directory
    fs.writeFileSync(path.join(albumDir, "cover.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    handle = await buildServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      musicDir,
      dataDir,
      dbPath: path.join(dataDir, "musicorbit.db"),
      coversDir,
      version: "0.1.0",
    });
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("formats sort names cleanly", () => {
    assert.equal(makeSortName("The Beatles"), "Beatles, The");
    assert.equal(makeSortName("A Perfect Circle"), "Perfect Circle, A");
    assert.equal(makeSortName("Daft Punk"), "Daft Punk");
  });

  it("scans audio files, extracts metadata & cover art, and serves them via REST API", async () => {
    const first = await handle.scanner.runScan();
    assert.equal(first.state, "completed");
    assert.equal(first.filesTotal, 2);
    assert.equal(first.filesAdded, 2);
    assert.equal(first.filesSkipped, 0);
    assert.equal(first.errors.length, 0);

    // Artists endpoint
    const artistsRes = await handle.app.inject({ method: "GET", url: "/api/artists" });
    assert.equal(artistsRes.statusCode, 200);
    const artistsList = artistsRes.json<ArtistSummary[]>();
    assert.equal(artistsList.length, 1);
    assert.equal(artistsList[0]?.name, "The Orbiters");
    assert.equal(artistsList[0]?.sortName, "Orbiters, The");
    assert.equal(artistsList[0]?.albumCount, 1);
    assert.equal(artistsList[0]?.trackCount, 2);

    // Albums endpoint + cached cover hash
    const albumsRes = await handle.app.inject({ method: "GET", url: "/api/albums" });
    assert.equal(albumsRes.statusCode, 200);
    const albumsList = albumsRes.json<AlbumSummary[]>();
    assert.equal(albumsList.length, 1);
    const album = albumsList[0]!;
    assert.equal(album.title, "First Light");
    assert.equal(album.year, 2025);
    assert.equal(album.trackCount, 2);
    assert.ok(album.coverHash);
    assert.ok(album.coverHash.endsWith(".jpg"));
    assert.ok(fs.existsSync(path.join(coversDir, album.coverHash)));

    // Album detail endpoint
    const detailRes = await handle.app.inject({ method: "GET", url: `/api/albums/${album.id}` });
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.json<AlbumDetailResponse>();
    assert.equal(detail.tracks.length, 2);
    assert.deepEqual(
      detail.tracks.map((t) => t.title),
      ["Horizon", "Sunrise"],
    );

    // Search query on tracks
    const searchRes = await handle.app.inject({ method: "GET", url: "/api/tracks?q=sun" });
    assert.equal(searchRes.statusCode, 200);
    const searched = searchRes.json<TrackSummary[]>();
    assert.equal(searched.length, 1);
    assert.equal(searched[0]?.title, "Sunrise");
  });

  it("skips unchanged files on incremental rescan and re-indexes on forced rescan", async () => {
    const incremental = await handle.scanner.runScan();
    assert.equal(incremental.state, "completed");
    assert.equal(incremental.filesSkipped, 2);
    assert.equal(incremental.filesAdded, 0);
    assert.equal(incremental.filesUpdated, 0);

    const forced = await handle.scanner.runScan({ force: true });
    assert.equal(forced.state, "completed");
    assert.equal(forced.filesSkipped, 0);
    assert.equal(forced.filesUpdated, 2);
  });

  it("prunes deleted tracks and orphaned albums/artists", async () => {
    const albumDir = path.join(musicDir, "The Orbiters", "First Light");
    fs.unlinkSync(path.join(albumDir, "02 - Horizon.wav"));

    const afterOneDelete = await handle.scanner.runScan();
    assert.equal(afterOneDelete.filesRemoved, 1);
    assert.equal(afterOneDelete.filesSkipped, 1);

    fs.unlinkSync(path.join(albumDir, "01 - Sunrise.wav"));
    const afterAllDeleted = await handle.scanner.runScan();
    assert.equal(afterAllDeleted.filesRemoved, 1);

    const artistsRes = await handle.app.inject({ method: "GET", url: "/api/artists" });
    assert.equal(artistsRes.json<ArtistSummary[]>().length, 0);

    const albumsRes = await handle.app.inject({ method: "GET", url: "/api/albums" });
    assert.equal(albumsRes.json<AlbumSummary[]>().length, 0);
  });
});
