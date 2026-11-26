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
