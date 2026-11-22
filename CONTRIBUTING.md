# Contributing to MusicOrbit

Thank you for your interest in contributing to **MusicOrbit**!

## Repository Layout

MusicOrbit is a TypeScript npm workspaces monorepo:

- `packages/shared/` — Shared TypeScript interfaces and API response contracts (`@musicorbit/shared`)
- `apps/api/` — Node.js 22 + Fastify v5 REST API, SQLite (`better-sqlite3` + Drizzle ORM), library scanner, tag writer, and optional `slskd` integration (`@musicorbit/api`)
- `apps/web/` — React 19 + Vite + Tailwind CSS v4 frontend (`@musicorbit/web`)

## Development Setup

1. Install **Node.js 22+** and npm.
2. Clone the repository and install dependencies:

   ```bash
   npm install
   cp .env.example .env
   ```

3. Place a few test audio files (`.flac`, `.mp3`, `.m4a`, `.opus`, etc.) into `./sample-music` (gitignored).
4. Start both the API (`http://localhost:3001`) and Web UI (`http://localhost:5173`):

   ```bash
   npm run dev
   ```

## Checks Before Opening a Pull Request

Please make sure all three commands pass cleanly:

```bash
npm run typecheck
npm test
npm run build
```

## Guidelines

- **No secrets or personal infrastructure:** Never commit `.env` files, API keys, personal domains, or local IP addresses.
- **Non-destructive database changes:** Schema migrations and startup initialization must remain safe for existing SQLite databases.
- **Test with temporary directories:** Automated tests should always use `os.tmpdir()` and clean up after themselves so user libraries are never modified.
- **License:** All contributions are licensed under the [GNU Affero General Public License v3.0](LICENSE).
