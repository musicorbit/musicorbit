# Security Policy

## Supported Versions

Security fixes are applied to the latest release on `main` and published to `ghcr.io/musicorbit/musicorbit:latest`.

| Version | Supported |
| :--- | :---: |
| Latest release (`0.1.x`) | Yes |
| Older releases | Please upgrade to latest |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please use GitHub's built-in **Private Vulnerability Reporting**:

- [Report a vulnerability privately](https://github.com/musicorbit/musicorbit/security/advisories/new)

Include as much detail as possible so the issue can be reproduced and fixed quickly:
- Steps to reproduce or proof of concept
- Affected endpoint, component, or configuration
- Your MusicOrbit version and deployment method (Docker vs. bare-metal)

We will acknowledge reports as soon as possible and coordinate a fix before public disclosure.

## Deployment Security Best Practices

- Keep `AUTH_ENABLED=true` (default) whenever MusicOrbit is reachable outside `localhost`.
- Serve MusicOrbit behind HTTPS (such as a Cloudflare Tunnel, Caddy, or Nginx reverse proxy) when accessing it over the internet.
- Rotate your **Subsonic App Password** in **System & Scanner** if a mobile device is lost or compromised.
- Never expose your `DATA_DIR/musicorbit.db` file directly to the web.
