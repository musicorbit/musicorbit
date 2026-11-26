---
title: First-Run Setup
description: Creating your initial Admin account and taking the interactive onboarding tour.
---

Authentication is enabled by default (`AUTH_ENABLED=true`) so your MusicOrbit server is never exposed unprotected on your network.

## 1. Create the Admin account

When you open MusicOrbit for the first time on a fresh database, you are automatically directed to the **Admin Setup** screen:

1. Choose an **Admin username** (e.g., `admin`).
2. Enter a strong **password** (minimum 8 characters). Passwords are hashed locally with salted `scrypt` — never stored in plaintext.
3. Click **Create Admin Account**.

MusicOrbit creates your admin user, signs you in with an `HttpOnly` session cookie, and points your Admin library to `MUSIC_DIR`.

## 2. Interactive Onboarding Tour (Desktop)

Right after your first sign-in on desktop (`>= 1024px`), MusicOrbit launches a **role-aware guided spotlight tour** that walks you through:

- Browsing **Albums**, **Artists**, **Tracks**, and **Playlists**
- Uploading audio files directly from your browser
- Fixing tags, cover art, and synced sing-along lyrics
- Checking **Activity Logs** for scans, uploads, and imports
- Managing your account password — and, for Admins, creating isolated users and configuring **System** settings

Your tour completion state is saved per user in SQLite. You can replay the walkthrough anytime on desktop by clicking the **`?`** button in the bottom-left account card. *(The tour is automatically skipped on mobile/tablet screens without marking it done, so you'll still see it the first time you open MusicOrbit on desktop.)*

## 3. Scan your existing music

If you mounted an existing folder at `MUSIC_DIR`, click **Scan** in the top header (or open **System & Scanner**) to index your tracks, extract embedded cover art, and fetch artist portraits.

:::tip[Local-only development]
Running MusicOrbit on a completely private localhost-only machine for development? You can set `AUTH_ENABLED=false` in `.env` to bypass login. For any LAN or internet-facing server, always keep `AUTH_ENABLED=true`.
:::
