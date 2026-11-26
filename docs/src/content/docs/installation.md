---
title: Installation
description: Deploy MusicOrbit with a single pre-built Docker Compose image or run locally from source with Node.js 22+.
---

MusicOrbit ships as a single-container multi-architecture Docker image (`linux/amd64` and `linux/arm64`) published to GitHub Container Registry (`ghcr.io/musicorbit/musicorbit`). It bundles the Fastify API, React web UI, and `ffmpeg` on port `4410` — **no git clone or local build required**.

## Docker Compose (Recommended)

### 1. Create `docker-compose.yml`

Create a new folder on your server and save the following `docker-compose.yml`:

```yaml
services:
  musicorbit:
    image: ghcr.io/musicorbit/musicorbit:latest
    container_name: musicorbit
    restart: unless-stopped
    ports:
      - "4410:4410"
    environment:
      PORT: "4410"
      MUSIC_DIR: /music
      DATA_DIR: /data
      DOWNLOADS_DIR: /downloads
      AUTH_ENABLED: "true"
      FETCH_ARTIST_IMAGES: "true"
      AUTO_IMPORT_THRESHOLD: "85"
    volumes:
      - ./music:/music
      - ./data:/data
      - ./downloads:/downloads
```

Point `./music` to your existing audio collection (or leave it empty if you plan to upload music through the browser).

### 2. Start MusicOrbit

```bash
docker compose up -d
```

Open **http://localhost:4410** in your browser to complete [First-Run Setup](/first-run-setup/).

### Updating MusicOrbit

Pull the newest published image and recreate the container — your database, settings, and music files stay safely in `./data` and `./music`:

```bash
docker compose pull && docker compose up -d
```

### Available image tags

| Tag | Description |
| :--- | :--- |
| `latest` | Latest stable release (or latest build on `main`) |
| `vX.Y.Z` / `X.Y` | Pinned semantic version (e.g., `0.1.0`, `0.1`) |
| `edge` | Bleeding-edge build from every push to `main` |

### Optional: Start with bundled `slskd`

MusicOrbit works completely standalone without Soulseek. If you also want the optional bundled `slskd` daemon, download the full `docker-compose.yml` from GitHub, add your credentials to a local `.env` file, and enable the `soulseek` profile:

```bash
docker compose --profile soulseek up -d
```

See [Soulseek (`slskd`) Integration](/soulseek-slskd/) for configuration details.

---

## Local / Build From Source

Want to contribute or run bare-metal without Docker?

### Prerequisites

- **Node.js 22+** and **npm**
- Optional: **`ffmpeg`** installed in `PATH` (for lossless ALAC → FLAC transcoding on Linux/Windows; macOS automatically falls back to built-in `/usr/bin/afconvert` if `ffmpeg` is absent)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/musicorbit/musicorbit.git
cd musicorbit

# 2. Install dependencies across all workspaces
npm install

# 3. Copy the example environment file and edit paths as needed
cp .env.example .env

# 4. Start the API (:4410) and Web UI (:5173) in watch mode
npm run dev
```

Open **http://localhost:5173** in your browser.

### Production build (bare-metal)

```bash
npm run build
WEB_DIST_DIR=./apps/web/dist node apps/api/dist/index.js
```

## Health check

MusicOrbit exposes a lightweight health endpoint at `GET /api/health` (used automatically by the Docker `HEALTHCHECK`) returning service status, version, and database availability.
