---
title: Mobile Apps (OpenSubsonic)
description: Connect Symfonium, Amperfy, Arpeggi, Tempo, and Feishin directly to MusicOrbit's built-in OpenSubsonic API.
---

MusicOrbit includes a built-in **OpenSubsonic 1.16.1 REST API** (`/rest/*.view`, XML + JSON + `formPost` + `songLyrics`), so you can connect native mobile and desktop music apps directly to MusicOrbit for **offline downloads, Apple CarPlay, Android Auto, and live synced lyrics**.

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
- **Cross-device listening stats & recaps (`scrobble`):** Completed plays (including offline queued scrobbles synced later) flow straight into your MusicOrbit Home stats, **Where You Listen** app breakdown, and Monthly / Yearly Recaps — and power `Recently Played` and `Most Played` album shelves inside your mobile app.

## Running alongside Navidrome

If you already run Navidrome on the same server and want to use both side by side, mount the same host music directory read-only in Navidrome (`/music:ro`) with `ND_AUTOIMPORTPLAYLISTS=true` — every tag, `.lrc` lyric, and `.m3u8` playlist MusicOrbit writes stays cleanly in sync.
