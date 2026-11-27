---
title: What is MusicOrbit?
description: Overview of MusicOrbit — a self-hosted, open-source music library, lossless browser player, synced lyrics, and metadata hub.
---

**MusicOrbit** is a Docker-native, self-hosted music library manager, browser audio player, metadata editor, and optional acquisition hub. It turns any home server, NAS, or local machine into a private multi-user listening space — with no cloud accounts, no subscriptions, and no vendor lock-in.

Your audio files stay right where you put them on disk, cleanly tagged and organized into standard folders that work seamlessly alongside tools like **Navidrome** and **Symfonium**.

## What you get

- **Incremental Library Scanner:** Indexes local `.flac`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus`, and `.wav` collections into SQLite (WAL mode) with SHA-256 deduplicated cover art caching.
- **Lossless Browser Player:** Streams tracks over HTTP `206 Partial Content` byte-ranges with instant scrubbing, persistent playback bar, queue management, shuffle/repeat, OS Media Session controls, and automatic **ALAC → lossless FLAC** transcoding for browser compatibility.
- **Home Stats Dashboard & Shareable Recaps:** Per-user listening time, streaks, 90-day activity heatmap, lossless codec breakdown, device/app split across Web & OpenSubsonic apps, **auto-detecting listening history import** (Spotify JSON, Apple Music CSV, Last.fm CSV/JSON, and ListenBrainz JSON/JSONL), plus Monthly and post-Christmas Yearly Recaps with one-click social PNG share cards and Top 25 playlists.
- **Mobile-Friendly PWA & OpenSubsonic API:** Install directly as a standalone mobile/desktop PWA, or connect native apps like **Symfonium**, **Amperfy**, **Arpeggi**, and **Feishin** via MusicOrbit's built-in **OpenSubsonic API** for CarPlay, Android Auto, and offline downloads.
- **Synced Sing-Along Lyrics:** Full-screen karaoke view powered by standard `.lrc` sidecar files fetched automatically from **LRCLIB** (or embedded track lyrics).
- **Real Metadata Written to Disk:** Edit tags and embedded cover art directly in your audio files via `node-taglib-sharp`, with a multi-provider **Current → Suggested** diff picker across **Deezer**, **MusicBrainz**, and **LRCLIB**.
- **Multi-User Auth & Isolated Libraries:** Enabled by default (`AUTH_ENABLED=true`) with per-user private music directories, salted `scrypt` password hashing, `HttpOnly` sessions, brute-force rate limiting, and host CLI password recovery.
- **Playlists & Interoperability:** Manage playlists in the browser, import Spotify CSVs (Exportify), and automatically mirror changes to standard `#EXTM3U` (`.m3u8`) files on disk.
- **Optional `slskd` Integration:** Connect a self-hosted `slskd` daemon when you want Soulseek search and download tracking, or run MusicOrbit 100% standalone as a local library and player.

## Supported audio formats

| Format | Extensions | Playback | Metadata Writing |
| :--- | :--- | :--- | :--- |
| FLAC (Lossless) | `.flac` | Native browser stream | Full read / write + embedded art |
| MP3 | `.mp3` | Native browser stream | Full read / write + embedded art |
| AAC / M4A | `.m4a`, `.aac` | Native browser stream | Full read / write + embedded art |
| Apple Lossless (ALAC) | `.m4a` | Auto-transcoded & cached to lossless FLAC | Full read / write + embedded art |
| Ogg Vorbis & Opus | `.ogg`, `.opus` | Native browser stream | Full read / write + embedded art |
| WAV | `.wav` | Native browser stream | Basic tag read / write |

## Built for self-hosting

- **Single container:** Pre-built multi-architecture (`linux/amd64` + `linux/arm64`) Docker image on `ghcr.io/musicorbit/musicorbit` serving the Fastify v5 API, React 19 PWA, and bundled `ffmpeg` on port `4410`.
- **Zero external database required:** Everything lives in a single SQLite database (`DATA_DIR/musicorbit.db`) plus cached cover art and artist portraits.
- **Open source:** Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

## Next step

Ready to spin up your own instance? Head over to [Installation](/installation/).
