---
title: Users & Isolated Libraries
description: Multi-user accounts, isolated per-user music folders, role permissions, and security architecture.
---

MusicOrbit supports full multi-user hosting out of the box so family members or friends can share one server while keeping their libraries completely private.

## Strict per-user isolation

Every user account owns:

- **A dedicated `musicDir` on disk:** By default, new accounts are automatically provisioned under `libraries/<username>`. MusicOrbit strictly rejects overlapping or nested user directories so two accounts can never overwrite or delete each other's files.
- **Scoped database records:** Artists, albums, tracks, playlists, uploads, and streaming/delete endpoints enforce user ownership (`IDOR` protection). User A cannot view, stream, edit, or delete User B's tracks or playlists.
- **Private onboarding & preferences:** Each user's settings and onboarding tour state live under their own `user_settings` row.

## Roles & permissions

| Capability | Admin | Member |
| :--- | :---: | :---: |
| Browse, stream, upload, tag & organize own library | Yes | Yes |
| Manage own playlists & `.m3u8` sync | Yes | Yes |
| Delete tracks & albums in own library | Yes | Yes |
| Change own password | Yes | Yes |
| View & export own Activity Logs | All users | Own logs |
| Clear Activity Logs | Yes | No |
| Create / edit / delete users & reset member passwords | Yes | No |
| Toggle per-user Soulseek (`slskd`) permission | Yes | No |
| Configure server-wide System settings | Yes | No |

## Security model

- **Salted `scrypt` password hashing:** Passwords are never stored in plaintext (each password uses a unique cryptographic salt).
- **Hashed session tokens:** Browser cookies store opaque session tokens (`HttpOnly`, `SameSite=Lax`), while only their **SHA-256 hashes** are persisted in SQLite `sessions`.
- **Session revocation on password change:** Changing or resetting a password immediately invalidates active sessions across other devices.
- **Brute-force rate limiting:** Repeated failed login attempts trigger automatic `HTTP 429 Too Many Requests` throttling.

## Managing users (Admin)

Open **Users** in the sidebar to:

- **Create a new user** with an isolated folder (or custom non-overlapping folder path).
- **Toggle Soulseek (`slskd`) access** (`OFF` by default for new members).
- **Reset a member's password** directly from the UI (immediately revoking their old sessions).
- **Delete a user account** (cleans up their sessions, settings, and library records without touching other users).
