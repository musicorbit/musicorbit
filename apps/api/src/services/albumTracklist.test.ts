import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AlbumSummary, AlbumTracklistResponse, TrackSummary } from "@musicorbit/shared";
import { buildServer, type ServerHandle } from "../server.js";
import { matchExpectedTracksToOwned, normalizeTrackMatchTitle } from "./albumTracklist.js";
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

describe("Album Full Tracklist & Missing Tracks Lookup", () => {
  let tmpRoot: string;
  let handle: ServerHandle;
  let albumId: number;
  let ownedTrackId: number;
  let externalFetchCount = 0;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-tracklist-"));
    const musicDir = path.join(tmpRoot, "music");
    const dataDir = path.join(tmpRoot, "data");
    const downloadsDir = path.join(tmpRoot, "downloads");
    fs.mkdirSync(path.join(musicDir, "Dua Lipa", "Future Nostalgia"), { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });

    const trackPath = path.join(musicDir, "Dua Lipa", "Future Nostalgia", "05 - Levitating.wav");
    fs.writeFileSync(trackPath, createTestWavBuffer());
    await writeAudioTags(trackPath, {
      title: "Levitating (feat. DaBaby)",
      artist: "Dua Lipa",
      albumArtist: "Dua Lipa",
      album: "Future Nostalgia",
      trackNumber: 5,
      discNumber: 1,
      year: 2020,
      genre: "Pop",
      lyrics: "",
    });

    const mockFetch: typeof fetch = async (input) => {
      externalFetchCount++;
      const url = typeof input === "string" ? input : input.toString();

      if (url.startsWith("https://api.deezer.com/search/album")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 138042442,
                title: "Future Nostalgia",
                nb_tracks: 3,
                artist: { name: "Dua Lipa" },
              },
              {
                id: 999999,
                title: "Future Nostalgia - 80s Today",
                nb_tracks: 40,
                artist: { name: "Various Artists" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.startsWith("https://api.deezer.com/album/138042442")) {
        return new Response(
          JSON.stringify({
            id: 138042442,
            title: "Future Nostalgia",
            nb_tracks: 3,
            release_date: "2020-03-27",
            artist: { name: "Dua Lipa" },
            tracks: {
              data: [
                { id: 1, title: "Future Nostalgia", track_position: 1, disk_number: 1, duration: 184, artist: { name: "Dua Lipa" } },
                { id: 2, title: "Don't Start Now", track_position: 2, disk_number: 1, duration: 183, artist: { name: "Dua Lipa" } },
                { id: 3, title: "Levitating", track_position: 5, disk_number: 1, duration: 203, artist: { name: "Dua Lipa" } },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.startsWith("https://musicbrainz.org/ws/2/release/?")) {
        return new Response(
          JSON.stringify({
            releases: [
              {
                id: "11111111-2222-3333-4444-555555555555",
                title: "Future Nostalgia (The Moonlight Edition)",
                score: 95,
                date: "2021-02-11",
                country: "XW",
                "track-count": 4,
                "artist-credit": [{ name: "Dua Lipa", artist: { id: "artist-1", name: "Dua Lipa" } }],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/ws/2/release/11111111-2222-3333-4444-555555555555")) {
        return new Response(
          JSON.stringify({
            id: "11111111-2222-3333-4444-555555555555",
            title: "Future Nostalgia (The Moonlight Edition)",
            date: "2021-02-11",
            country: "XW",
            "artist-credit": [{ name: "Dua Lipa", artist: { id: "artist-1", name: "Dua Lipa" } }],
            media: [
              {
                position: 1,
                tracks: [
                  { position: 1, title: "Future Nostalgia", length: 184000 },
                  { position: 2, title: "Don't Start Now", length: 183000 },
                  { position: 5, title: "Levitating", length: 203000 },
                  { position: 12, title: "Fever", length: 157000 },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
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
    const albumsRes = await handle.app.inject({ method: "GET", url: "/api/albums" });
    const albumsList = albumsRes.json<AlbumSummary[]>();
    albumId = albumsList[0]!.id;

    const tracksRes = await handle.app.inject({ method: "GET", url: "/api/tracks" });
    const tracksList = tracksRes.json<TrackSummary[]>();
    ownedTrackId = tracksList[0]!.id;
  });

  after(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("normalizes featured artists and remaster suffixes when matching owned tracks", () => {
    assert.equal(normalizeTrackMatchTitle("Levitating (feat. DaBaby)"), "levitating");
    assert.equal(normalizeTrackMatchTitle("West Coast - 2014 Remastered"), "west coast");

    const owned: TrackSummary[] = [
      {
        id: 42,
        title: "Levitating (feat. DaBaby)",
        albumId: 1,
        albumTitle: "Future Nostalgia",
        artistId: 1,
        artistName: "Dua Lipa",
        trackNumber: 5,
        discNumber: 1,
        durationSeconds: 203,
        codec: "FLAC",
        bitrate: 900,
        sampleRate: 44100,
        filePath: "/music/05 - Levitating.flac",
      },
    ];

    const matched = matchExpectedTracksToOwned(
      [
        { discNumber: 1, trackNumber: 1, title: "Future Nostalgia", artist: "Dua Lipa", durationSeconds: 184 },
        { discNumber: 1, trackNumber: 5, title: "Levitating", artist: "Dua Lipa", durationSeconds: 203 },
      ],
      owned,
    );

    assert.equal(matched[0]?.ownedTrackId, null);
    assert.equal(matched[1]?.ownedTrackId, 42);
  });

  it("looks up full album tracklist, marks owned vs missing tracks, and supports edition switching", async () => {
    const res = await handle.app.inject({
      method: "GET",
      url: `/api/albums/${albumId}/tracklist`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json<AlbumTracklistResponse>();

    assert.equal(body.albumId, albumId);
    assert.equal(body.provider, "deezer");
    assert.equal(body.selectedRelease?.id, "deezer:138042442");
    assert.equal(body.tracks.length, 3);
    assert.equal(body.ownedCount, 1);
    assert.equal(body.missingCount, 2);
    // Unrelated "Various Artists" compilation should be filtered out
    assert.equal(body.releases.length, 2);
    assert.ok(!body.releases.some((r) => r.artist === "Various Artists"));

    const levitating = body.tracks.find((t) => t.title === "Levitating");
    const dontStartNow = body.tracks.find((t) => t.title === "Don't Start Now");
    assert.equal(levitating?.ownedTrackId, ownedTrackId);
    assert.equal(dontStartNow?.ownedTrackId, null);

    // Second request should be served entirely from SQLite cache (0 external fetches!)
    const fetchCountAfterFirst = externalFetchCount;
    const cachedRes = await handle.app.inject({
      method: "GET",
      url: `/api/albums/${albumId}/tracklist`,
    });
    assert.equal(cachedRes.statusCode, 200);
    assert.equal(externalFetchCount, fetchCountAfterFirst);

    // Switch edition to MusicBrainz Moonlight Edition
    const mbRes = await handle.app.inject({
      method: "GET",
      url: `/api/albums/${albumId}/tracklist?releaseId=mb:11111111-2222-3333-4444-555555555555`,
    });
    assert.equal(mbRes.statusCode, 200);
    const mbBody = mbRes.json<AlbumTracklistResponse>();
    assert.equal(mbBody.provider, "musicbrainz");
    assert.equal(mbBody.tracks.length, 4);
    assert.equal(mbBody.ownedCount, 1);
    assert.equal(mbBody.missingCount, 3);

    // Navigating back (no releaseId param) remembers the chosen MusicBrainz edition from SQLite cache!
    const fetchCountAfterSwitch = externalFetchCount;
    const rememberedRes = await handle.app.inject({
      method: "GET",
      url: `/api/albums/${albumId}/tracklist`,
    });
    assert.equal(rememberedRes.statusCode, 200);
    assert.equal(externalFetchCount, fetchCountAfterSwitch);
    assert.equal(rememberedRes.json<AlbumTracklistResponse>().provider, "musicbrainz");

    // Explicit ?refresh=true bypasses cache and hits upstream providers again
    const refreshedRes = await handle.app.inject({
      method: "GET",
      url: `/api/albums/${albumId}/tracklist?refresh=true`,
    });
    assert.equal(refreshedRes.statusCode, 200);
    assert.ok(externalFetchCount > fetchCountAfterSwitch);

    // Reject invalid releaseId and missing album
    const badRelease = await handle.app.inject({
      method: "GET",
      url: `/api/albums/${albumId}/tracklist?releaseId=invalid:123`,
    });
    assert.equal(badRelease.statusCode, 400);

    const missingAlbum = await handle.app.inject({
      method: "GET",
      url: "/api/albums/999999/tracklist",
    });
    assert.equal(missingAlbum.statusCode, 404);
  });
});
