---
title: Mobile Apps (OpenSubsonic) & Navidrome
description: Connect Symfonium, Amperfy, Arpeggi, Tempo, and Feishin directly to MusicOrbit's built-in OpenSubsonic API — or pair optionally with Navidrome.
---

MusicOrbit includes a built-in **OpenSubsonic 1.16.1 REST API** (`/rest/*.view`, XML + JSON + `formPost` + `songLyrics`), meaning you can connect native mobile and desktop music apps directly to MusicOrbit for **offline downloads, Apple CarPlay, Android Auto, and live synced lyrics** — with **no separate Navidrome container required**.

## Connecting Symfonium, Amperfy, Arpeggi, or Feishin

1. Sign into MusicOrbit and open **System & Scanner** *(Members: **Library Settings**)*.
2. In the **Mobile & Desktop Apps (OpenSubsonic API)** card, click **Generate Subsonic App Password**.
3. Open your preferred Subsonic / OpenSubsonic client:
   - **Android:** [Symfonium](https://symfonium.app/) or Tempo
   - **iOS:** [Amperfy](https://github.com/BLeeEZ/amperfy), Arpeggi, or play:Sub
   - **Desktop:** [Feishin](https://github.com/jeffvli/feishin)
4. Add a new **Subsonic / OpenSubsonic** server using:
   - **Server URL:** Your MusicOrbit URL (e.g., `https://music.example.com` or `http://192.168.1.50:4410`)
   - **Username:** Your MusicOrbit username
   - **Password:** Your generated **Subsonic App Password**

:::tip[Why a separate Subsonic App Password?]
Modern Subsonic apps default to salted MD5 token auth (`t = md5(password + salt)`), which requires the server to read the secret being hashed. Using a dedicated rotatable **Subsonic App Password** keeps your main MusicOrbit web login password protected with one-way salted `scrypt` while working out of the box with Symfonium, Amperfy, and Feishin (you can rotate or revoke it anytime in 1 click).
:::

## What works natively over OpenSubsonic

- **Strict per-user library isolation:** Each user signs in with their own account and sees only their own private library, cover art, and playlists.
- **Full-library sync & search:** Supports `search3` (including Symfonium's fast `query=""` sync), `getArtists`, `getArtist`, `getAlbumList2`, `getAlbum`, `getGenres`, and `getRandomSongs`.
- **Playlists:** Browse, create, rename, edit, and delete playlists from your phone — changes automatically mirror to `.m3u8` files on disk too.
- **Lossless streaming & offline downloads:** HTTP `206 Partial Content` seeking, raw file downloads for offline caching, and automatic **ALAC → lossless FLAC** transcoding when streaming.
- **Synced `.lrc` lyrics (`getLyricsBySongId`):** Symfonium and Amperfy display live timed sing-along lyrics straight from MusicOrbit's `.lrc` sidecars.

---

## MusicOrbit vs. Navidrome (and Optional Pairing)

Because MusicOrbit speaks OpenSubsonic natively, most users don't need Navidrome at all.

| Capability | MusicOrbit | Navidrome |
| :--- | :---: | :---: |
| **OpenSubsonic API** *(Symfonium, Amperfy, CarPlay, offline downloads)* | Yes | Yes |
| **Browser & Mobile PWA streaming** | Yes (auto ALAC → FLAC) | Yes |
| **Upload songs/albums from browser** | Yes | No |
| **Edit tags & embed cover art on disk** | Yes (Deezer, MusicBrainz, LRCLIB) | No (read-only) |
| **Organize folders & Review Queue** | Yes | No |
| **Fetch & save synced `.lrc` lyrics** | Yes (auto + batch) | Reads existing `.lrc` only |
| **Spotify CSV import + missing-track backfill** | Yes | No |
| **Delete songs/albums from disk** | Yes | No |

If you still prefer running Navidrome alongside MusicOrbit (for example, to use an existing Navidrome instance), mount the same host music directory read-only in Navidrome (`/music:ro`) with `ND_AUTOIMPORTPLAYLISTS=true` — every tag, `.lrc` lyric, and `.m3u8` playlist MusicOrbit writes stays cleanly in sync.
