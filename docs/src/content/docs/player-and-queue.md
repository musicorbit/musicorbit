---
title: Browser Player & Queue
description: Persistent browser playback bar, seekable byte-range streaming, queue management, and OS media controls.
---

MusicOrbit includes a full-featured persistent audio player right in your browser so playback never interrupts while you browse albums, edit metadata, or manage playlists.

## Persistent player bar

Pinned across every view, the player bar gives you:

- **Album artwork & track info** (clickable to jump straight to the album)
- **Play / Pause, Previous, Next** controls
- **Scrubbable seek bar** backed by HTTP `206 Partial Content` byte-range streaming
- **Shuffle** and **Repeat** (`Off` → `Repeat All` → `Repeat One`)
- **Volume slider & mute toggle**
- **Lyrics button** to open the full-screen [Synced Sing-Along Lyrics](/sing-along-lyrics/) overlay
- **Queue drawer** to inspect, jump to, or remove upcoming tracks

## OS Media Session integration

MusicOrbit registers with the browser's **Media Session API**, meaning:

- Hardware **Play/Pause**, **Next**, and **Previous** keys on your keyboard or headphones work even when MusicOrbit is in a background tab.
- Track title, artist, album, and cover art show up natively in your OS media widget (macOS Now Playing, Windows Media Overlay, Android/iOS lock screen).

## Deleting a currently playing track

If you permanently delete a track or album that is currently playing or queued, MusicOrbit immediately removes it from the queue and stops or advances playback cleanly so you never hit a dead stream.

## Install as a Mobile or Desktop App (PWA)

MusicOrbit ships as an installable **Progressive Web App (PWA)** with standalone fullscreen mode, adaptive home-screen icons, and a safe app-shell service worker:

- **iOS (Safari):** Open your MusicOrbit URL, tap **Share → Add to Home Screen**.
- **Android (Chrome):** Open your HTTPS MusicOrbit URL and tap **Install app** from the browser menu.
- **Desktop (Chrome / Edge):** Click the **Install** icon in the address bar.

:::tip[HTTPS for Android / Desktop Install]
Chrome and Edge require HTTPS (or `localhost`) to register the service worker and display the native **Install app** prompt. See [Reverse Proxy & HTTPS](/reverse-proxy/) to serve MusicOrbit over TLS.
:::
