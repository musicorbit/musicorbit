---
title: Audio Formats & Transcoding
description: Supported codecs, byte-range streaming, and automatic lossless ALAC-to-FLAC transcoding.
---

MusicOrbit streams your original files directly whenever the browser supports the codec, and transparently transcodes browser-incompatible lossless formats on the fly.

## Direct streaming

For browser-native formats — **FLAC**, **MP3**, **AAC (`.m4a` / `.aac`)**, **Ogg Vorbis**, **Opus**, and **WAV** — MusicOrbit serves your exact file from disk with full HTTP `206 Partial Content` byte-range support:

- Instant seeking to any timestamp, even on large hi-res FLAC files
- Zero re-encoding and zero quality loss
- Accurate duration, bitrate, sample rate, and codec badges displayed in the UI

## Automatic Lossless Transcoding (ALAC → FLAC)

Apple Lossless (**ALAC**, typically inside `.m4a` containers), **AIFF**, and **WMA** are not natively playable in Chrome, Firefox, or most non-Safari browsers.

Instead of failing with a playback error, MusicOrbit detects incompatible lossless codecs at stream time and **transparently converts them to lossless FLAC**:

1. **Lossless preservation:** Bit-for-bit lossless audio quality is preserved (no lossy MP3/AAC downgrade).
2. **Disk caching:** Converted streams are cached under `DATA_DIR/transcode-cache/` keyed by file path and modification time, so subsequent plays start instantaneously with full seeking support.
3. **Zero config encoder selection:**
   - Uses **`ffmpeg`** when available in `PATH` (standard on Linux, Docker, and Homebrew).
   - On **macOS**, automatically falls back to Apple's built-in `/usr/bin/afconvert` if `ffmpeg` is not installed.

## `ffmpeg` availability

- **Official Docker image (`ghcr.io/musicorbit/musicorbit`):** Bundles `ffmpeg` out of the box — ALAC, AIFF, and WMA playback works with zero extra setup.
- **macOS bare-metal:** Automatically uses Apple's built-in `/usr/bin/afconvert` if `ffmpeg` is not installed.
- **Linux / Windows bare-metal:** Install `ffmpeg` in `PATH` if you play ALAC/AIFF/WMA files. All standard `.flac`, `.mp3`, `.aac`, `.ogg`, `.opus`, and `.wav` files stream natively with zero external dependencies.
