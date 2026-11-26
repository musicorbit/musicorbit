---
title: Library Organization
description: Keep your folders tidy with customizable naming presets, dry-run previews, and safe .m3u8/.lrc tracking.
---

MusicOrbit includes a non-destructive **Library Organizer** that renames and restructures audio files on disk according to their embedded metadata tags.

## Folder structure presets

In **System → Library Organization**, choose from built-in naming templates:

| Preset | Example Output Path |
| :--- | :--- |
| **Standard** *(default)* | `Artist/Album (Year)/01 - Title.flac` |
| **Artist / Album** | `Artist/Album/01 - Title.flac` |
| **Flat Album Folder** | `Artist - Album (Year)/01 - Title.flac` |
| **Multi-Disc Subfolders** | `Artist/Album (Year)/Disc 1/01 - Title.flac` |
| **Multi-Disc Prefix** | `Artist/Album (Year)/1-01 - Title.flac` |

Filename segments are automatically sanitized across macOS, Linux, and Windows filesystems (removing illegal characters and normalizing whitespace).

## Safe dry-run previews

Before moving a single file, click **Preview Organization**:

- Inspect every planned `Old Path → New Path` rename.
- Tracks missing critical tags (`Artist`, `Album`, or `Title`) are **safely skipped** under untagged guardrails instead of landing in broken folders.
- Any path conflict is flagged and skipped rather than overwriting an existing file.

## What happens to lyrics & playlists?

When you apply an organization plan, MusicOrbit automatically:

1. **Moves paired `.lrc` sidecar files** right alongside their renamed audio files.
2. **Updates every SQLite track path** inside a transaction so playback history and playlists stay intact.
3. **Re-syncs `.m3u8` playlists on disk** so external players like Navidrome and Symfonium immediately see the updated paths.
4. **Cleans empty leftover directories** (including nested folders containing only `.DS_Store` or `Thumbs.db`), strictly scoped inside your `musicDir`.

## Opt-in Auto-Organize

Enable **Auto-Organize** in **System** to automatically sort loose files dropped directly into your music folder during periodic watcher scans.
