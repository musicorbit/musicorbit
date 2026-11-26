---
title: Import Pipeline & Review Queue
description: Automated post-processing for incoming downloads with MusicBrainz/Deezer matching and manual review for uncertain releases.
---

MusicOrbit's **Import Pipeline** watches `DOWNLOADS_DIR` and turns raw incoming albums or single tracks into cleanly tagged, organized library entries.

## How the pipeline works

1. **Stability check:** Waits until incoming files finish writing so partial downloads are never moved prematurely.
2. **Hint extraction:** Parses artist, album, and year hints from folder names and existing file tags.
3. **Metadata matching:** Queries **MusicBrainz** (for full albums) and **Deezer** (for single tracks and cover art) and calculates a confidence score (`0–100`).
4. **Confidence routing:**
   - **Score ≥ `AUTO_IMPORT_THRESHOLD`** (default `85`): Automatically writes clean tags and cover art, moves files into your library according to your folder preset, fetches synced `.lrc` lyrics (if enabled), and backfills any matching missing playlist tracks.
   - **Score < `AUTO_IMPORT_THRESHOLD`**: Routes the folder into the **Review Queue** so nothing is mis-tagged behind your back.

## Using the Review Queue

When an item needs review, a badge appears next to **Review Queue** in the sidebar:

- Inspect the detected files alongside candidate **MusicBrainz** releases.
- Search for a different release or pick the exact edition (Standard, Deluxe, Remaster).
- Click **Approve & Import** to tag and file the release into your library, or **Dismiss** to leave it untouched.

## Multi-user download routing

When multiple users share one MusicOrbit server with `slskd` enabled, MusicOrbit records a `download_ownership` entry for every queued download. As soon as that download finishes in the shared `DOWNLOADS_DIR`, the pipeline routes it straight into **that specific user's private library folder** — never mixing it into another user's collection.

## Single-track handling

Loose single tracks dropped into `DOWNLOADS_DIR` are matched individually via Deezer/MusicBrainz without falsely renaming the track to an album title or creating empty `.DS_Store` leftovers.
