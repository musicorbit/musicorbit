---
title: Password Recovery & Backups
description: Recover a lost member or Admin password safely and back up your MusicOrbit data.
---

Because MusicOrbit is 100% self-hosted with no external email service or cloud account, password recovery is intentionally handled through safe local controls.

## Resetting a member's password

Any **Admin** can reset a non-admin user's password directly in the web UI:

1. Open **Users** in the sidebar.
2. Click **Reset Password** next to the member's account.
3. Enter a temporary password (minimum 8 characters). All of that user's existing sessions are immediately revoked.

The member can sign in and change their password anytime from the key icon in the bottom-left account card.

## Resetting a lost Admin password (Host CLI)

If you lose access to the Admin account (or any account when locked out), run MusicOrbit's **host-only password-reset CLI** directly on the server or inside the Docker container:

### Docker container

```bash
docker exec -it musicorbit npm run reset-password -- admin
```

### Local / bare-metal install

```bash
npm run reset-password -- admin
```

### Security guarantees

- **Never accepts passwords as CLI arguments** — prevents passwords from leaking into shell history or `ps` process listings.
- **Hidden TTY prompt** with confirmation check.
- **Salted `scrypt` hashing** identical to the web API.
- **Immediate session revocation** — deletes all active rows in `sessions` for that user inside a SQLite transaction.
- **Audit trail** — records a `warn` entry in `activity_logs` noting the host CLI reset.

If you aren't sure of the exact username, running the command with a typo prints the list of existing usernames and roles.

---

## Backing up MusicOrbit

All MusicOrbit state lives in two clean places:

1. **`DATA_DIR`** (default `./data` or `/data` in Docker):
   - `musicorbit.db` (SQLite database — users, library index, playlists, settings, activity logs)
   - `covers/` (SHA-256 cached album art)
   - `artist-images/` (cached artist portraits)
   - *(Optional to exclude: `transcode-cache/` can always be regenerated automatically.)*
2. **`MUSIC_DIR`** (and any isolated member folders under `libraries/`):
   - Your actual audio files, `.lrc` lyrics sidecars, and `.m3u8` playlists.

### Safe live SQLite backup

Because SQLite runs in **WAL mode**, use SQLite's online backup command (or stop the container briefly) rather than copying `musicorbit.db` alone while active writes are occurring:

```bash
sqlite3 ./data/musicorbit.db ".backup './musicorbit-backup-$(date +%F).db'"
```
