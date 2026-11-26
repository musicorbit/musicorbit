---
title: Activity Logs & Diagnostics
description: Monitor library scans, uploads, transcoding, metadata edits, and security events in real time.
---

MusicOrbit records structured operational events inside SQLite (`activity_logs`) so you can inspect exactly what happened during a scan, upload, import, or password reset without digging through container stdout.

## What gets logged

- **Scanner:** Library scan durations, indexed/updated/pruned counts, and skipped duplicates
- **Uploads & Organizer:** File uploads, folder reorganizations, and paired `.lrc` moves
- **Lyrics & Metadata:** LRCLIB lyric fetches, MusicBrainz/Deezer tag writes, and cover art updates
- **Transcoder:** Lossless ALAC → FLAC transcode runs and cache hits
- **Playlists:** CSV / `.m3u8` imports and playlist sync writes
- **Security & System:** Host CLI password resets, user changes, and pipeline errors

## Role-scoped visibility

- **Members** can view and export (`JSON`) **their own** activity events (scoped by their `userId`) to monitor uploads, scans, and imports.
- **Admins** can view all server events, export diagnostics as `JSON`, and clear old log entries.

## Quiet idle scans

Background folder watchers are tuned to stay quiet when nothing has changed on disk, preventing log spam while still reporting real file additions, edits, or errors immediately.
