---
title: Uploading & Bulk Import
description: Add music to MusicOrbit via drag-and-drop browser uploads, bulk folder import, or direct filesystem mounts.
---

MusicOrbit supports three clean ways to bring audio files into your library.

## 1. Browser Upload (Drag & Drop)

Any logged-in user can upload tracks straight from their browser without needing SSH, SFTP, or file shares:

1. Click **Upload Music** in the header or sidebar.
2. Drag and drop individual audio files or entire album folders (`.flac`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.wav`).
3. MusicOrbit streams files to a staging directory, validates extensions and path safety, and automatically runs them through the tagger & organizer into **your user's private music folder**.
4. Watch progress live in the upload modal or review details in [Activity Logs](/activity-logs/).

Uploads enforce strict path sanitization (blocking directory traversal) and clean up staging files automatically if an upload is cancelled.

## 2. Bulk Folder Import (Copy or Move)

Already have a folder of albums sitting elsewhere on the server? Open **System → Bulk Import Folder**:

1. Pick an external source directory on the host using the built-in folder picker.
2. Choose **Copy** (keeps your originals untouched) or **Move**.
3. MusicOrbit rejects any source path that overlaps your active `musicDir` to prevent self-overwrites.
4. Imported tracks are tagged, organized into your active folder preset, and immediately indexed into your library.

## 3. Direct Folder Mount + Auto-Scan

You can drop music folders directly into your `MUSIC_DIR` (or a member's isolated folder under `libraries/<username>`):

- Click **Scan Library** to index changes immediately.
- Or enable **Auto-Organize** in **System** so loose files dropped directly into your music folder are automatically filed into clean `Artist/Album (Year)/Track - Title` folders on the next watcher tick.

## Handling duplicates

MusicOrbit compares audio quality when it encounters duplicate tracks — automatically preferring **lossless formats** (FLAC, WAV, ALAC) over lossy formats (MP3, AAC, OGG) and guarding against cross-edition duplicate clutter.
