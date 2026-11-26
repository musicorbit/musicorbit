---
title: Reverse Proxy & HTTPS
description: Expose MusicOrbit over HTTPS using Cloudflare Tunnel, Caddy, Nginx, or Traefik with PWA and large upload support.
---

When exposing MusicOrbit beyond `localhost`, put it behind HTTPS so login credentials, `HttpOnly` session cookies, and audio uploads travel over TLS — and so mobile/desktop **PWA installation** works seamlessly.

## Cloudflare Tunnel (`cloudflared`) — No Open Ports

If you already use **Cloudflare Zero Trust Tunnels**, you do not need Nginx, Caddy, or router port-forwarding:

1. In the Cloudflare Zero Trust dashboard, open **Networks → Tunnels** and select your tunnel.
2. Add a **Public Hostname** (for example, `music.example.com`):
   - **Type:** `HTTP`
   - **URL:** `musicorbit:4410` (if `cloudflared` shares the same Docker network) or `localhost:4410` (if running on the host).
3. Save the hostname — Cloudflare automatically provisions HTTPS certificates and proxies HTTP `206 Partial Content` audio streaming and PWA assets out of the box.

:::tip[Cloudflare Free Plan Upload Limit]
Cloudflare's free plan caps individual HTTP requests at **100 MB**. Because MusicOrbit uploads tracks **file-by-file**, entire multi-track FLAC albums upload smoothly as long as no *single* audio file exceeds 100 MB. For very large single files (e.g., 20-minute 24-bit/192 kHz tracks), place them directly into `/music` or use **Bulk Import**. Avoid adding custom "Cache Everything" rules on `/api/*` so auth cookies and audio streams stay dynamic.
:::

## Caddy (Automatic HTTPS)

```txt title="Caddyfile"
music.example.com {
    reverse_proxy 127.0.0.1:4410
}
```

Caddy automatically provisions and renews Let's Encrypt certificates and streams large uploads and byte-range audio requests out of the box.

## Nginx

Ensure `client_max_body_size` is large enough for lossless FLAC uploads and disable request buffering for smooth upload streaming:

```nginx
server {
    listen 443 ssl http2;
    server_name music.example.com;

    # Allow large lossless audio uploads
    client_max_body_size 512M;

    location / {
        proxy_pass http://127.0.0.1:4410;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Stream uploads & byte-range audio without buffering
        proxy_request_buffering off;
        proxy_buffering off;
    }
}
```

## Traefik (Docker Labels)

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.musicorbit.rule=Host(`music.example.com`)"
  - "traefik.http.routers.musicorbit.entrypoints=websecure"
  - "traefik.http.routers.musicorbit.tls.certresolver=letsencrypt"
  - "traefik.http.services.musicorbit.loadbalancer.server.port=4410"
```

## Security reminders

- Keep `AUTH_ENABLED=true` whenever MusicOrbit is reachable over a LAN or the public internet.
- If you ever lose access to your Admin account on a remote server, you can recover it safely from the host shell via `docker exec -it musicorbit npm run reset-password -- admin` (see [Password Recovery & Backups](/password-recovery/)).
