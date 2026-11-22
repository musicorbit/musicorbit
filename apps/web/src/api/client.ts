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
  AuthStatusResponse,
  BrowseDirectoriesResponse,
  DownloadsListResponse,
  EditableTrackTags,
  EnqueueDownloadRequest,
  HealthResponse,
  ImportItemStatus,
  ImportM3u8Response,
  ImportsListResponse,
  InboxScanResult,
  MetadataProvider,
  MissingTrackBatchJobStatus,
  MusicBrainzReleaseCandidate,
  MusicBrainzReleaseDetail,
  PlaylistDetailResponse,
  PlaylistImportFormat,
  PlaylistSummary,
  RecheckMissingTracksResponse,
  RetagAlbumResponse,
  ScanStatusResponse,
  SoulseekSearchResultsResponse,
  SoulseekSearchSummary,
  SystemSettingsResponse,
  TrackMetadataResponse,
  TrackMetadataSuggestion,
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

export function lookupTrackMetadata(
  trackId: number,
  params: { provider: MetadataProvider; title?: string; artist?: string; album?: string },
): Promise<TrackMetadataSuggestion[]> {
  const sp = new URLSearchParams({ provider: params.provider });
  if (params.title?.trim()) sp.set("title", params.title.trim());
  if (params.artist?.trim()) sp.set("artist", params.artist.trim());
  if (params.album?.trim()) sp.set("album", params.album.trim());
  return getJson<TrackMetadataSuggestion[]>(
    `/api/tracks/${trackId}/metadata/lookup?${sp.toString()}`,
  );
}

export async function embedTrackCoverFromUrl(
  trackId: number,
  imageUrl: string,
): Promise<TrackMetadataResponse> {
  const res = await fetch(`/api/tracks/${trackId}/cover/from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to embed remote cover art (HTTP ${res.status})`);
  }
  return (await res.json()) as TrackMetadataResponse;
}

export function fetchPlaylists(): Promise<PlaylistSummary[]> {
  return getJson<PlaylistSummary[]>("/api/playlists");
}

export function fetchPlaylistDetail(playlistId: number): Promise<PlaylistDetailResponse> {
  return getJson<PlaylistDetailResponse>(`/api/playlists/${playlistId}`);
}

export async function createPlaylist(
  name: string,
  description = "",
): Promise<PlaylistSummary> {
  const res = await fetch("/api/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not create playlist (HTTP ${res.status})`);
  }
  return (await res.json()) as PlaylistSummary;
}

export async function deletePlaylist(playlistId: number): Promise<void> {
  const res = await fetch(`/api/playlists/${playlistId}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`Could not delete playlist (HTTP ${res.status})`);
  }
}

export async function addTracksToPlaylist(
  playlistId: number,
  trackIds: number[],
): Promise<PlaylistDetailResponse> {
  const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackIds }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not add tracks to playlist (HTTP ${res.status})`);
  }
  return (await res.json()) as PlaylistDetailResponse;
}

export async function removeTrackFromPlaylist(
  playlistId: number,
  trackId: number,
): Promise<PlaylistDetailResponse> {
  const res = await fetch(`/api/playlists/${playlistId}/tracks/${trackId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Could not remove track from playlist (HTTP ${res.status})`);
  }
  return (await res.json()) as PlaylistDetailResponse;
}

export async function reorderPlaylistTracks(
  playlistId: number,
  trackIds: number[],
): Promise<PlaylistDetailResponse> {
  const res = await fetch(`/api/playlists/${playlistId}/tracks/reorder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackIds }),
  });
  if (!res.ok) {
    throw new Error(`Could not reorder playlist (HTTP ${res.status})`);
  }
  return (await res.json()) as PlaylistDetailResponse;
}

export async function importPlaylistFile(
  name: string,
  content: string,
  format?: PlaylistImportFormat,
): Promise<ImportM3u8Response> {
  const res = await fetch("/api/playlists/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content, format }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not import playlist (HTTP ${res.status})`);
  }
  return (await res.json()) as ImportM3u8Response;
}

