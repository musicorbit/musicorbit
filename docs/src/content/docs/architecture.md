---
title: Architecture & Tech Stack
description: Monorepo layout, backend/frontend stack, database design, and developer scripts.
---

MusicOrbit is structured as a clean TypeScript monorepo with a single-container production build and a zero-dependency SQLite data store.

## Repository layout

```text
musicorbit/
├── packages/shared/   # Shared TypeScript API contracts & domain types
├── apps/api/          # Fastify v5 REST API, SQLite/Drizzle DB, scanner, tagger, importer, CLI
├── apps/web/          # React 19 + Vite + Tailwind CSS v4 single-page app
├── docs/              # Astro + Starlight landing page & documentation (musicorbit.app)
├── Dockerfile         # Multi-stage lean production container (Node 22 slim)
└── docker-compose.yml # MusicOrbit + optional slskd profile
```

## Core technology stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **Backend API** | Fastify v5 + TypeScript | High-performance REST API, multipart upload streaming, HTTP 206 audio range streaming |
| **Database** | SQLite (`better-sqlite3`, WAL mode) + Drizzle ORM | Zero-config relational storage for tracks, albums, artists, playlists, users, sessions, and logs |
| **Audio Metadata** | `music-metadata` + `node-taglib-sharp` | Fast tag scanning & native on-disk tag + embedded cover art writing |
| **Transcoding** | `ffmpeg` (macOS `/usr/bin/afconvert` fallback) | Transparent lossless ALAC/AIFF/WMA → cached FLAC streaming |
| **Frontend UI** | React 19 + Vite + Tailwind CSS v4 + Lucide | Single-page responsive dark UI with persistent audio player and sing-along lyrics |
| **Documentation** | Astro 5 + Starlight | Cosmic landing page and searchable static docs site deployed on Cloudflare Pages |

## Workspace scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Run Fastify API (`:4410`) and Vite Web UI (`:5173`) together in watch mode |
| `npm run dev:docs` | Run the Astro + Starlight docs site locally (`:4321`) |
| `npm run typecheck` | Type-check `@musicorbit/shared`, `@musicorbit/api`, and `@musicorbit/web` |
| `npm test` | Run the automated API & service test suite |
| `npm run build` | Build production bundles for shared, API, and web |
| `npm run build:docs` | Build the static documentation site into `docs/dist/` |
| `npm run reset-password -- <user>` | Interactively reset any user or admin password on the host |
