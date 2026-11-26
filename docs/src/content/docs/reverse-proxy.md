---
title: Reverse Proxy & HTTPS
description: Put MusicOrbit behind Caddy, Nginx, or Traefik with TLS and large audio upload support.
---

When exposing MusicOrbit beyond `localhost`, place it behind a reverse proxy with HTTPS so login credentials, session cookies, and audio uploads travel over TLS.

## Caddy (Simplest — Automatic HTTPS)

```txt title="Caddyfile"
music.example.com {
    reverse_proxy 127.0.0.1:4410
}
```

Caddy automatically provisions and renews Let's Encrypt certificates and streams large uploads and byte-range audio requests out of the box.

## Nginx

Ensure `client_max_body_size` is large enough for lossless FLAC album uploads and disable request buffering for smooth upload streaming:

```nginx
server {
    listen 443 ssl http2;
    server_name music.example.com;

    # Allow large lossless audio / folder uploads
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

## Tips

- Keep `AUTH_ENABLED=true` whenever MusicOrbit is reachable over a LAN or the public internet.
- If using Cloudflare Tunnel (`cloudflared`), point the tunnel service to `http://musicorbit:4410` (or `http://localhost:4410`). Note that Cloudflare's free plan enforces a 100 MB per-request upload limit, so upload multi-track albums as individual files (which MusicOrbit already uploads file-by-file!).
