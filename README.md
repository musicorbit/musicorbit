# MusicOrbit

A self-hosted, open-source music library, browser player, metadata manager, and optional Soulseek acquisition hub — designed to give you a clean single-screen workflow for discovering, tagging, organizing, and playing your own music collection.

## Features

- **Incremental Library Scanner:** Indexes `.flac`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus`, and `.wav` files into SQLite (WAL mode) with SHA-256 deduplicated cover art caching.
- **Built-in Browser Player:** HTTP `206 Partial Content` byte-range audio streaming with persistent player bar, scrubbable seek bar, volume, shuffle/repeat, slide-over queue drawer, and OS Media Session controls.
- **Rich Metadata Management:**
  - Full on-demand track metadata editor writing real tags back to disk via `node-taglib-sharp` (title, artist, album artist, album, track/disc numbers, year, genre, composer, BPM, comment, lyrics, and embedded cover art).
  - Multi-provider **Fetch Metadata** lookup (**Deezer**, **MusicBrainz**, and **LRCLIB** for lyrics) with a per-field **Current → Suggested** diff so you can accept all fields, fill empty fields only, or cherry-pick individual tags and cover art.
  - Album-wide **Fix Tags** modal with MusicBrainz release matching, plus an artist portrait picker & custom uploader.
- **Optional Soulseek Acquisition (`slskd`):** Search releases grouped by folder and ranked FLAC-first, queue downloads, and monitor live transfer progress via an optional `slskd` REST API connection. MusicOrbit works seamlessly without `slskd` if you only want a local music library and player.
- **Import Pipeline & Review Queue:** Scans `DOWNLOADS_DIR`, matches releases against MusicBrainz, auto-imports high-confidence albums into `MUSIC_DIR/Artist/Album (Year)/...`, and routes uncertain matches into an interactive **Review Queue**.
- **Playlists & `.m3u8` Interoperability:** Create, reorder, and play playlists in the browser, or import and export standard `#EXTM3U` (`.m3u8`) playlists compatible with Navidrome and Symfonium.
- **Optional Authentication:** Built-in first-run admin setup wizard and session-cookie login (`scrypt` password hashing + `HttpOnly` cookies) when `AUTH_ENABLED=true`.
- **Single-Container Docker Release:** Multi-stage Docker image serving both the Fastify API and the compiled React SPA on one port (`3001`).

## Quick Start with Docker

```bash
git clone https://github.com/your-org/musicorbit.git
cd musicorbit
docker compose up -d --build
```

Open **http://localhost:3001** in your browser. On first launch (with `AUTH_ENABLED=true`), MusicOrbit will prompt you to create your local admin account.

To run the optional bundled `slskd` daemon alongside MusicOrbit:

```bash
docker compose --profile soulseek up -d
```

## Local Development

### Prerequisites

- Node.js 22+ and npm

### Setup

```bash
# 1. Install dependencies across all workspaces
npm install

# 2. Copy the example environment file
cp .env.example .env

# 3. Start the Fastify API (port 3001) and Vite Web UI (port 5173)
npm run dev
```

Open **http://localhost:5173** in your browser.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API (`:3001`) and Web UI (`:5173`) together in watch mode |
| `npm run dev:api` | Run only the Fastify backend |
| `npm run dev:web` | Run only the Vite frontend |
| `npm run typecheck` | Type-check `@musicorbit/shared`, `@musicorbit/api`, and `@musicorbit/web` |
| `npm test` | Run the API automated test suite |
| `npm run build` | Build production bundles for all workspaces |

## Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port for the API (and web UI in production/Docker mode) |
| `HOST` | `0.0.0.0` | Network interface to bind |
| `MUSIC_DIR` | `./sample-music` | Directory containing your audio library (`/music` in Docker) |
| `DATA_DIR` | `./data` | Directory for `musicorbit.db`, cover cache, and artist images (`/data` in Docker) |
| `DOWNLOADS_DIR` | `./downloads` | Incoming folder scanned by the import pipeline (`/downloads` in Docker) |
| `AUTO_IMPORT_THRESHOLD` | `85` | Minimum MusicBrainz match score (`0–100`) for automatic import |
| `FETCH_ARTIST_IMAGES` | `true` | Set to `false` to disable external artist portrait lookups (offline mode) |
| `AUTH_ENABLED` | `false` | Set to `true` (`true` by default in Docker) to require login & first-run admin setup |
| `SLSKD_URL` | *(empty)* | Optional URL of your `slskd` instance (e.g. `http://slskd:5030`) |
| `SLSKD_API_KEY` | *(empty)* | Optional API key configured under `web.authentication.api_keys` in `slskd.yml` |
| `WEB_DIST_DIR` | *(empty)* | Path to built Vite `dist/` directory for single-port production serving |

## Project Structure

```text
musicorbit/
├── packages/shared/   # Shared TypeScript types & API contracts
├── apps/api/          # Fastify v5 REST API, SQLite/Drizzle DB, scanner, tag writer, importer
├── apps/web/          # React 19 + Vite + Tailwind CSS v4 single-page app
├── Dockerfile         # Multi-stage production container
└── docker-compose.yml # MusicOrbit + optional slskd profile
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and PR guidelines.

## License

MusicOrbit is free software licensed under the [GNU Affero General Public License v3.0](LICENSE).
