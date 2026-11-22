import type {
  AlbumDetailResponse,
  AlbumSummary,
  ArtistDetailResponse,
  ArtistImageCandidate,
  ArtistImageUpdateResponse,
  ArtistSummary,
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

export function fetchArtists(q?: string): Promise<ArtistSummary[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return getJson<ArtistSummary[]>(`/api/artists${qs ? `?${qs}` : ""}`);
}

export function fetchArtistDetail(id: number): Promise<ArtistDetailResponse> {
  return getJson<ArtistDetailResponse>(`/api/artists/${id}`);
}

export function fetchAlbums(q?: string, artistId?: number): Promise<AlbumSummary[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  if (artistId !== undefined) params.set("artistId", String(artistId));
  const qs = params.toString();
  return getJson<AlbumSummary[]>(`/api/albums${qs ? `?${qs}` : ""}`);
}

export function fetchAlbumDetail(id: number): Promise<AlbumDetailResponse> {
  return getJson<AlbumDetailResponse>(`/api/albums/${id}`);
}

export function fetchTracks(q?: string, limit = 200): Promise<TrackSummary[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  params.set("limit", String(limit));
  return getJson<TrackSummary[]>(`/api/tracks?${params.toString()}`);
}

export function getTrackStreamUrl(trackId: number): string {
  return `/api/tracks/${trackId}/stream`;
}

export function getAlbumCoverUrl(albumId: number, coverHash?: string | null): string | null {
  if (!coverHash) return null;
  // Appending the content hash as a cache-buster ensures updated covers reload immediately
  return `/api/albums/${albumId}/cover?v=${encodeURIComponent(coverHash)}`;
}

export function fetchArtistImageCandidates(
  artistId: number,
  q?: string,
): Promise<ArtistImageCandidate[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return getJson<ArtistImageCandidate[]>(
    `/api/artists/${artistId}/image/candidates${qs ? `?${qs}` : ""}`,
  );
}

export async function selectArtistImageFromUrl(
  artistId: number,
  imageUrl: string,
): Promise<ArtistImageUpdateResponse> {
  const res = await fetch(`/api/artists/${artistId}/image/from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to save image (HTTP ${res.status})`);
  }
  return (await res.json()) as ArtistImageUpdateResponse;
}

export async function uploadArtistImage(
  artistId: number,
  file: File,
): Promise<ArtistImageUpdateResponse> {
  const res = await fetch(`/api/artists/${artistId}/image`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to upload image (HTTP ${res.status})`);
  }
  return (await res.json()) as ArtistImageUpdateResponse;
}

export async function deleteArtistImage(artistId: number): Promise<ArtistImageUpdateResponse> {
  const res = await fetch(`/api/artists/${artistId}/image`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to remove image (HTTP ${res.status})`);
  }
  return (await res.json()) as ArtistImageUpdateResponse;
}
