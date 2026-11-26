# MusicOrbit Docs & Landing Page (`musicorbit.app`)

Built with [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/).

## Local Development

```bash
# From the repository root:
npm run dev:docs

# Or inside docs/:
cd docs
npm install
npm run dev
```

Open **http://localhost:4321**.

## Production Build

```bash
npm run build:docs
```

Static output is generated in `docs/dist/`.

## Deploying on Cloudflare Pages

1. In the Cloudflare Dashboard, open **Workers & Pages → Create → Pages → Connect to Git**.
2. Select your `musicorbit` repository and configure:
   - **Root directory:** `docs`
   - **Framework preset:** `Astro`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variable:** `NODE_VERSION = 22`
3. Under **Custom domains**, add `musicorbit.app` (and optionally `www.musicorbit.app`).

## Replacing Landing Page Screenshots

The landing page carousel (`src/data/slides.ts`) automatically picks up real screenshots when you drop them into `docs/public/screenshots/` using the exact slugs below (`.webp` or `.png` automatically overrides the bundled `.svg` preview):

- **Recommended aspect ratio:** `1200 × 696` (or `2400 × 1392` Retina / `1600 × 928` crisp desktop)
- **Filenames:**
  1. `01-library-albums.png`
  2. `02-album-detail.png`
  3. `03-sing-along-lyrics.png`
  4. `04-metadata-editor.png`
  5. `05-playlists.png`
  6. `06-upload-organize.png`
  7. `07-users-admin.png`
  8. `08-activity-logs.png`
