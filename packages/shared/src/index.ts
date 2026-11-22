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

export interface ArtistImageCandidate {
  id: string;
  name: string;
  fans: number;
  previewUrl: string;
  imageUrl: string;
}

export interface ArtistImageUpdateResponse {
  artistId: number;
  imageHash: string | null;
}

/**
 * Soulseek acquisition & download types (Step 4 — slskd integration).
 */
export interface AcquisitionStatusResponse {
  provider: "slskd";
  configured: boolean;
  connected: boolean;
  loggedIn: boolean;
  url: string | null;
  version: string | null;
  error: string | null;
}

export interface SoulseekSearchSummary {
  id: string;
  query: string;
  state: string;
  isComplete: boolean;
  responseCount: number;
  fileCount: number;
}

export interface SoulseekFileItem {
  filename: string;
  basename: string;
  size: number;
  extension: string;
  bitRate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  lengthSeconds: number | null;
  isLocked: boolean;
}

export interface SoulseekReleaseGroup {
  id: string;
  username: string;
  directoryPath: string;
  folderName: string;
  format: string;
  isLossless: boolean;
  avgBitrate: number | null;
  trackCount: number;
  totalSizeBytes: number;
  hasFreeUploadSlot: boolean;
  uploadSpeed: number;
  queueLength: number;
  hasLockedFiles: boolean;
  files: SoulseekFileItem[];
}

export interface SoulseekSearchResultsResponse {
  search: SoulseekSearchSummary;
  groups: SoulseekReleaseGroup[];
}

export interface EnqueueDownloadFile {
  filename: string;
  size: number;
}

export interface EnqueueDownloadRequest {
  username: string;
  files: EnqueueDownloadFile[];
}

export interface DownloadTransferItem {
  id: string;
  username: string;
  directory: string;
  folderName: string;
  filename: string;
  basename: string;
  size: number;
  bytesTransferred: number;
  percentComplete: number;
  averageSpeed: number;
  state: string;
  isActive: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  requestedAt: string | null;
  endedAt: string | null;
}

export interface DownloadsListResponse {
  activeCount: number;
  completedCount: number;
  failedCount: number;
  transfers: DownloadTransferItem[];
}

/**
 * Import pipeline, MusicBrainz matching, and "Fix This Album" review queue (Step 5).
 */
export type ImportItemStatus = "needs_review" | "imported" | "failed" | "dismissed";

export interface MusicBrainzReleaseCandidate {
  mbid: string;
  title: string;
  artist: string;
  artistMbid: string | null;
  year: number | null;
  country: string | null;
  trackCount: number;
  score: number;
  coverArtUrl: string;
}

export interface MusicBrainzTrackInfo {
  discNumber: number;
  trackNumber: number;
  title: string;
  artist: string;
  recordingMbid: string;
  durationSeconds: number | null;
}

export interface MusicBrainzReleaseDetail {
  mbid: string;
  title: string;
  artist: string;
  artistMbid: string | null;
  year: number | null;
  country: string | null;
  coverArtUrl: string;
  tracks: MusicBrainzTrackInfo[];
}

export interface ImportSourceFile {
  filePath: string;
  basename: string;
  extension: string;
  currentTitle: string;
  currentArtist: string;
  currentAlbum: string;
  trackNumber: number | null;
  discNumber: number | null;
  durationSeconds: number | null;
}

export interface ImportItemSummary {
  id: number;
  sourceDir: string;
  folderName: string;
  status: ImportItemStatus;
  detectedArtist: string;
  detectedAlbum: string;
  detectedYear: number | null;
  trackCount: number;
  confidence: number;
  matchedMbid: string | null;
  matchedArtist: string | null;
  matchedAlbum: string | null;
  matchedYear: number | null;
  matchedCoverUrl: string | null;
  candidates: MusicBrainzReleaseCandidate[];
  files: ImportSourceFile[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportsListResponse {
  downloadsDir: {
    path: string;
    exists: boolean;
  };
  needsReviewCount: number;
  items: ImportItemSummary[];
}

export interface InboxScanResult {
  discoveredFolders: number;
  autoImported: number;
  needsReview: number;
  skipped: number;
  failed: number;
}

export interface RetagTrackOverride {
  filePath: string;
  title: string;
  artist?: string;
  trackNumber: number | null;
  discNumber: number | null;
  recordingMbid?: string | null;
}

export interface ApplyTaggingRequest {
  artist: string;
  album: string;
  year: number | null;
  genre?: string | null;
  mbid?: string | null;
  artistMbid?: string | null;
  tracks: RetagTrackOverride[];
}

export interface ApplyImportResponse {
  importId: number;
  status: ImportItemStatus;
  destinationDir: string;
  filesImported: number;
}

export interface RetagAlbumResponse {
  albumId: number;
  filesUpdated: number;
}

/**
 * Full on-demand track metadata inspection & editing.
 */
export interface EditableTrackTags {
  title: string;
  artists: string;
  albumArtist: string;
  album: string;
  trackNumber: number | null;
  trackTotal: number | null;
  discNumber: number | null;
  discTotal: number | null;
  year: number | null;
  genres: string;
  composers: string;
  bpm: number | null;
  grouping: string;
  publisher: string;
  comment: string;
  lyrics: string;
  musicBrainzTrackId: string;
  musicBrainzReleaseId: string;
  musicBrainzArtistId: string;
  musicBrainzReleaseArtistId: string;
}

export interface TrackTechnicalInfo {
  codec: string | null;
  container: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitsPerSample: number | null;
  channels: number | null;
  durationSeconds: number | null;
  tagTypes: string[];
}

export interface TrackMetadataResponse {
  trackId: number;
  albumId: number;
  filePath: string;
  basename: string;
  fileSize: number;
  technical: TrackTechnicalInfo;
  tags: EditableTrackTags;
  hasEmbeddedCover: boolean;
  embeddedCoverMime: string | null;
  embeddedCoverSizeBytes: number | null;
}

export type MetadataProvider = "deezer" | "musicbrainz" | "lrclib";

export interface TrackMetadataSuggestion {
  id: string;
  provider: MetadataProvider;
  title: string;
  subtitle: string;
  coverArtUrl: string | null;
  fields: Partial<EditableTrackTags>;
}
