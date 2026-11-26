---
title: Navidrome & Symfonium
description: Pair MusicOrbit with Navidrome and mobile Subsonic clients like Symfonium, Tempo, or Amperfy.
---

MusicOrbit is intentionally designed to be a **great neighbor** on your server: your audio files, embedded tags, `.lrc` lyrics, and `.m3u8` playlists stay in clean standard formats on disk so you can stream on mobile with **Navidrome + Symfonium** (or any Subsonic-compatible client) without duplicating a single byte.

## Shared volume layout

Mount the exact same host music directory into both MusicOrbit and Navidrome:

```yaml
services:
  musicorbit:
    image: ghcr.io/musicorbit/musicorbit:latest
    ports:
      - "4410:4410"
    volumes:
      - /srv/media/music:/music
      - ./data:/data
      - ./downloads:/downloads

  navidrome:
    image: deluan/navidrome:latest
    ports:
      - "4533:4533"
    environment:
      ND_MUSICFOLDER: /music
      ND_AUTOIMPORTPLAYLISTS: "true"
    volumes:
      - /srv/media/music:/music:ro
      - ./navidrome-data:/data
```

Mounting `/music:ro` (read-only) in Navidrome ensures MusicOrbit stays the single source of truth for tagging, organizing, and playlist writes while Navidrome streams cleanly to mobile clients.

## What stays in sync automatically

| Asset | How MusicOrbit writes it | How Navidrome / Symfonium reads it |
| :--- | :--- | :--- |
| **Audio tags & cover art** | Written directly into file headers via `node-taglib-sharp` | Indexed automatically on next scan |
| **Synced lyrics** | Standard `.lrc` sidecars next to each audio file | Displayed natively in Symfonium & Navidrome |
| **Playlists** | Relative-path `#EXTM3U` (`.m3u8`) files auto-synced on every change | Auto-imported when `ND_AUTOIMPORTPLAYLISTS=true` |
| **Folder layout** | Clean `Artist/Album (Year)/01 - Title.ext` hierarchy | Clean album & multi-disc grouping |
