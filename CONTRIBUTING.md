# Contributing to MusicOrbit

Thanks for your interest in contributing to **MusicOrbit**!

## Before Opening a Large PR

- **Bug fixes & small improvements:** Feel free to open a pull request directly.
- **New features or architectural changes:** Please [open an issue](https://github.com/musicorbit/musicorbit/issues/new/choose) first to discuss the idea and make sure it fits the project scope before investing heavy coding time.

## Local Development Setup

Requirements: **Node.js 24+** (see `.nvmrc`) and **npm**. (`ffmpeg` is optional locally, needed only if testing ALAC → FLAC transcoding.)

```bash
git clone https://github.com/musicorbit/musicorbit.git
cd musicorbit
cp .env.example .env
npm install
npm run dev
```

- Web UI (Vite): `http://localhost:5173`
- API server (Fastify): `http://localhost:4410`
- Documentation site (Astro + Starlight): `npm --prefix docs install && npm run dev:docs` (`http://localhost:4321`)

## Pull Request Checklist

Before submitting a PR, please make sure all checks pass locally:

```bash
npm run typecheck
npm test
npm run build
```

If you changed documentation in `docs/`, also verify:

```bash
npm run build:docs
```

Please keep PRs focused, add tests for new API routes or services, and respect per-user library isolation (`user_id`) in every database query.

## License

By contributing to MusicOrbit, you agree that your contributions will be licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** — see [LICENSE](./LICENSE).
