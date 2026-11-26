---
title: Playlists, CSV & .m3u8 Sync
description: Create playlists with custom covers, import Exportify Spotify CSVs, and auto-sync .m3u8 files on disk.
---

MusicOrbit treats playlists as first-class portable files — never locked inside a proprietary database.

## Managing playlists

- Create, rename, reorder tracks (drag or move), and play playlists directly in the browser.
- **Custom Playlist Covers:** Upload your own cover image for any playlist or reset back to the dynamic album-art mosaic.
- **Per-user isolation:** Every user's playlists belong strictly to their own account and library.

## Automatic `.m3u8` mirroring on disk

Whenever you create, update, reorder, rename, or delete a playlist in MusicOrbit, it automatically writes a standard UTF-8 `#EXTM3U` (`.m3u8`) file with **relative track paths** inside your music folder.

Because paths are relative, external servers and mobile apps like [Navidrome & Symfonium](/navidrome-symfonium/) pick up your playlists automatically without manual exports.

## Importing playlists (`.m3u8` and Spotify `.csv`)

Click **Import Playlist** on the Playlists screen to import either:

1. **Standard `.m3u` / `.m3u8` files** — matches tracks by relative path or metadata.
2. **Spotify / Exportify `.csv` files** — matches every song against your local library and persists any **missing tracks** right inside the playlist view!

### Missing track tracking & auto-backfill

- Unmatched songs from a CSV import appear in a dedicated **Missing Tracks** list on the playlist page.
- If you later upload, import, or download one of those missing songs, MusicOrbit **automatically backfills** it into the playlist and removes it from the missing list.
- If `slskd` is configured and enabled for your account, you can trigger a batch Soulseek search for missing playlist tracks in one click.
