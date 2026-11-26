---
title: Privacy Policy
description: How MusicOrbit handles privacy across the self-hosted application and the musicorbit.app website.
---

MusicOrbit is built around local-first self-hosting and minimal data collection. This page explains clearly what happens in both the **self-hosted MusicOrbit app** and the **`musicorbit.app` documentation website**.

*Last updated: November 2026*

---

## 1. The Self-Hosted MusicOrbit Application

When you run MusicOrbit on your own hardware or Docker server:

- **Zero telemetry & zero phone-home:** MusicOrbit does **not** include analytics, crash reporting, usage tracking, or any central MusicOrbit servers.
- **Local storage only:** Your audio library index, user accounts (hashed with salted `scrypt`), session hashes, playlists, and activity logs remain strictly inside your own `DATA_DIR/musicorbit.db` SQLite database and music directories.
- **Session cookies:** MusicOrbit sets a single strictly necessary `HttpOnly` session cookie (`musicorbit_session`) solely to keep you signed in to your own server.

### Optional third-party metadata providers

MusicOrbit only contacts external services to fetch metadata, artwork, or lyrics when enabled or triggered by you:

| Service | When it is contacted | How to disable |
| :--- | :--- | :--- |
| **Deezer API** | Fetching artist portraits, album art, single-track metadata, or full tracklists | Set `FETCH_ARTIST_IMAGES=false` to stop automatic portrait lookups; other lookups only run when you click them |
| **MusicBrainz API** | Matching albums during import, **Fix Tags**, or track metadata lookups | Only runs during import or when triggered in the UI |
| **LRCLIB API** | Fetching synced `.lrc` lyrics | Only runs when opening Lyrics, running Batch Fetch, or when **Auto-Fetch Lyrics** is enabled in System Settings |
| **Self-hosted `slskd`** | Only if an Admin explicitly configures a `slskd` URL in **System & Scanner** | Disabled by default; click **Disconnect** anytime |

Requests to those services come directly from your server (not through any MusicOrbit-operated proxy) and are subject to each provider's own privacy policy.

---

## 2. The `musicorbit.app` Website

The landing page and documentation at **https://musicorbit.app** are static pages hosted on **Cloudflare Pages**:

- **No advertising trackers or third-party tracking cookies:** We do not run Google Analytics, ad networks, social pixels, or cross-site trackers.
- **Self-hosted fonts:** Fonts are bundled and served directly from `musicorbit.app` — your browser never contacts Google Fonts.
- **Hosting & aggregate traffic metrics (Cloudflare):** As our CDN and hosting provider, [Cloudflare](https://www.cloudflare.com/privacypolicy/) processes standard HTTP request metadata (such as IP address, requested URL, and user agent) for DDoS protection, caching, and cookieless aggregate traffic/pageview analytics (**Cloudflare Web Analytics**). No personal profiles or tracking cookies are created.
- **GitHub star counter:** To display the public star count in the navbar, your browser makes a direct request to the public GitHub API (`api.github.com/repos/musicorbit/musicorbit`) and caches the number in `localStorage` for 15 minutes.
- **Local browser preferences (`localStorage`):** Used solely to remember your chosen Light/Dark documentation theme and the 15-minute star-count cache.

---

## 3. Open-Source Transparency & Contact

MusicOrbit's entire source code — including both the self-hosted application and this documentation site — is open source under the **AGPL-3.0** license and auditable at **[github.com/musicorbit/musicorbit](https://github.com/musicorbit/musicorbit)**.

If you have questions or spot a privacy concern, please open an issue on [GitHub](https://github.com/musicorbit/musicorbit/issues).
