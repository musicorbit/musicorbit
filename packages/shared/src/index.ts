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

export type AlbumTracklistProvider = "musicbrainz" | "deezer";

export interface AlbumReleaseOption {
  id: string; // e.g. "deezer:12345" or "mb:<uuid>"
  provider: AlbumTracklistProvider;
  title: string;
  artist: string;
  year: number | null;
  country: string | null;
  trackCount: number;
}

export interface AlbumExpectedTrack {
  discNumber: number;
  trackNumber: number;
  title: string;
  artist: string;
  durationSeconds: number | null;
  ownedTrackId: number | null;
}

export interface AlbumTracklistResponse {
  albumId: number;
  provider: AlbumTracklistProvider | null;
  selectedRelease: AlbumReleaseOption | null;
  releases: AlbumReleaseOption[];
  tracks: AlbumExpectedTrack[];
  ownedCount: number;
  missingCount: number;
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
  codec?: string | null;
  bitrate?: number | null;
}

export interface ImportDuplicateMatch {
  sourceFilePath: string;
  existingTrackId: number;
  existingTitle: string;
  existingArtist: string;
  existingAlbum: string;
  existingCodec: string | null;
  existingBitrate: number | null;
  existingFilePath: string;
  isUpgrade: boolean;
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
  duplicates?: ImportDuplicateMatch[];
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
  coverArtUrl?: string | null;
  duplicateResolution?: "policy" | "replace" | "keep_both" | "skip";
  tracks: RetagTrackOverride[];
}

