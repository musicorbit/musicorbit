---
title: Metadata, Covers & Portraits
description: Edit real audio tags on disk, compare multi-provider suggestions side by side, and customize album & artist artwork.
---

Unlike apps that only store edits in a private database, MusicOrbit writes metadata changes **directly back into your audio files** using `node-taglib-sharp` — so your clean tags travel with your files everywhere.

## On-demand Track Metadata Editor

Click the edit action on any track to inspect and modify:

- **Core tags:** Title, Artist, Album Artist, Album, Track Number, Disc Number, Year, Genre
- **Extended tags:** Composer, BPM, Comment, Embedded Lyrics
- **Embedded Cover Art:** Upload a custom cover image, apply suggested artwork, or remove embedded art directly inside the audio file

### Multi-Provider Diff Picker (`Fetch Metadata`)

Inside the Track Metadata Editor, click **Fetch Metadata** to query **Deezer**, **MusicBrainz**, and **LRCLIB** simultaneously:

- Every suggested field is shown in a clear **Current → Suggested** diff table.
- **Accept All** — apply every suggestion at once.
- **Fill Empty Only** — populate missing fields without touching your existing tags.
- **Cherry-Pick** — accept individual fields or cover art one by one before saving to disk.

## Album-Wide `Fix Tags` & Full Tracklist Check

From any **Album Detail** page:

- **Fix Tags:** Match the entire album against **MusicBrainz** releases (including edition switching between Standard, Deluxe, or Remaster releases) and apply unified album metadata and artwork across all tracks.
- **Check Tracklist:** Compare your owned tracks against the full official album tracklist to immediately spot missing bonus tracks or gaps (with normalized matching for featured artists and remaster suffixes).

## Artist Portraits

- When `FETCH_ARTIST_IMAGES=true`, MusicOrbit lazily fetches and caches artist portraits locally under `DATA_DIR/artist-images/` with zero repeated external calls.
- Click the edit icon on any Artist page to **pick from candidate portraits**, **paste an image URL** (with SSRF protection), **upload a custom photo**, or **reset** to default.
- Set `FETCH_ARTIST_IMAGES=false` in `.env` for strict offline / privacy mode.
