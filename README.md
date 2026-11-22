# MusicOrbit

A self-hosted, open-source music library, browser player, and acquisition hub.

> **Status:** Early development (Step 1 — monorepo foundation, SQLite setup, health API, and web shell).

## Tech Stack

- **Monorepo:** npm workspaces (`packages/shared`, `apps/api`, `apps/web`)
- **Backend:** Node.js 22, TypeScript, Fastify, SQLite (`better-sqlite3` + Drizzle ORM)
- **Frontend:** React, Vite, TypeScript, Tailwind CSS
- **License:** GNU AGPL v3.0

## Project Structure

```text
musicorbit/
├── packages/shared/   # Shared TypeScript types & API contracts
├── apps/api/          # Fastify REST API & SQLite database layer
└── apps/web/          # React + Vite frontend
```

## Local Development

### Prerequisites

- Node.js 22+ and npm

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file
cp .env.example .env

# 3. Start both the API (port 3001) and Web UI (port 5173)
npm run dev
```

Then open http://localhost:5173 in your browser.

### Useful Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API and Web UI together in watch mode |
| `npm run dev:api` | Run only the Fastify backend |
| `npm run dev:web` | Run only the Vite frontend |
| `npm run typecheck` | Type-check all workspaces |
| `npm run build` | Production build for all workspaces |

## License

MusicOrbit is free software licensed under the [GNU Affero General Public License v3.0](LICENSE).
