import type {
  AcquisitionStatusResponse,
  AlbumDetailResponse,
  AlbumSummary,
  ApplyImportResponse,
  ApplyTaggingRequest,
  ArtistDetailResponse,
  ArtistImageCandidate,
  ArtistImageUpdateResponse,
  ArtistSummary,
  DownloadsListResponse,
  EditableTrackTags,
  EnqueueDownloadRequest,
  HealthResponse,
  ImportItemStatus,
  ImportsListResponse,
  InboxScanResult,
  MusicBrainzReleaseCandidate,
  MusicBrainzReleaseDetail,
  RetagAlbumResponse,
  ScanStatusResponse,
  SoulseekSearchResultsResponse,
  SoulseekSearchSummary,
  TrackMetadataResponse,
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
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request to ${url} failed with status ${res.status}`);
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

export function fetchAcquisitionStatus(): Promise<AcquisitionStatusResponse> {
  return getJson<AcquisitionStatusResponse>("/api/acquisition/status");
}

export async function startSoulseekSearch(query: string): Promise<SoulseekSearchSummary> {
  const res = await fetch("/api/acquisition/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Search failed (HTTP ${res.status})`);
  }
  return (await res.json()) as SoulseekSearchSummary;
}

export function fetchSoulseekSearchResults(
  searchId: string,
): Promise<SoulseekSearchResultsResponse> {
  return getJson<SoulseekSearchResultsResponse>(
    `/api/acquisition/search/${encodeURIComponent(searchId)}`,
  );
}

export async function deleteSoulseekSearch(searchId: string): Promise<void> {
  await fetch(`/api/acquisition/search/${encodeURIComponent(searchId)}`, {
    method: "DELETE",
  });
}

export async function enqueueSoulseekDownloads(payload: EnqueueDownloadRequest): Promise<void> {
  const res = await fetch("/api/acquisition/downloads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Download request failed (HTTP ${res.status})`);
  }
}

export function fetchDownloads(): Promise<DownloadsListResponse> {
  return getJson<DownloadsListResponse>("/api/acquisition/downloads");
}

export async function removeDownload(username: string, transferId: string): Promise<void> {
  const res = await fetch(
    `/api/acquisition/downloads/${encodeURIComponent(username)}/${encodeURIComponent(transferId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not remove transfer (HTTP ${res.status})`);
  }
}

export async function clearCompletedDownloads(): Promise<void> {
  const res = await fetch("/api/acquisition/downloads/completed", {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not clear completed downloads (HTTP ${res.status})`);
  }
}

export function fetchImports(status?: ImportItemStatus): Promise<ImportsListResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return getJson<ImportsListResponse>(`/api/imports${qs}`);
}

export async function scanInbox(): Promise<InboxScanResult> {
  const res = await fetch("/api/imports/scan", { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Inbox scan failed (HTTP ${res.status})`);
  }
  return (await res.json()) as InboxScanResult;
}

export async function applyImport(
  importId: number,
  payload: ApplyTaggingRequest,
): Promise<ApplyImportResponse> {
  const res = await fetch(`/api/imports/${importId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Import failed (HTTP ${res.status})`);
  }
  return (await res.json()) as ApplyImportResponse;
}

export async function dismissImport(importId: number): Promise<void> {
  const res = await fetch(`/api/imports/${importId}/dismiss`, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Dismiss failed (HTTP ${res.status})`);
  }
}

export function searchMusicBrainz(params: {
  artist?: string;
  album?: string;
  trackCount?: number;
}): Promise<MusicBrainzReleaseCandidate[]> {
  const sp = new URLSearchParams();
  if (params.artist?.trim()) sp.set("artist", params.artist.trim());
  if (params.album?.trim()) sp.set("album", params.album.trim());
  if (params.trackCount) sp.set("trackCount", String(params.trackCount));
  return getJson<MusicBrainzReleaseCandidate[]>(`/api/musicbrainz/search?${sp.toString()}`);
}

export function fetchMusicBrainzRelease(mbid: string): Promise<MusicBrainzReleaseDetail> {
  return getJson<MusicBrainzReleaseDetail>(
    `/api/musicbrainz/releases/${encodeURIComponent(mbid)}`,
  );
}

export async function retagAlbum(
  albumId: number,
  payload: ApplyTaggingRequest,
): Promise<RetagAlbumResponse> {
  const res = await fetch(`/api/albums/${albumId}/retag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Retag failed (HTTP ${res.status})`);
  }
  return (await res.json()) as RetagAlbumResponse;
}

export function fetchTrackMetadata(trackId: number): Promise<TrackMetadataResponse> {
  return getJson<TrackMetadataResponse>(`/api/tracks/${trackId}/metadata`);
}

export async function updateTrackMetadata(
  trackId: number,
  tags: EditableTrackTags,
): Promise<TrackMetadataResponse> {
  const res = await fetch(`/api/tracks/${trackId}/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tags),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to save metadata (HTTP ${res.status})`);
  }
  return (await res.json()) as TrackMetadataResponse;
}

export async function uploadTrackCover(
  trackId: number,
  file: File,
): Promise<TrackMetadataResponse> {
  const res = await fetch(`/api/tracks/${trackId}/cover`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to embed cover art (HTTP ${res.status})`);
  }
  return (await res.json()) as TrackMetadataResponse;
}

export async function deleteTrackCover(trackId: number): Promise<TrackMetadataResponse> {
  const res = await fetch(`/api/tracks/${trackId}/cover`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to remove embedded cover art (HTTP ${res.status})`);
  }
  return (await res.json()) as TrackMetadataResponse;
}
