import type {
  AlbumSummary,
  HealthResponse,
  ScanStatusResponse,
  TrackSummary,
} from "@musicorbit/shared";

/**
 * Typed wrapper around fetch for the MusicOrbit API.
 * Uses relative /api paths so Vite's dev proxy and production single-origin
 * deployments work identically without hardcoded hosts.
 */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>("/api/health");
}

export function fetchScanStatus(): Promise<ScanStatusResponse> {
  return getJson<ScanStatusResponse>("/api/library/scan/status");
}

export async function triggerScan(force = false): Promise<ScanStatusResponse> {
  const res = await fetch("/api/library/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  // 202 = scan started, 409 = scan already running (both return ScanStatusResponse)
  if (res.status !== 202 && res.status !== 409) {
    throw new Error(`Scan request failed with status ${res.status}`);
  }
  return (await res.json()) as ScanStatusResponse;
}

export function fetchAlbums(): Promise<AlbumSummary[]> {
  return getJson<AlbumSummary[]>("/api/albums");
}

export function fetchTracks(limit = 50): Promise<TrackSummary[]> {
  return getJson<TrackSummary[]>(`/api/tracks?limit=${limit}`);
}
