/**
 * Shared TypeScript contracts between @musicorbit/api and @musicorbit/web.
 *
 * Keeping API response shapes here guarantees that backend and frontend
 * stay in sync at compile time.
 */

export interface LibraryCounts {
  artists: number;
  albums: number;
  tracks: number;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: "musicorbit";
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  database: {
    connected: boolean;
    path: string;
  };
  musicDir: {
    path: string;
    exists: boolean;
  };
  counts: LibraryCounts;
}

/**
 * Library scan job progress & history.
 */
export type ScanState = "idle" | "running" | "completed" | "failed";

export interface ScanStatusResponse {
  state: ScanState;
  jobId: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  filesTotal: number;
  filesProcessed: number;
  filesAdded: number;
  filesUpdated: number;
  filesSkipped: number;
  filesRemoved: number;
  errors: string[];
}

export interface TriggerScanRequest {
  force?: boolean;
}

/**
 * Core library domain types.
 */
export interface ArtistSummary {
  id: number;
  name: string;
  sortName: string;
  imageHash: string | null;
  fallbackAlbumId: number | null;
  albumCount: number;
  trackCount: number;
}

export interface AlbumSummary {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  year: number | null;
  genre: string | null;
  coverHash: string | null;
  trackCount: number;
  totalDurationSeconds: number;
}

export interface TrackSummary {
  id: number;
  title: string;
  albumId: number;
  albumTitle: string;
  artistId: number;
  artistName: string;
  trackNumber: number | null;
  discNumber: number | null;
  durationSeconds: number | null;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  filePath: string;
}

export interface AlbumDetailResponse {
  album: AlbumSummary;
  tracks: TrackSummary[];
}

export interface ArtistDetailResponse {
  artist: ArtistSummary;
  albums: AlbumSummary[];
  tracks: TrackSummary[];
}
