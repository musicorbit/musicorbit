---
title: Environment Variables
description: Complete reference for every .env and Docker environment variable supported by MusicOrbit.
---

MusicOrbit reads configuration from environment variables (or a `.env` file in the repository root for bare-metal installs). Every variable is validated at startup with Zod.

## Configuration reference

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `4410` | HTTP port for the Fastify API (and built React UI in production/Docker mode). |
| `HOST` | `0.0.0.0` | Network interface to bind. |
| `LOG_LEVEL` | `info` | Server log verbosity: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |
| `MUSIC_DIR` | `./sample-music` | Root audio library directory (`/music` in Docker). Relative paths resolve from the repo root. |
| `DATA_DIR` | `./data` | Directory storing `musicorbit.db`, cover art cache, artist portraits, and transcode cache (`/data` in Docker). |
| `DOWNLOADS_DIR` | `./downloads` | Incoming folder watched by the Import Pipeline (`/downloads` in Docker). |
| `AUTO_IMPORT_THRESHOLD` | `85` | Minimum MusicBrainz match score (`0–100`) required to auto-import without manual review. |
| `FETCH_ARTIST_IMAGES` | `true` | Fetch and cache artist portraits lazily. Set to `false` for strict offline / privacy mode. |
| `AUTH_ENABLED` | `true` | Enables first-run Admin setup, multi-user login, and session cookies. Set to `false` **only** on a private localhost-only dev machine. |
| `SLSKD_URL` | *(empty)* | Optional URL of your `slskd` daemon (e.g., `http://slskd:5030`). Leave unset to disable Soulseek integration. |
| `SLSKD_API_KEY` | *(empty)* | Optional API key configured under `web.authentication.api_keys` in `slskd.yml`. |
| `WEB_DIST_DIR` | *(empty)* | Path to built Vite `apps/web/dist` directory for single-port production serving (set automatically in Docker). |

## Example `.env`

```bash
PORT=4410
HOST=0.0.0.0
LOG_LEVEL=info

MUSIC_DIR=/srv/media/music
DATA_DIR=/srv/musicorbit/data
DOWNLOADS_DIR=/srv/musicorbit/downloads

AUTH_ENABLED=true
FETCH_ARTIST_IMAGES=true
AUTO_IMPORT_THRESHOLD=85

# Optional slskd integration
# SLSKD_URL=http://slskd:5030
# SLSKD_API_KEY=your_slskd_api_key
```
