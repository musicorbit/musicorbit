---
title: Deleting Songs & Albums
description: Permanently delete individual tracks or entire albums from your library and disk with safe cleanup.
---

You don't need to SSH into your server or dig through folders to remove unwanted tracks or albums — MusicOrbit lets you delete them cleanly right from the UI.

## Deleting a track or album

- **Single track:** Click the trash icon on any track in **Tracks**, **Album Detail**, or **Artist Detail**.
- **Entire album:** Click **Delete Album** on an **Album Detail** page.

Every delete action opens a **confirmation modal** clearly listing the file(s) that will be permanently removed from disk before anything is touched.

## What gets cleaned up automatically

When you confirm deletion, MusicOrbit performs a safe, atomic cleanup:

1. **Removes the audio file(s)** from disk — strictly verified to live inside **your user's `musicDir`** (no path traversal outside your library is possible).
2. **Deletes paired `.lrc` sidecar files** so orphaned lyric files aren't left behind.
3. **Prunes empty parent folders** (e.g., an empty `Album (Year)/` or `Artist/` folder, even if macOS left a `.DS_Store` inside), stopping strictly at your `musicDir` root.
4. **Updates SQLite & playlists:** Removes the track(s), prunes orphaned albums/artists, updates affected playlists, and re-syncs `.m3u8` files on disk.
5. **Updates the active player queue:** Immediately removes deleted tracks from the browser playback queue so playback never stalls on a missing file.

:::caution[Permanent deletion]
Deletion removes the actual audio files from disk permanently (not a soft-hide). Make sure you maintain regular [Backups](/password-recovery/#backing-up-musicorbit) of your music folder.
:::