export interface ApplyImportResponse {
  importId: number;
  status: ImportItemStatus;
  destinationDir: string;
  filesImported: number;
  duplicatesSkipped?: number;
  duplicatesUpgraded?: number;
  playlistsBackfilled?: number;
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

/**
 * Playlists & M3U8 / CSV import/export (Step 6+).
 */
export interface PlaylistSummary {
  id: number;
  name: string;
  description: string;
  trackCount: number;
  missingCount: number;
  totalDurationSeconds: number;
  coverAlbumId: number | null;
  coverHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistMissingTrack {
  id: number;
  playlistId: number;
  position: number;
  title: string;
  artist: string;
  album: string | null;
  status: "missing" | "queued";
}

export interface PlaylistDetailResponse {
  playlist: PlaylistSummary;
  tracks: TrackSummary[];
  missingTracks: PlaylistMissingTrack[];
}

export type PlaylistImportFormat = "m3u8" | "csv";

export interface ImportM3u8Response {
  playlist: PlaylistSummary;
  format: PlaylistImportFormat;
  matchedCount: number;
  missingCount: number;
  unmatchedEntries: string[];
  missingTracks: PlaylistMissingTrack[];
}

export interface RecheckMissingTracksResponse {
  playlist: PlaylistSummary;
  newlyMatchedCount: number;
  remainingMissingCount: number;
  tracks: TrackSummary[];
  missingTracks: PlaylistMissingTrack[];
}

export interface MissingTrackSearchCandidate {
  username: string;
  filename: string;
  basename: string;
  directoryPath: string;
  folderName: string;
  size: number;
  extension: string;
  bitRate: number | null;
  isLossless: boolean;
  hasFreeUploadSlot: boolean;
  uploadSpeed: number;
  queueLength: number;
}

export type MissingTrackBatchItemStateValue =
  | "pending"
  | "searching"
  | "found"
  | "not_found"
  | "queued"
  | "error";

export interface MissingTrackBatchItemState {
  missingTrackId: number;
  title: string;
  artist: string;
  album: string | null;
  state: MissingTrackBatchItemStateValue;
  candidates: MissingTrackSearchCandidate[];
  error: string | null;
}

export interface MissingTrackBatchJobStatus {
  playlistId: number;
  state: "idle" | "running" | "completed" | "cancelled";
  concurrencyLimit: number;
  total: number;
  completed: number;
  foundCount: number;
  notFoundCount: number;
  errorCount: number;
  items: MissingTrackBatchItemState[];
}

/**
 * Dynamic system settings, post-processing pipeline & server folder browser.
 */
export type ImportFileAction = "move" | "copy";
export type DuplicatePolicy = "upgrade" | "review" | "skip";

export interface PostProcessingSettings {
  downloadsDir: string;
  defaultDownloadsDir: string;
  downloadsDirExists: boolean;
  fileAction: ImportFileAction;
  duplicatePolicy: DuplicatePolicy;
  autoWatchEnabled: boolean;
  autoWatchIntervalSeconds: number;
  autoImportThreshold: number;
  includeYearInAlbumFolder: boolean;
  autoEmbedCoverArt: boolean;
  autoFetchLyrics: boolean;
}

export interface InboxWatcherStatus {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;
  lastCheckAt: string | null;
  lastError: string | null;
  lastResult: InboxScanResult | null;
}

export interface PlaylistSyncSettings {
  enabled: boolean;
  playlistsDir: string;
  defaultPlaylistsDir: string;
  playlistsDirExists: boolean;
}

export interface PlaylistSyncRunResult {
  syncedCount: number;
  playlistsDir: string;
  files: string[];
}

/**
 * Library organization layout presets, preview/apply organizer, and bulk folder import.
 */
export type LibraryLayoutPreset =
  | "artist_album_track"
  | "artist_track"
  | "flat"
  | "keep_existing";

export type MultiDiscStyle = "prefix" | "subfolder";

export interface LibraryOrganizationSettings {
  layoutPreset: LibraryLayoutPreset;
  includeYearInAlbumFolder: boolean;
  includeTrackNumber: boolean;
  multiDiscStyle: MultiDiscStyle;
  autoOrganizeLibrary: boolean;
}

export type OrganizePlanStatus =
  | "move"
  | "already_organized"
  | "skipped_untagged"
  | "conflict";

export interface OrganizeTrackPlanItem {
  trackId: number;
  title: string;
  artistName: string;
  albumTitle: string;
  currentPath: string;
  currentRelativePath: string;
  targetPath: string;
  targetRelativePath: string;
  status: OrganizePlanStatus;
  reason?: string;
}

export interface OrganizePreviewResponse {
  musicDir: string;
  layoutPreset: LibraryLayoutPreset;
  totalTracks: number;
  toMoveCount: number;
  alreadyOrganizedCount: number;
  skippedUntaggedCount: number;
  conflictCount: number;
  items: OrganizeTrackPlanItem[];
}

export interface OrganizeApplyResponse {
  movedCount: number;
  alreadyOrganizedCount: number;
  skippedCount: number;
  conflictCount: number;
  errorCount: number;
  errors: string[];
  playlistsResynced: boolean;
}

export interface BulkImportFolderRequest {
  sourceDir: string;
  fileAction: ImportFileAction;
}

export interface BulkImportFolderResponse extends InboxScanResult {
  sourceDir: string;
  fileAction: ImportFileAction;
}

export interface SystemSettingsResponse {
  musicDir: string;
  defaultMusicDir: string;
  musicDirExists: boolean;
  isOverridden: boolean;
  downloadsDir: string;
  postProcessing: PostProcessingSettings;
  libraryOrganization: LibraryOrganizationSettings;
  playlistSync: PlaylistSyncSettings;
  watcher: InboxWatcherStatus;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseDirectoriesResponse {
  currentPath: string;
  parentPath: string | null;
  exists: boolean;
  directories: DirectoryEntry[];
  quickPaths: Array<{ label: string; path: string }>;
}

/**
 * Activity Logs for operational visibility (scanner, post-processing, watcher, playlists, etc.).
 */
export type ActivityLogLevel = "info" | "success" | "warn" | "error";

export type ActivityLogCategory =
  | "scanner"
  | "importer"
  | "organizer"
  | "lyrics"
  | "watcher"
  | "playlist"
  | "metadata"
  | "acquisition"
  | "system";

export interface ActivityLogEntry {
  id: number;
  level: ActivityLogLevel;
  category: ActivityLogCategory;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityLogsResponse {
  total: number;
  entries: ActivityLogEntry[];
}

/**
 * Optional authentication & first-run setup (Step 6).
 */
export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "user";
  musicDir: string;
  canUseSoulseek: boolean;
  onboardingCompleted: boolean;
}

export interface AuthStatusResponse {
  authEnabled: boolean;
  needsSetup: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}

export interface UserSummary {
  id: number;
  username: string;
  role: "admin" | "user";
  musicDir: string;
  canUseSoulseek: boolean;
  createdAt: string;
  counts: {
    artists: number;
    albums: number;
    tracks: number;
    playlists: number;
  };
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role?: "admin" | "user";
  musicDir?: string;
  canUseSoulseek?: boolean;
}

export interface UpdateUserRequest {
  role?: "admin" | "user";
  musicDir?: string;
  canUseSoulseek?: boolean;
  password?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * Synced sing-along lyrics (LRCLIB + .lrc sidecar files + SQLite cache).
 */
export interface SyncedLyricLine {
  timeSeconds: number;
  text: string;
}

export type TrackLyricsSource = "sidecar" | "embedded" | "lrclib" | "none";

export interface TrackLyricsResponse {
  trackId: number;
  hasSynced: boolean;
  hasPlain: boolean;
  instrumental: boolean;
  source: TrackLyricsSource;
  syncedLines: SyncedLyricLine[];
  plainLyrics: string | null;
  lrcPath: string | null;
  fetchedAt: string | null;
}

export interface LyricsBatchJobStatus {
  state: "idle" | "running" | "completed" | "cancelled";
  total: number;
  processed: number;
  syncedFound: number;
  plainFound: number;
  instrumental: number;
  notFound: number;
  errors: number;
  currentTrackTitle: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface LyricsLibraryStatsResponse {
  totalTracks: number;
  withSyncedLyrics: number;
  withPlainOnly: number;
  instrumental: number;
  missingLyrics: number;
  job: LyricsBatchJobStatus;
}

/**
 * Browser-based direct song & album uploads (streamed to staging, then post-processed).
 */
export interface StartUploadBatchResponse {
  batchId: string;
  maxFileBytes: number;
  allowedExtensions: string[];
}

export interface UploadFileResponse {
  batchId: string;
  relativePath: string;
  sizeBytes: number;
}

export interface FinalizeUploadBatchResponse extends InboxScanResult {
  batchId: string;
  uploadedFiles: number;
}
