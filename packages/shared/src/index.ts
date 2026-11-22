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
 * Core library domain types (populated in Step 2 by the library scanner).
 */
export interface ArtistSummary {
  id: number;
  name: string;
  sortName: string;
  albumCount: number;
  trackCount: number;
}

export interface AlbumSummary {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  year: number | null;
  coverHash: string | null;
  trackCount: number;
}

export interface TrackSummary {
  id: number;
  title: string;
  albumId: number;
  artistId: number;
  trackNumber: number | null;
  discNumber: number | null;
  durationSeconds: number | null;
  codec: string | null;
  bitrate: number | null;
}
