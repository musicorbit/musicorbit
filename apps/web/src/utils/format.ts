export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatTotalDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 60) {
    return `${Math.max(1, totalMins)} min`;
  }
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}

export function formatCodec(codec: string | null | undefined): string {
  if (!codec) return "AUDIO";
  const clean = codec.toUpperCase();
  if (clean.includes("FLAC")) return "FLAC";
  if (clean.includes("OPUS")) return "OPUS";
  if (clean.includes("MPEG") || clean.includes("MP3")) return "MP3";
  if (clean.includes("AAC")) return "AAC";
  if (clean.includes("VORBIS")) return "OGG";
  if (clean.includes("PCM") || clean.includes("WAV")) return "WAV";
  return clean.slice(0, 8);
}

export function formatBitrate(bitrate: number | null | undefined): string | null {
  if (!bitrate || !Number.isFinite(bitrate)) return null;
  return `${Math.round(bitrate / 1000)} kbps`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}