export async function recheckMissingPlaylistTracks(
  playlistId: number,
): Promise<RecheckMissingTracksResponse> {
  const res = await fetch(`/api/playlists/${playlistId}/recheck-missing`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not re-check library (HTTP ${res.status})`);
  }
  return (await res.json()) as RecheckMissingTracksResponse;
}

export async function dismissMissingPlaylistTrack(
  playlistId: number,
  missingId: number,
): Promise<PlaylistDetailResponse> {
  const res = await fetch(`/api/playlists/${playlistId}/missing/${missingId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not remove missing track (HTTP ${res.status})`);
  }
  return (await res.json()) as PlaylistDetailResponse;
}

export async function startMissingTracksBatchSearch(
  playlistId: number,
  options?: { missingTrackIds?: number[]; concurrency?: number },
): Promise<MissingTrackBatchJobStatus> {
  const res = await fetch(`/api/playlists/${playlistId}/missing/search-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options ?? {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not start Soulseek batch search (HTTP ${res.status})`);
  }
  return (await res.json()) as MissingTrackBatchJobStatus;
}

export function fetchMissingTracksBatchStatus(
  playlistId: number,
): Promise<MissingTrackBatchJobStatus> {
  return getJson<MissingTrackBatchJobStatus>(
    `/api/playlists/${playlistId}/missing/search-batch`,
  );
}

export async function cancelMissingTracksBatchSearch(
  playlistId: number,
): Promise<MissingTrackBatchJobStatus> {
  const res = await fetch(`/api/playlists/${playlistId}/missing/search-batch`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Could not cancel batch search (HTTP ${res.status})`);
  }
  return (await res.json()) as MissingTrackBatchJobStatus;
}

export async function downloadMissingPlaylistTrack(
  playlistId: number,
  missingId: number,
  candidate: { username: string; filename: string; size: number },
): Promise<{ queued: boolean; missingTrackId: number }> {
  const res = await fetch(`/api/playlists/${playlistId}/missing/${missingId}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(candidate),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not enqueue download (HTTP ${res.status})`);
  }
  return (await res.json()) as { queued: boolean; missingTrackId: number };
}

export function fetchSystemSettings(): Promise<SystemSettingsResponse> {
  return getJson<SystemSettingsResponse>("/api/system/settings");
}

export function browseServerDirectories(dirPath?: string): Promise<BrowseDirectoriesResponse> {
  const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
  return getJson<BrowseDirectoriesResponse>(`/api/system/browse-dirs${qs}`);
}

export async function updateMusicDirectory(
  dirPath: string,
  scanNow = true,
): Promise<SystemSettingsResponse> {
  const res = await fetch("/api/system/music-dir", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: dirPath, scanNow }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not update music directory (HTTP ${res.status})`);
  }
  return (await res.json()) as SystemSettingsResponse;
}

export function getPlaylistExportUrl(playlistId: number): string {
  return `/api/playlists/${playlistId}/export.m3u8`;
}

export function getPlaylistCoverUrl(playlistId: number, coverHash?: string | null): string {
  return coverHash
    ? `/api/playlists/${playlistId}/cover?v=${encodeURIComponent(coverHash)}`
    : `/api/playlists/${playlistId}/cover`;
}

export async function uploadPlaylistCover(
  playlistId: number,
  file: File,
): Promise<PlaylistSummary> {
  const res = await fetch(`/api/playlists/${playlistId}/cover`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not upload playlist cover (HTTP ${res.status})`);
  }
  return (await res.json()) as PlaylistSummary;
}

export async function setPlaylistCoverFromAlbum(
  playlistId: number,
  albumId: number,
): Promise<PlaylistSummary> {
  const res = await fetch(`/api/playlists/${playlistId}/cover/from-album`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not set playlist cover (HTTP ${res.status})`);
  }
  return (await res.json()) as PlaylistSummary;
}

export async function deletePlaylistCover(playlistId: number): Promise<PlaylistSummary> {
  const res = await fetch(`/api/playlists/${playlistId}/cover`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not reset playlist cover (HTTP ${res.status})`);
  }
  return (await res.json()) as PlaylistSummary;
}

export function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return getJson<AuthStatusResponse>("/api/auth/status");
}

export async function setupAdmin(
  username: string,
  password: string,
): Promise<AuthStatusResponse> {
  const res = await fetch("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Setup failed (HTTP ${res.status})`);
  }
  return (await res.json()) as AuthStatusResponse;
}

export async function loginUser(
  username: string,
  password: string,
): Promise<AuthStatusResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Login failed (HTTP ${res.status})`);
  }
  return (await res.json()) as AuthStatusResponse;
}

export async function logoutUser(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
