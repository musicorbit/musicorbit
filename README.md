# MusicOrbit

A self-hosted, open-source music library, browser player, metadata manager, and optional Soulseek acquisition hub — designed to give you a clean single-screen workflow for discovering, tagging, organizing, and playing your own music collection.

## Features

- **Incremental Library Scanner:** Indexes `.flac`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus`, and `.wav` files into SQLite (WAL mode) with SHA-256 deduplicated cover art caching.
- **Built-in Browser Player:** HTTP `206 Partial Content` byte-range audio streaming with persistent player bar, scrubbable seek bar, volume, shuffle/repeat, slide-over queue drawer, and OS Media Session controls.
- **Rich Metadata Management:**
  - Full on-demand track metadata editor writing real tags back to disk via `node-taglib-sharp` (title, artist, album artist, album, track/disc numbers, year, genre, composer, BPM, comment, lyrics, and embedded cover art).
  - Multi-provider **Fetch Metadata** lookup (**Deezer**, **MusicBrainz**, and **LRCLIB** for lyrics) with a per-field **Current → Suggested** diff so you can accept all fields, fill empty fields only, or cherry-pick individual tags and cover art.
  - Album-wide **Fix Tags** modal with MusicBrainz release matching, plus an artist portrait picker & custom uploader.
- **Playlists & `.csv` / `.m3u8` Interoperability:** Create, reorder, customize covers, and play playlists in the browser, or import/export standard `#EXTM3U` (`.m3u8`) and `.csv` playlists (compatible with Navidrome, Symfonium, and Exportify).
- **Post-Processing Pipeline & Review Queue:** Watches `DOWNLOADS_DIR`, matches incoming albums and single tracks, writes clean tags & cover art, handles duplicates, organizes files into `MUSIC_DIR/Artist/Album (Year)/...`, and routes uncertain matches into an interactive **Review Queue**.
- **Optional External Transfer Integration (`slskd`):** Connect an optional self-hosted `slskd` instance via its REST API to search, queue, and track external peer-to-peer transfers. MusicOrbit is designed to work completely standalone as a local music library and player without `slskd`.
- **Multi-User Auth & Isolated Libraries:** Enabled by default (`AUTH_ENABLED=true`) with first-run admin setup, per-user isolated music folders, per-user Soulseek permissions (off by default), salted `scrypt` password hashing, `HttpOnly` session cookies, brute-force rate limiting, and host CLI password recovery.
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
| `npm run reset-password -- <username>` | Interactively reset any user or admin password on the host (hidden prompt, revokes active sessions) |

### Resetting a Lost Admin Password

Regular users can have their passwords reset by any Admin in the **Users** screen. If you lose access to the Admin account, run the host-only recovery CLI from your server or Docker container:

```bash
# Local / bare-metal install
npm run reset-password -- admin

# Docker container
docker exec -it musicorbit npm run reset-password -- admin
```

Passwords are never accepted as command-line arguments (so they cannot leak into shell history); the CLI prompts with hidden input, hashes with `scrypt`, and immediately revokes all existing sessions for that account.

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
| `AUTH_ENABLED` | `true` | Enabled by default (first-run admin setup & login). Set to `false` only for local single-user dev |
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

## Legal Disclaimer

MusicOrbit is an open-source, self-hosted music library manager and audio player. It does **not** host, index, provide, or distribute any audio files or copyrighted material. Optional third-party integrations (such as `slskd`) are disabled by default and connect solely to user-configured external services. Users are solely responsible for ensuring they have the legal right to download, store, tag, and stream any media managed with this software in accordance with applicable laws in their jurisdiction.

## License

MusicOrbit is free software licensed under the [GNU Affero General Public License v3.0](LICENSE).
