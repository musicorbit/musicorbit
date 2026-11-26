---
title: Soulseek (slskd) Integration
description: Optional integration with a self-hosted slskd instance, per-user permissions, and automatic per-user download routing.
---

MusicOrbit is designed to work **100% standalone** as a local music library, tagger, and player. If you run a self-hosted **[slskd](https://github.com/slskd/slskd)** instance, you can optionally connect it to MusicOrbit for integrated search and transfer tracking.

## Connecting `slskd` (Recommended: In the UI)

You don't need to edit `.env` or restart your container to connect `slskd`:

1. Sign in as an **Admin** and open **System & Scanner**.
2. Scroll to **Optional Integration: slskd (Soulseek)**.
3. Enter your **slskd Server URL** (e.g., `http://localhost:5030` or `http://slskd:5030`) and **API Key** (matching a key configured under `web.authentication.api_keys` in your `slskd.yml`).
4. Click **Test Connection** to verify connectivity, then click **Save slskd Settings**.

Settings are saved directly in MusicOrbit's SQLite database and take effect immediately — the **Soulseek Search** view and per-user toggles appear right away (and clicking **Disconnect** hides them again cleanly).

### Optional: Configure via `.env` instead

If you prefer declarative Docker Compose / `.env` configuration, MusicOrbit also supports optional fallback variables (any settings saved in the UI take precedence):

```bash
SLSKD_URL=http://slskd:5030
SLSKD_API_KEY=your_slskd_api_key
```

### Using the bundled Docker Compose profile

MusicOrbit's `docker-compose.yml` includes an optional `slskd` service under the `soulseek` profile:

```bash
# In your local .env (never commit credentials)
SLSKD_SLSK_USERNAME=your_soulseek_username
SLSKD_SLSK_PASSWORD=your_soulseek_password
SLSKD_API_KEY=choose_a_random_api_key

# Start MusicOrbit + slskd together
docker compose --profile soulseek up -d
```

Make sure both containers share the same `./downloads:/downloads` mount so MusicOrbit's [Import Pipeline](/import-pipeline/) can pick up completed transfers.

## Per-user Soulseek permissions

In a multi-user setup, **Soulseek access is disabled (`OFF`) by default** for every new non-admin user:

- Users without permission never see the Search / Acquisition UI and receive `403 Forbidden` on acquisition API endpoints.
- Any Admin can toggle Soulseek access per user on the **Users** screen.
- When an authorized user queues a download, MusicOrbit records `download_ownership` so the Import Pipeline automatically moves the finished files directly into **that user's private library folder**.

## Smart result ranking

Search results returned by `slskd` are grouped by album folder, filtered to audio files only, and ranked with **lossless FLAC** and **peers with free upload slots** prioritized at the top.

:::note[Responsibility notice]
MusicOrbit does not host, index, or distribute copyrighted files. Users are solely responsible for complying with applicable laws when connecting external third-party services.
:::
