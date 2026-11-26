---
title: Synced Sing-Along Lyrics
description: Full-screen timed karaoke lyrics powered by standard .lrc sidecar files and LRCLIB.
---

MusicOrbit turns any track into a live sing-along experience with synchronized `.lrc` lyrics — stored openly right next to your audio files on disk.

## How lyrics are resolved

When you open the **Lyrics** overlay from the player bar, MusicOrbit checks in order:

1. **Local `.lrc` sidecar file** (e.g., `01 - Solar Drift.lrc` right beside `01 - Solar Drift.flac`)
2. **Embedded lyrics tag** stored inside the audio file itself
3. **LRCLIB lookup** (when requested or auto-fetched), which saves a standard `.lrc` sidecar file beside your track and caches it in SQLite

Supported `.lrc` features include standard `[mm:ss.xx]` timestamps, millisecond `[mm:ss.xxx]` precision, multi-timestamp chorus lines, and `[offset:+/-ms]` timing offsets.

## Smooth, jump-free sing-along UI

- **Active-line focus:** The currently playing lyric line smoothly centers and highlights with a GPU-composited micro-scale (`scale(1.02)`) while keeping constant font metrics so long lines **never re-wrap or jump** as they become active.
- **Click-to-seek:** Click any lyric line in a synced track to jump the audio player directly to that exact timestamp.
- **Plain lyrics fallback:** If a track only has unsynced text lyrics, MusicOrbit still renders them cleanly in the full-screen reader view.

## Automatic & batch fetching

- **Auto-fetch on scan/import:** Enable **Auto-Fetch Lyrics** in **System** to automatically fetch `.lrc` sidecars for newly scanned or imported tracks.
- **Batch fetch missing lyrics:** Trigger a one-click batch fetch in **System** to scan your entire library for tracks missing lyrics and track coverage stats live.
- **Organizer-aware:** Whenever the [Library Organizer](/library-organization/) renames or moves an audio file, its paired `.lrc` sidecar moves right alongside it.
