import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AlbumSummary, ArtistSummary, TrackSummary } from "@musicorbit/shared";
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
  // Write a recognizable pattern into PCM data so range slices can be verified byte-for-byte
  for (let i = 0; i < dataSize; i++) {
    buf[44 + i] = i % 251;
  }
  return buf;
}

describe("Media streaming & cover art routes", () => {
  let tmpRoot: string;
  let handle: ServerHandle;
  let wavBytes: Buffer;
  let coverBytes: Buffer;
  let portraitBytes: Buffer;
  let trackId: number;
  let albumId: number;
  let artistId: number;
  let mockFetchCalls = 0;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-media-"));
    const musicDir = path.join(tmpRoot, "music");
    const dataDir = path.join(tmpRoot, "data");
    const coversDir = path.join(dataDir, "covers");
    const artistImagesDir = path.join(dataDir, "artist-images");
    const albumDir = path.join(musicDir, "Artist", "Album");
    fs.mkdirSync(albumDir, { recursive: true });

    wavBytes = createMinimalWav(800);
    coverBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    portraitBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x12, 0xff, 0xd9]);

    fs.writeFileSync(path.join(albumDir, "01 - Tone.wav"), wavBytes);
    fs.writeFileSync(path.join(albumDir, "cover.jpg"), coverBytes);

    const mockFetch: typeof fetch = async (input) => {
      mockFetchCalls += 1;
      const url = String(input);
      if (url.includes("api.deezer.com/search/track")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                title: "01 - Tone",
                artist: {
                  name: "Artist",
                  picture_big: "https://cdn.example/artist-right.jpg",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("api.deezer.com/search/artist")) {
        return new Response(
          JSON.stringify({
            data: [
              { name: "Artist", nb_fan: 5, picture_big: "https://cdn.example/artist-obscure.jpg" },
              { name: "Artist", nb_fan: 500000, picture_big: "https://cdn.example/artist-right.jpg" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      assert.equal(url, "https://cdn.example/artist-right.jpg");
      return new Response(new Uint8Array(portraitBytes), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    };

    handle = await buildServer(
      {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        musicDir,
        dataDir,
        dbPath: path.join(dataDir, "musicorbit.db"),
        coversDir,
        artistImagesDir,
        fetchArtistImages: true,
        version: "0.1.0",
      },
      { fetchImpl: mockFetch },
    );

    await handle.scanner.runScan();

    const tracksRes = await handle.app.inject({ method: "GET", url: "/api/tracks" });
    const tracks = tracksRes.json<TrackSummary[]>();
    trackId = tracks[0]!.id;

    const albumsRes = await handle.app.inject({ method: "GET", url: "/api/albums" });
    const albums = albumsRes.json<AlbumSummary[]>();
    albumId = albums[0]!.id;

    const artistsRes = await handle.app.inject({ method: "GET", url: "/api/artists" });
    const artistsList = artistsRes.json<ArtistSummary[]>();
    artistId = artistsList[0]!.id;
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("streams a full audio track with 200 OK and Accept-Ranges: bytes", async () => {
    const res = await handle.app.inject({
      method: "GET",
      url: `/api/tracks/${trackId}/stream`,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["accept-ranges"], "bytes");
    assert.equal(res.headers["content-type"], "audio/wav");
    assert.equal(Number(res.headers["content-length"]), wavBytes.length);
    assert.deepEqual(res.rawPayload, wavBytes);
  });

  it("supports HTTP 206 Partial Content byte-range requests for seeking", async () => {
    const res = await handle.app.inject({
      method: "GET",
      url: `/api/tracks/${trackId}/stream`,
      headers: { range: "bytes=44-143" },
    });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers["content-range"], `bytes 44-143/${wavBytes.length}`);
    assert.equal(Number(res.headers["content-length"]), 100);
    assert.deepEqual(res.rawPayload, wavBytes.subarray(44, 144));
  });

  it("returns 416 Range Not Satisfiable for out-of-bounds ranges", async () => {
    const res = await handle.app.inject({
      method: "GET",
      url: `/api/tracks/${trackId}/stream`,
      headers: { range: `bytes=${wavBytes.length + 10}-` },
    });
    assert.equal(res.statusCode, 416);
    assert.equal(res.headers["content-range"], `bytes */${wavBytes.length}`);
  });

  it("serves cached album cover art with immutable cache headers", async () => {
    const res = await handle.app.inject({
      method: "GET",
      url: `/api/albums/${albumId}/cover`,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/jpeg");
    assert.ok(String(res.headers["cache-control"]).includes("immutable"));
    assert.deepEqual(res.rawPayload, coverBytes);
  });

  it("returns 404 for nonexistent tracks and covers", async () => {
    const t = await handle.app.inject({ method: "GET", url: "/api/tracks/99999/stream" });
    assert.equal(t.statusCode, 404);
    const c = await handle.app.inject({ method: "GET", url: "/api/albums/99999/cover" });
    assert.equal(c.statusCode, 404);
    const a = await handle.app.inject({ method: "GET", url: "/api/artists/99999/image" });
    assert.equal(a.statusCode, 404);
  });

  it("lazily fetches and caches artist portraits with zero repeat external calls", async () => {
    const first = await handle.app.inject({
      method: "GET",
      url: `/api/artists/${artistId}/image`,
    });
    // Wait: Artist name is "Unknown Artist" because minimal WAV has no INFO chunk;
    // update artist name to "Artist" to exercise the lookup & disk cache path.
    assert.equal(first.statusCode, 404);

    handle.dbContext.sqlite
      .prepare("UPDATE artists SET name = ? WHERE id = ?")
      .run("Artist", artistId);

    const fetched = await handle.app.inject({
      method: "GET",
      url: `/api/artists/${artistId}/image`,
    });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.headers["content-type"], "image/jpeg");
    assert.deepEqual(fetched.rawPayload, portraitBytes);
    assert.equal(mockFetchCalls, 2); // 1 search + 1 image download

    // Second request must serve straight from disk cache with zero additional fetch calls
    const cached = await handle.app.inject({
      method: "GET",
      url: `/api/artists/${artistId}/image`,
    });
    assert.equal(cached.statusCode, 200);
    assert.deepEqual(cached.rawPayload, portraitBytes);
    assert.equal(mockFetchCalls, 2);
  });
});
