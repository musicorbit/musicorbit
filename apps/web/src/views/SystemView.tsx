import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  FolderInput,
  FolderOpen,
  FolderTree,
  ListMusic,
  Loader2,
  Mic2,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Upload,
} from "lucide-react";
import type {
  AcquisitionStatusResponse,
  DuplicatePolicy,
  HealthResponse,
  ImportFileAction,
  InboxScanResult,
  LibraryLayoutPreset,
  LyricsLibraryStatsResponse,
  MultiDiscStyle,
  OrganizeApplyResponse,
  OrganizePreviewResponse,
  PlaylistSyncRunResult,
  ScanStatusResponse,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import {
  applyLibraryOrganization,
  cancelBatchLyricsFetch,
  fetchLyricsStatus,
  fetchSystemSettings,
  previewLibraryOrganization,
  runPlaylistSyncNow,
  scanInbox,
  startBatchLyricsFetch,
  testSlskdConnection,
  updateLibraryOrganizationSettings,
  updatePlaylistSyncSettings,
  updatePostProcessingSettings,
  updateSlskdSettings,
} from "../api/client";
import { BulkImportFolderModal } from "../components/BulkImportFolderModal";
import { DirectoryPickerModal } from "../components/DirectoryPickerModal";

interface SystemViewProps {
  isAdmin?: boolean;
  canUseSoulseek?: boolean;
  health: HealthResponse | null;
  scanStatus: ScanStatusResponse | null;
  slskdStatus?: AcquisitionStatusResponse | null;
  loading: boolean;
  startingScan: boolean;
  onScan: (force: boolean) => void;
  onRefresh: () => void;
  onMusicDirChanged: () => void;
  onOpenSoulseek?: () => void;
  onSlskdStatusChanged?: (next: AcquisitionStatusResponse) => void;
  onOpenReviewQueue?: () => void;
  onOpenUpload?: () => void;
}

const LAYOUT_PRESETS: Array<{
  id: LibraryLayoutPreset;
  title: string;
  description: string;
}> = [
  {
    id: "artist_album_track",
    title: "Artist / Album / Track",
    description: "Standard Navidrome, Jellyfin, and Plex folder hierarchy.",
  },
  {
    id: "artist_track",
    title: "Artist / Track",
    description: "Flat artist folders — handy for singles and playlist-driven libraries.",
  },
  {
    id: "flat",
    title: "Flat Library",
    description: "All audio files in the root Music Directory as Artist - Title.",
  },
  {
    id: "keep_existing",
    title: "Keep Existing Layout",
    description: "Read-only — never move or rename files already inside Music Directory.",
  },
];

function computeExampleLayoutPaths(params: {
  layoutPreset: LibraryLayoutPreset;
  includeYearInAlbumFolder: boolean;
  includeTrackNumber: boolean;
  multiDiscStyle: MultiDiscStyle;
}): { single: string; multiDisc: string | null } {
  const { layoutPreset, includeYearInAlbumFolder, includeTrackNumber, multiDiscStyle } = params;
  if (layoutPreset === "keep_existing") {
    return {
      single: "Existing folders in Music Directory stay untouched",
      multiDisc: null,
    };
  }
  if (layoutPreset === "flat") {
    return {
      single: "Dua Lipa - Levitating.flac",
      multiDisc: null,
    };
  }
  if (layoutPreset === "artist_track") {
    return {
      single: includeTrackNumber ? "Dua Lipa/05 - Levitating.flac" : "Dua Lipa/Levitating.flac",
      multiDisc: includeTrackNumber
        ? "Pink Floyd/2-01 - Hey You.flac"
        : "Pink Floyd/Hey You.flac",
    };
  }
  const album = includeYearInAlbumFolder ? "Future Nostalgia (2020)" : "Future Nostalgia";
  const track = includeTrackNumber ? "05 - Levitating.flac" : "Levitating.flac";
  const wallAlbum = includeYearInAlbumFolder ? "The Wall (1979)" : "The Wall";
  const multiDisc =
    multiDiscStyle === "subfolder"
      ? `Pink Floyd/${wallAlbum}/Disc 2/${includeTrackNumber ? "01 - Hey You.flac" : "Hey You.flac"}`
      : `Pink Floyd/${wallAlbum}/${includeTrackNumber ? "2-01 - Hey You.flac" : "Hey You.flac"}`;
  return {
    single: `Dua Lipa/${album}/${track}`,
    multiDisc,
  };
}

export function SystemView({
  isAdmin = true,
  canUseSoulseek = true,
  health,
  scanStatus,
  slskdStatus,
  loading,
  startingScan,
  onScan,
  onRefresh,
  onMusicDirChanged,
  onOpenSoulseek,
  onSlskdStatusChanged,
  onOpenReviewQueue,
  onOpenUpload,
}: SystemViewProps) {
  const [pickerMode, setPickerMode] = useState<"music" | "downloads" | "playlists" | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [sysSettings, setSysSettings] = useState<SystemSettingsResponse | null>(null);
  const [slskdUrlInput, setSlskdUrlInput] = useState(slskdStatus?.url ?? "");
  const [slskdApiKeyInput, setSlskdApiKeyInput] = useState("");
  const [showSlskdKey, setShowSlskdKey] = useState(false);
  const [slskdSaving, setSlskdSaving] = useState(false);
  const [slskdTesting, setSlskdTesting] = useState(false);
  const [slskdNotice, setSlskdNotice] = useState<string | null>(null);
  const [slskdError, setSlskdError] = useState<string | null>(null);
  const [slskdTestResult, setSlskdTestResult] = useState<AcquisitionStatusResponse | null>(null);

  useEffect(() => {
    setSlskdUrlInput(slskdStatus?.url ?? "");
  }, [slskdStatus?.url]);

  const handleSaveSlskd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlskdSaving(true);
    setSlskdNotice(null);
    setSlskdError(null);
    setSlskdTestResult(null);
    try {
      const next = await updateSlskdSettings({
        url: slskdUrlInput.trim(),
        apiKey: slskdApiKeyInput.trim() || undefined,
      });
      setSlskdApiKeyInput("");
      onSlskdStatusChanged?.(next);
      setSlskdNotice(
        next.configured
          ? next.connected
            ? `Saved and connected to slskd${next.version ? ` v${next.version}` : ""}.`
            : "Saved slskd settings (server currently unreachable)."
          : "slskd integration disconnected.",
      );
    } catch (err) {
      setSlskdError(err instanceof Error ? err.message : "Failed to save slskd settings");
    } finally {
      setSlskdSaving(false);
    }
  };

  const handleTestSlskd = async () => {
    const trimmed = slskdUrlInput.trim();
    if (!trimmed) {
      setSlskdError("Enter a slskd server URL first (e.g. http://localhost:5030).");
      return;
    }
    setSlskdTesting(true);
    setSlskdError(null);
    setSlskdNotice(null);
    setSlskdTestResult(null);
    try {
      const result = await testSlskdConnection({
        url: trimmed,
        apiKey: slskdApiKeyInput.trim() || undefined,
      });
      setSlskdTestResult(result);
    } catch (err) {
      setSlskdError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setSlskdTesting(false);
    }
  };

  const handleDisconnectSlskd = async () => {
    setSlskdSaving(true);
    setSlskdError(null);
    setSlskdNotice(null);
    setSlskdTestResult(null);
    try {
      const next = await updateSlskdSettings({ url: "", clearApiKey: true });
      setSlskdUrlInput("");
      setSlskdApiKeyInput("");
      onSlskdStatusChanged?.(next);
      setSlskdNotice("slskd disconnected. Soulseek search has been hidden.");
    } catch (err) {
      setSlskdError(err instanceof Error ? err.message : "Failed to disconnect slskd");
    } finally {
      setSlskdSaving(false);
    }
  };
  const [fileAction, setFileAction] = useState<ImportFileAction>("move");
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>("upgrade");
  const [autoWatchEnabled, setAutoWatchEnabled] = useState(false);
  const [autoWatchIntervalSeconds, setAutoWatchIntervalSeconds] = useState(60);
  const [autoImportThreshold, setAutoImportThreshold] = useState(85);
  const [autoEmbedCoverArt, setAutoEmbedCoverArt] = useState(true);
  const [autoFetchLyrics, setAutoFetchLyrics] = useState(false);

  // Library Organization state
  const [layoutPreset, setLayoutPreset] = useState<LibraryLayoutPreset>("artist_album_track");
  const [includeYearInAlbumFolder, setIncludeYearInAlbumFolder] = useState(false);
  const [includeTrackNumber, setIncludeTrackNumber] = useState(true);
  const [multiDiscStyle, setMultiDiscStyle] = useState<MultiDiscStyle>("prefix");
  const [autoOrganizeLibrary, setAutoOrganizeLibrary] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgNotice, setOrgNotice] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [orgPreview, setOrgPreview] = useState<OrganizePreviewResponse | null>(null);
  const [applyingOrg, setApplyingOrg] = useState(false);
  const [orgApplyResult, setOrgApplyResult] = useState<OrganizeApplyResponse | null>(null);

  const [playlistSyncEnabled, setPlaylistSyncEnabled] = useState(false);
  const [savingSync, setSavingSync] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [syncResult, setSyncResult] = useState<PlaylistSyncRunResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Synced Lyrics backfill state
  const [lyricsStats, setLyricsStats] = useState<LyricsLibraryStatsResponse | null>(null);
  const [startingLyrics, setStartingLyrics] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);

  const [savingPp, setSavingPp] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [ppError, setPpError] = useState<string | null>(null);
  const [runningInbox, setRunningInbox] = useState(false);
  const [inboxResult, setInboxResult] = useState<InboxScanResult | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const [next, lyr] = await Promise.all([
        fetchSystemSettings(),
        fetchLyricsStatus().catch(() => null),
      ]);
      setSysSettings(next);
      if (lyr) setLyricsStats(lyr);
      setFileAction(next.postProcessing.fileAction);
      setDuplicatePolicy(next.postProcessing.duplicatePolicy);
      setAutoWatchEnabled(next.postProcessing.autoWatchEnabled);
      setAutoWatchIntervalSeconds(next.postProcessing.autoWatchIntervalSeconds);
      setAutoImportThreshold(next.postProcessing.autoImportThreshold);
      setAutoEmbedCoverArt(next.postProcessing.autoEmbedCoverArt);
      setAutoFetchLyrics(next.postProcessing.autoFetchLyrics);
      setLayoutPreset(next.libraryOrganization.layoutPreset);
      setIncludeYearInAlbumFolder(next.libraryOrganization.includeYearInAlbumFolder);
      setIncludeTrackNumber(next.libraryOrganization.includeTrackNumber);
      setMultiDiscStyle(next.libraryOrganization.multiDiscStyle);
      setAutoOrganizeLibrary(next.libraryOrganization.autoOrganizeLibrary);
      setPlaylistSyncEnabled(next.playlistSync.enabled);
    } catch {
      // Non-fatal; health banner handles offline state
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Poll lyrics batch backfill progress while running
  useEffect(() => {
    if (lyricsStats?.job.state !== "running") return;
    const timer = window.setInterval(() => {
      void fetchLyricsStatus()
        .then(setLyricsStats)
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lyricsStats?.job.state]);

  const handleStartLyricsFetch = async (retryNotFound = false) => {
    setStartingLyrics(true);
    setLyricsError(null);
    try {
      await startBatchLyricsFetch(retryNotFound);
      const next = await fetchLyricsStatus();
      setLyricsStats(next);
    } catch (err) {
      setLyricsError(err instanceof Error ? err.message : "Could not start lyrics fetch");
    } finally {
      setStartingLyrics(false);
    }
  };

  const handleCancelLyricsFetch = async () => {
    try {
      await cancelBatchLyricsFetch();
      const next = await fetchLyricsStatus();
      setLyricsStats(next);
    } catch {
      // Non-fatal
    }
  };

  const handleSaveOrganization = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSavingOrg(true);
    setOrgError(null);
    setOrgNotice(null);
    try {
      const updated = await updateLibraryOrganizationSettings({
        layoutPreset,
        includeYearInAlbumFolder,
        includeTrackNumber,
        multiDiscStyle,
        autoOrganizeLibrary: layoutPreset === "keep_existing" ? false : autoOrganizeLibrary,
      });
      setSysSettings(updated);
      setAutoOrganizeLibrary(updated.libraryOrganization.autoOrganizeLibrary);
      setOrgNotice("Library organization settings saved.");
      return true;
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Could not save organization settings");
      return false;
    } finally {
      setSavingOrg(false);
    }
  };

  const handlePreviewOrganization = async () => {
    setPreviewLoading(true);
    setOrgError(null);
    setOrgApplyResult(null);
    try {
      // Persist any unsaved preset/toggle changes first so the preview matches what is selected
      const saved = await handleSaveOrganization();
      if (!saved) return;
      setOrgNotice(null);
      const plan = await previewLibraryOrganization();
      setOrgPreview(plan);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Could not preview library organization");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplyOrganization = async () => {
    setApplyingOrg(true);
    setOrgError(null);
    setOrgApplyResult(null);
    try {
      const res = await applyLibraryOrganization();
      setOrgApplyResult(res);
      const refreshedPlan = await previewLibraryOrganization();
      setOrgPreview(refreshedPlan);
      onMusicDirChanged();
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Could not organize library");
    } finally {
      setApplyingOrg(false);
    }
  };

  const handleSavePostProcessing = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPp(true);
    setPpError(null);
    setSavedNotice(null);
    try {
      const updated = await updatePostProcessingSettings({
        fileAction,
        duplicatePolicy,
        autoWatchEnabled,
        autoWatchIntervalSeconds,
        autoImportThreshold,
        autoEmbedCoverArt,
        autoFetchLyrics,
      });
      setSysSettings(updated);
      setSavedNotice("Post-processing settings saved.");
    } catch (err) {
      setPpError(err instanceof Error ? err.message : "Could not save post-processing settings");
    } finally {
      setSavingPp(false);
    }
  };

  const handleRunPostProcessing = async () => {
    setRunningInbox(true);
    setPpError(null);
    setInboxResult(null);
    try {
      const res = await scanInbox();
      setInboxResult(res);
      await loadSettings();
      onMusicDirChanged();
    } catch (err) {
      setPpError(err instanceof Error ? err.message : "Post-processing scan failed");
    } finally {
      setRunningInbox(false);
    }
  };

  const handleTogglePlaylistSync = async (nextEnabled: boolean) => {
    setPlaylistSyncEnabled(nextEnabled);
    setSavingSync(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const updated = await updatePlaylistSyncSettings({ enabled: nextEnabled });
      setSysSettings(updated);
      setPlaylistSyncEnabled(updated.playlistSync.enabled);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Could not update playlist sync");
      setPlaylistSyncEnabled(!nextEnabled);
    } finally {
      setSavingSync(false);
    }
  };

  const handleRunPlaylistSync = async () => {
    setRunningSync(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await runPlaylistSyncNow();
      setSyncResult(res);
      await loadSettings();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Could not sync playlists");
    } finally {
      setRunningSync(false);
    }
  };

  const isScanning = scanStatus?.state === "running";
  const progressPct =
    scanStatus && scanStatus.filesTotal > 0
      ? Math.round((scanStatus.filesProcessed / scanStatus.filesTotal) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
            {isAdmin ? "System & Library Scanner" : "Library Settings & Scanner"}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {isAdmin
              ? "Manage incremental audio scanning, library paths, and automated post-processing."
              : "Scan your personal library, organize folders, sync playlists, and fetch synced lyrics."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onScan(false)}
            disabled={isScanning || startingScan || !health?.musicDir.exists}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-sm font-medium text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
          >
            <Play className="h-4 w-4" />
            {isScanning ? "Scanning…" : "Scan Library"}
          </button>
          <button
            type="button"
            onClick={() => onScan(true)}
            disabled={isScanning || startingScan || !health?.musicDir.exists}
            title="Re-read tags for all files even if unchanged"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
          >
            <RotateCcw className="h-4 w-4" />
            Full Rescan
          </button>
          <button
            type="button"
            onClick={() => {
              onRefresh();
              void loadSettings();
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {health && (
        <>
          <div className={`grid gap-4 ${isAdmin ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium tracking-wider text-zinc-400 uppercase">
                  API Server
                </span>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="mt-3 text-xl font-semibold text-zinc-50">
                {health.status === "ok" ? "Online" : "Degraded"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Uptime: {health.uptimeSeconds}s</p>
            </div>

            {isAdmin && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium tracking-wider text-zinc-400 uppercase">
                    SQLite Database
                  </span>
                  <Database
                    className={`h-4 w-4 ${
                      health.database.connected ? "text-emerald-400" : "text-red-400"
                    }`}
                  />
                </div>
                <p className="mt-3 text-xl font-semibold text-zinc-50">
                  {health.database.connected ? "Connected" : "Error"}
                </p>
                <p className="mt-1 truncate text-xs text-zinc-500" title={health.database.path}>
                  {health.database.path}
                </p>
              </div>
            )}

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium tracking-wider text-zinc-400 uppercase">
                  {isAdmin ? "Music Directory" : "Your Music Library"}
                </span>
                <FolderOpen
                  className={`h-4 w-4 ${
                    health.musicDir.exists ? "text-emerald-400" : "text-amber-400"
                  }`}
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xl font-semibold text-zinc-50">
                  {health.musicDir.exists ? "Ready" : "Not Found Yet"}
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setPickerMode("music")}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300"
                  >
                    Change Folder
                  </button>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-zinc-500" title={health.musicDir.path}>
                {health.musicDir.path}
              </p>
            </div>
          </div>

          {!health.musicDir.exists && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <div>
                  <p className="font-medium">
                    {isAdmin
                      ? "Point MusicOrbit at a music folder to scan"
                      : "Your music library folder is not accessible yet"}
                  </p>
                  <p className="mt-1 text-amber-200/80">
                    Current folder{" "}
                    <code className="rounded bg-zinc-900/80 px-1.5 py-0.5 text-xs">
                      {health.musicDir.path}
                    </code>{" "}
                    {isAdmin
                      ? "does not exist yet. Click Select Music Folder to choose your library directory directly from the UI."
                      : "does not exist yet. Ask an administrator to verify your assigned library folder."}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setPickerMode("music")}
                  className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
                >
                  Select Music Folder
                </button>
              )}
            </div>
          )}

          {/* Indexed Library */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-zinc-200">Indexed Library</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Supports FLAC, MP3, M4A, AAC, OGG, Opus, and WAV. Unchanged files are skipped
                  automatically on re-scan.
                </p>
              </div>
              {scanStatus && scanStatus.state !== "idle" && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    scanStatus.state === "running"
                      ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                      : scanStatus.state === "completed"
                        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                        : "bg-red-500/15 text-red-300 ring-1 ring-red-500/30"
                  }`}
                >
                  Last scan: {scanStatus.state}
                </span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-4 border-t border-zinc-800/80 pt-5">
              <div>
                <p className="text-2xl font-semibold text-zinc-50">{health.counts.artists}</p>
                <p className="text-xs text-zinc-400">Artists</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-zinc-50">{health.counts.albums}</p>
                <p className="text-xs text-zinc-400">Albums</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-zinc-50">{health.counts.tracks}</p>
                <p className="text-xs text-zinc-400">Tracks</p>
              </div>
            </div>

            {scanStatus && scanStatus.state !== "idle" && (
              <div className="mt-5 border-t border-zinc-800/80 pt-4">
                {isScanning && (
                  <div className="mb-3">
                    <div className="mb-1.5 flex justify-between text-xs text-zinc-400">
                      <span>
                        Scanning {scanStatus.filesProcessed} / {scanStatus.filesTotal} files
                      </span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full bg-amber-400 transition-all duration-200"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-400">
                  <span>
                    Total files: <strong className="text-zinc-200">{scanStatus.filesTotal}</strong>
                  </span>
                  <span>
                    Added: <strong className="text-emerald-400">{scanStatus.filesAdded}</strong>
                  </span>
                  <span>
                    Updated: <strong className="text-amber-300">{scanStatus.filesUpdated}</strong>
                  </span>
                  <span>
                    Skipped: <strong className="text-zinc-300">{scanStatus.filesSkipped}</strong>
                  </span>
                  <span>
                    Removed: <strong className="text-zinc-300">{scanStatus.filesRemoved}</strong>
                  </span>
                </div>

                {scanStatus.errors.length > 0 && (
                  <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                    <p className="font-medium">
                      Scan warnings/errors ({scanStatus.errors.length}):
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-red-300/85">
                      {scanStatus.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Library Organization & Folder Structure */}
          {sysSettings && (() => {
            const example = computeExampleLayoutPaths({
              layoutPreset,
              includeYearInAlbumFolder,
              includeTrackNumber,
              multiDiscStyle,
            });
            const isKeepExisting = layoutPreset === "keep_existing";

            return (
              <form
                onSubmit={(e) => void handleSaveOrganization(e)}
                className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                      <FolderTree className="h-4 w-4 text-amber-400" />
                      Library Organization &amp; Folder Structure
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Choose how MusicOrbit formats folders and filenames inside your Music
                      Directory (shared by both Downloads Post-Processing and the Library
                      Organizer).
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        sysSettings.libraryOrganization.layoutPreset === "keep_existing"
                          ? "bg-zinc-800 text-zinc-400"
                          : sysSettings.libraryOrganization.autoOrganizeLibrary
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {sysSettings.libraryOrganization.layoutPreset === "keep_existing"
                        ? "Read-only layout"
                        : sysSettings.libraryOrganization.autoOrganizeLibrary
                          ? "Auto-organize active"
                          : "Manual organize"}
                    </span>

                    {onOpenUpload && (
                      <button
                        type="button"
                        onClick={onOpenUpload}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Upload Songs / Album
                      </button>
                    )}

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setBulkImportOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300"
                      >
                        <FolderInput className="h-3.5 w-3.5 text-amber-400" />
                        Import Existing Folder…
                      </button>
                    )}
                  </div>
                </div>

                {/* Preset Grid */}
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {LAYOUT_PRESETS.map((preset) => {
                    const selected = layoutPreset === preset.id;
                    return (
                      <label
                        key={preset.id}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 text-xs transition ${
                          selected
                            ? "border-amber-500/50 bg-amber-500/10 text-zinc-100"
                            : "border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700"
                        }`}
                      >
                        <input
                          type="radio"
                          name="libraryLayoutPreset"
                          value={preset.id}
                          checked={selected}
                          onChange={() => {
                            setLayoutPreset(preset.id);
                            setOrgPreview(null);
                            setOrgNotice(null);
                            if (preset.id === "keep_existing") {
                              setAutoOrganizeLibrary(false);
                            }
                          }}
                          className="mt-0.5 accent-amber-500"
                        />
                        <span>
                          <strong className="block font-medium text-zinc-100">
                            {preset.title}
                          </strong>
                          <span className="mt-0.5 block text-zinc-400">{preset.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {/* Live Path Preview */}
                <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 px-4 py-3 text-xs">
                  <p className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
                    Path Preview
                  </p>
                  <p className="mt-1 font-mono text-amber-300">{example.single}</p>
                  {example.multiDisc && (
                    <p className="mt-0.5 font-mono text-zinc-400">
                      Multi-disc: <span className="text-zinc-300">{example.multiDisc}</span>
                    </p>
                  )}
                  {isKeepExisting && (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Note: External downloads or bulk folder imports will still organize new
                      incoming files into <code>Artist/Album/Track</code> inside your Music
                      Directory.
                    </p>
                  )}
                </div>

                {/* Formatting Modifiers */}
                {!isKeepExisting && (
                  <div className="grid gap-3 border-t border-zinc-800/80 pt-4 sm:grid-cols-2">
                    {layoutPreset === "artist_album_track" && (
                      <label className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-200">
                        <input
                          type="checkbox"
                          checked={includeYearInAlbumFolder}
                          onChange={(e) => {
                            setIncludeYearInAlbumFolder(e.target.checked);
                            setOrgPreview(null);
                          }}
                          className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                        />
                        <span>
                          <strong className="block font-medium">
                            Include year in album folders
                          </strong>
                          <span className="text-zinc-500">
                            Formats folders as <code>Album (2020)</code> instead of{" "}
                            <code>Album</code>.
                          </span>
                        </span>
                      </label>
                    )}

                    {layoutPreset !== "flat" && (
                      <label className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-200">
                        <input
                          type="checkbox"
                          checked={includeTrackNumber}
                          onChange={(e) => {
                            setIncludeTrackNumber(e.target.checked);
                            setOrgPreview(null);
                          }}
                          className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                        />
                        <span>
                          <strong className="block font-medium">
                            Include track number in filenames
                          </strong>
                          <span className="text-zinc-500">
                            Formats files as <code>05 - Levitating.flac</code> instead of{" "}
                            <code>Levitating.flac</code>.
                          </span>
                        </span>
                      </label>
                    )}

                    {layoutPreset === "artist_album_track" && (
                      <label className="block space-y-1.5 text-xs">
                        <span className="font-medium text-zinc-300">Multi-disc Albums</span>
                        <select
                          value={multiDiscStyle}
                          onChange={(e) => {
                            setMultiDiscStyle(e.target.value as MultiDiscStyle);
                            setOrgPreview(null);
                          }}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                        >
                          <option value="prefix" className="bg-zinc-900 text-zinc-100">
                            Disc prefix (2-01 - Title.flac)
                          </option>
                          <option value="subfolder" className="bg-zinc-900 text-zinc-100">
                            Disc subfolders (Disc 2/01 - Title.flac)
                          </option>
                        </select>
                      </label>
                    )}

                    <label className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-200 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={autoOrganizeLibrary}
                        onChange={(e) => setAutoOrganizeLibrary(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                      />
                      <span>
                        <strong className="block font-medium">
                          Auto-organize files dropped directly into Music Directory
                        </strong>
                        <span className="text-zinc-500">
                          Periodically scans your Music Directory (every{" "}
                          {sysSettings.postProcessing.autoWatchIntervalSeconds}s) and formats
                          well-tagged files into your chosen folder structure. Leaves untagged or
                          conflicting files untouched and re-syncs playlists automatically.
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {orgError && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    <span>{orgError}</span>
                  </div>
                )}

                {orgNotice && (
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>{orgNotice}</span>
                  </div>
                )}

                {orgApplyResult && (
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>
                      Moved <strong>{orgApplyResult.movedCount}</strong>{" "}
                      {orgApplyResult.movedCount === 1 ? "track" : "tracks"} cleanly (preserving
                      playlist links)
                      {orgApplyResult.playlistsResynced ? " and re-synced .m3u8 playlists" : ""}.
                      {orgApplyResult.skippedCount > 0 &&
                        ` Skipped ${orgApplyResult.skippedCount} missing tags.`}
                      {orgApplyResult.conflictCount > 0 &&
                        ` Skipped ${orgApplyResult.conflictCount} conflicts.`}
                    </span>
                  </div>
                )}

                {/* Dry-Run Organization Preview */}
                {orgPreview && (
                  <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-zinc-100">Organization Preview</span>
                        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-medium text-amber-300 ring-1 ring-amber-500/30">
                          {orgPreview.toMoveCount} to move
                        </span>
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                          {orgPreview.alreadyOrganizedCount} already organized
                        </span>
                        {orgPreview.skippedUntaggedCount > 0 && (
                          <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 font-medium text-zinc-300">
                            {orgPreview.skippedUntaggedCount} skipped (missing tags)
                          </span>
                        )}
                        {orgPreview.conflictCount > 0 && (
                          <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 font-medium text-red-300 ring-1 ring-red-500/30">
                            {orgPreview.conflictCount} conflicts
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setOrgPreview(null)}
                          className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                        >
                          Close Preview
                        </button>
                        {orgPreview.toMoveCount > 0 && (
                          <button
                            type="button"
                            disabled={applyingOrg}
                            onClick={() => void handleApplyOrganization()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-45"
                          >
                            {applyingOrg ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Apply Organization ({orgPreview.toMoveCount})
                          </button>
                        )}
                      </div>
                    </div>

                    {orgPreview.items.length === 0 ? (
                      <p className="text-xs text-emerald-300">
                        {orgPreview.layoutPreset === "keep_existing"
                          ? "Layout is set to Keep Existing Layout — no files will be moved."
                          : "Every track in your Music Directory already matches this folder layout!"}
                      </p>
                    ) : (
                      <div className="max-h-72 divide-y divide-zinc-800/70 overflow-y-auto rounded-lg border border-zinc-800/80 bg-zinc-900/40 text-xs">
                        {orgPreview.items.slice(0, 100).map((item) => (
                          <div key={item.trackId} className="space-y-1 px-3 py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-zinc-200">
                                {item.artistName} — {item.title}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  item.status === "move"
                                    ? "bg-amber-500/15 text-amber-300"
                                    : item.status === "conflict"
                                      ? "bg-red-500/15 text-red-300"
                                      : "bg-zinc-800 text-zinc-400"
                                }`}
                              >
                                {item.status === "move"
                                  ? "Move"
                                  : item.status === "conflict"
                                    ? "Conflict (skipped)"
                                    : "Missing tags (skipped)"}
                              </span>
                            </div>

                            {item.status === "move" ? (
                              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                                <span className="break-all text-zinc-400">
                                  {item.currentRelativePath}
                                </span>
                                <ArrowRight className="h-3 w-3 shrink-0 text-amber-400" />
                                <span className="break-all text-emerald-300">
                                  {item.targetRelativePath}
                                </span>
                              </div>
                            ) : (
                              <p className="text-[11px] text-zinc-400">
                                <span className="font-mono text-zinc-500">
                                  {item.currentRelativePath}
                                </span>
                                {item.reason ? ` — ${item.reason}` : ""}
                              </p>
                            )}
                          </div>
                        ))}
                        {orgPreview.items.length > 100 && (
                          <p className="px-3 py-2 text-center text-[11px] text-zinc-500">
                            Showing first 100 of {orgPreview.items.length} items.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 pt-4">
                  <button
                    type="button"
                    disabled={previewLoading || isKeepExisting}
                    onClick={() => void handlePreviewOrganization()}
                    title={
                      isKeepExisting
                        ? "Choose a folder layout preset above to preview organizing your library"
                        : "Dry-run your chosen folder layout on Music Directory without moving any files yet"
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300 disabled:opacity-45"
                  >
                    {previewLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 text-amber-400" />
                    )}
                    Preview &amp; Organize Library
                  </button>

                  <button
                    type="submit"
                    disabled={savingOrg}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
                  >
                    {savingOrg ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Save Layout
                  </button>
                </div>
              </form>
            );
          })()}

          {/* Post-Processing & Automated Downloads Pipeline (Admin only) */}
          {isAdmin && sysSettings && (
            <form
              onSubmit={(e) => void handleSavePostProcessing(e)}
              className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    Post-Processing &amp; Downloads Pipeline
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Automatically match albums &amp; single tracks landing in your downloads folder,
                    write clean tags, handle duplicates, organize into your Music Directory, and
                    backfill missing playlist tracks.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      sysSettings.watcher.enabled
                        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {sysSettings.watcher.enabled
                      ? `Watching every ${sysSettings.watcher.intervalSeconds}s`
                      : "Auto-watch off"}
                  </span>

                  <button
                    type="button"
                    disabled={runningInbox}
                    onClick={() => void handleRunPostProcessing()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
                  >
                    {runningInbox ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    ) : (
                      <FolderInput className="h-3.5 w-3.5 text-amber-400" />
                    )}
                    Run Now
                  </button>
                </div>
              </div>

              {/* Downloads / Watch Folder Picker Row */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-300">
                    Downloads / Watch Folder (staging area)
                  </p>
                  <p
                    className="mt-0.5 truncate font-mono text-xs text-zinc-400"
                    title={sysSettings.postProcessing.downloadsDir}
                  >
                    {sysSettings.postProcessing.downloadsDir}
                  </p>
                  {!sysSettings.postProcessing.downloadsDirExists && (
                    <p className="mt-1 text-[11px] text-amber-400">
                      Folder does not exist yet — pick an existing slskd downloads folder or create
                      this path on disk.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPickerMode("downloads")}
                  className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300"
                >
                  Change Folder
                </button>
              </div>

              {/* Core Post-Processing Controls */}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-300">File Action</span>
                  <select
                    value={fileAction}
                    onChange={(e) => setFileAction(e.target.value as ImportFileAction)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                  >
                    <option value="move">Move into Music Directory (keeps staging clean)</option>
                    <option value="copy">Copy into Music Directory (keep originals intact)</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-300">Duplicate Policy</span>
                  <select
                    value={duplicatePolicy}
                    onChange={(e) => setDuplicatePolicy(e.target.value as DuplicatePolicy)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                  >
                    <option value="upgrade">Upgrade if higher quality (archive old copy)</option>
                    <option value="review">Send duplicates to Review Queue</option>
                    <option value="skip">Skip duplicates automatically</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-300">
                    Auto-Import Confidence Threshold ({autoImportThreshold}%)
                  </span>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    step={5}
                    value={autoImportThreshold}
                    onChange={(e) => setAutoImportThreshold(Number(e.target.value))}
                    className="w-full cursor-pointer accent-amber-400"
                  />
                  <span className="block text-[11px] text-zinc-500">
                    Matches below this score go to the Review Queue instead of auto-importing.
                  </span>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-300">Watcher Check Interval</span>
                  <select
                    value={autoWatchIntervalSeconds}
                    disabled={!autoWatchEnabled}
                    onChange={(e) => setAutoWatchIntervalSeconds(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none disabled:opacity-45"
                  >
                    <option value={30}>Every 30 seconds</option>
                    <option value={60}>Every 1 minute</option>
                    <option value={300}>Every 5 minutes</option>
                    <option value={900}>Every 15 minutes</option>
                  </select>
                </label>
              </div>

              {/* Toggles */}
              <div className="grid gap-3 border-t border-zinc-800/80 pt-4 sm:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={autoWatchEnabled}
                    onChange={(e) => setAutoWatchEnabled(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                  />
                  <span>
                    <strong className="block font-medium">Auto-watch downloads folder</strong>
                    <span className="text-zinc-500">
                      Waits until downloads finish writing, then post-processes automatically.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={autoEmbedCoverArt}
                    onChange={(e) => setAutoEmbedCoverArt(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                  />
                  <span>
                    <strong className="block font-medium">Auto-embed missing cover art</strong>
                    <span className="text-zinc-500">
                      Embeds Cover Art Archive / Deezer artwork if a track has none.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={autoFetchLyrics}
                    onChange={(e) => setAutoFetchLyrics(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                  />
                  <span>
                    <strong className="block font-medium">Auto-fetch lyrics (LRCLIB)</strong>
                    <span className="text-zinc-500">
                      Embeds synced/plain lyrics into imported tracks automatically.
                    </span>
                  </span>
                </label>
              </div>

              {ppError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <span>{ppError}</span>
                </div>
              )}

              {savedNotice && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{savedNotice}</span>
                </div>
              )}

              {inboxResult && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Checked <strong>{inboxResult.discoveredFolders}</strong> folders —{" "}
                  <strong>{inboxResult.autoImported}</strong> auto-imported,{" "}
                  <strong>{inboxResult.needsReview}</strong> sent to Review Queue,{" "}
                  <strong>{inboxResult.skipped}</strong> skipped.
                </div>
              )}

              <div className="flex items-center justify-between border-t border-zinc-800/80 pt-4">
                <span className="text-xs text-zinc-500">
                  {sysSettings.watcher.lastCheckAt
                    ? `Last watcher check: ${new Date(sysSettings.watcher.lastCheckAt).toLocaleTimeString()}`
                    : "Imported tracks automatically backfill matching missing songs in your playlists."}
                </span>
                <button
                  type="submit"
                  disabled={savingPp}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
                >
                  {savingPp ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save Settings
                </button>
              </div>
            </form>
          )}

          {/* Playlist .m3u8 Auto-Sync (Navidrome / Symfonium Compatibility) */}
          {sysSettings && (
            <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                    <ListMusic className="h-4 w-4 text-amber-400" />
                    Playlist <code>.m3u8</code> Sync (Navidrome &amp; Symfonium)
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Automatically mirror every MusicOrbit playlist as a standard{" "}
                    <code className="text-zinc-300">#EXTM3U</code> file with relative audio paths
                    so Navidrome, Symfonium, and Jellyfin stay in sync whenever you add, remove,
                    reorder, or upgrade songs.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      sysSettings.playlistSync.enabled
                        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {sysSettings.playlistSync.enabled ? "Auto-sync active" : "Sync off"}
                  </span>

                  <button
                    type="button"
                    disabled={runningSync}
                    onClick={() => void handleRunPlaylistSync()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
                  >
                    {runningSync ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
                    )}
                    Sync All Now
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-300">
                    Synced Playlists Folder (<code>.m3u8</code> destination)
                  </p>
                  <p
                    className="mt-0.5 truncate font-mono text-xs text-zinc-400"
                    title={sysSettings.playlistSync.playlistsDir}
                  >
                    {sysSettings.playlistSync.playlistsDir}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Defaults to <code>MUSIC_DIR/Playlists</code> so Navidrome discovers them
                    automatically on scan.
                  </p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setPickerMode("playlists")}
                    className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300"
                  >
                    Change Folder
                  </button>
                )}
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  disabled={savingSync}
                  checked={playlistSyncEnabled}
                  onChange={(e) => void handleTogglePlaylistSync(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                />
                <span>
                  <strong className="block font-medium">
                    Auto-sync playlists to <code>.m3u8</code> files on every change
                  </strong>
                  <span className="text-zinc-500">
                    Creates, updates, renames, and deletes matching <code>.m3u8</code> files
                    automatically whenever playlists change or downloaded tracks backfill/upgrade.
                  </span>
                </span>
              </label>

              {syncError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <span>{syncError}</span>
                </div>
              )}

              {syncResult && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    Synced <strong>{syncResult.syncedCount}</strong>{" "}
                    {syncResult.syncedCount === 1 ? "playlist" : "playlists"} to{" "}
                    <code className="rounded bg-zinc-950/60 px-1 py-0.5">
                      {syncResult.playlistsDir}
                    </code>
                    {syncResult.files.length > 0 ? ` (${syncResult.files.join(", ")})` : ""}.
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Synced Lyrics (LRCLIB & .lrc Sidecars) */}
          {lyricsStats && (
            <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                    <Mic2 className="h-4 w-4 text-amber-400" />
                    Synced Sing-Along Lyrics (LRCLIB &amp; <code>.lrc</code> Sidecars)
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Fetches duration-matched time-synced lyrics from LRCLIB, caches them in SQLite,
                    and writes <code>.lrc</code> sidecar files next to each song (compatible with
                    Navidrome &amp; Symfonium). Click the microphone icon in the player bar while
                    playing any song to sing along.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {lyricsStats.job.state === "running" ? (
                    <button
                      type="button"
                      onClick={() => void handleCancelLyricsFetch()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/25"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      Stop
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={startingLyrics || lyricsStats.totalTracks === 0}
                        onClick={() => void handleStartLyricsFetch(false)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
                      >
                        {startingLyrics ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Mic2 className="h-3.5 w-3.5" />
                        )}
                        Fetch Missing Lyrics
                      </button>

                      {lyricsStats.missingLyrics > 0 && (
                        <button
                          type="button"
                          disabled={startingLyrics}
                          onClick={() => void handleStartLyricsFetch(true)}
                          title="Re-query tracks that previously returned no lyrics match"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Retry All Missing
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-4 sm:grid-cols-4">
                <div>
                  <p className="text-lg font-semibold text-emerald-400">
                    {lyricsStats.withSyncedLyrics}
                  </p>
                  <p className="text-[11px] text-zinc-400">Synced (.lrc)</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-zinc-200">
                    {lyricsStats.withPlainOnly}
                  </p>
                  <p className="text-[11px] text-zinc-400">Plain Only</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-zinc-300">
                    {lyricsStats.instrumental}
                  </p>
                  <p className="text-[11px] text-zinc-400">Instrumental</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-amber-300">
                    {lyricsStats.missingLyrics}
                  </p>
                  <p className="text-[11px] text-zinc-400">Missing</p>
                </div>
              </div>

              {lyricsStats.job.state === "running" && (
                <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-zinc-200">
                      Fetching{" "}
                      <strong className="text-amber-300">
                        {lyricsStats.job.currentTrackTitle ?? "tracks…"}
                      </strong>
                    </span>
                    <span className="shrink-0 font-mono text-zinc-400">
                      {lyricsStats.job.processed} / {lyricsStats.job.total}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-amber-400 transition-all duration-300"
                      style={{
                        width: `${Math.round((lyricsStats.job.processed / Math.max(1, lyricsStats.job.total)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {lyricsStats.job.state === "completed" && lyricsStats.job.total > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    Finished checking <strong>{lyricsStats.job.total}</strong>{" "}
                    {lyricsStats.job.total === 1 ? "track" : "tracks"} —{" "}
                    <strong>{lyricsStats.job.syncedFound}</strong> synced (<code>.lrc</code> saved),{" "}
                    <strong>{lyricsStats.job.plainFound}</strong> plain,{" "}
                    <strong>{lyricsStats.job.instrumental}</strong> instrumental,{" "}
                    <strong>{lyricsStats.job.notFound}</strong> not found.
                  </span>
                </div>
              )}

              {lyricsError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <span>{lyricsError}</span>
                </div>
              )}
            </section>
          )}

          {/* Optional slskd (Soulseek) Integration Card (Admin only) */}
          {isAdmin && (
            <section className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                  <Radio className="h-4 w-4 text-amber-400" />
                  Optional Integration: slskd (Soulseek)
                </h3>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {slskdStatus?.configured
                    ? "Soulseek search and missing-track download actions are enabled across Albums, Playlists, and the sidebar."
                    : "Not connected yet — configure your slskd server URL and API key below to enable Soulseek search and missing-track downloads."}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {slskdStatus?.configured ? (
                  slskdStatus.connected ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                      Connected{slskdStatus.version ? ` · v${slskdStatus.version}` : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30">
                      Unreachable
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-400">
                    Not configured
                  </span>
                )}

                {slskdStatus?.configured && canUseSoulseek && onOpenSoulseek && (
                  <button
                    type="button"
                    onClick={onOpenSoulseek}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                  >
                    <Search className="h-3.5 w-3.5 text-amber-400" />
                    Open Soulseek Search
                  </button>
                )}
              </div>
            </div>

            {slskdStatus?.configured && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/90 bg-zinc-950/60 px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-zinc-300">{slskdStatus.url}</span>
                  {slskdStatus.source && slskdStatus.source !== "none" && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {slskdStatus.source === "ui" ? "Saved in UI" : "From .env"}
                    </span>
                  )}
                </div>
                {slskdStatus.connected ? (
                  <span className="text-emerald-300">
                    {slskdStatus.loggedIn
                      ? "Logged into Soulseek network"
                      : "slskd API reachable"}
                  </span>
                ) : (
                  <span className="text-amber-300">
                    {slskdStatus.error ?? "Could not reach slskd server"}
                  </span>
                )}
              </div>
            )}

            <form onSubmit={(e) => void handleSaveSlskd(e)} className="space-y-3 pt-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="slskd-url"
                    className="mb-1.5 block text-xs font-medium text-zinc-300"
                  >
                    slskd Server URL
                  </label>
                  <input
                    id="slskd-url"
                    type="url"
                    value={slskdUrlInput}
                    onChange={(e) => setSlskdUrlInput(e.target.value)}
                    placeholder="http://localhost:5030 or http://slskd:5030"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="slskd-api-key"
                    className="mb-1.5 block text-xs font-medium text-zinc-300"
                  >
                    API Key
                    {slskdStatus?.hasApiKey && (
                      <span className="ml-1.5 text-[11px] font-normal text-emerald-400">
                        (saved)
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      id="slskd-api-key"
                      type={showSlskdKey ? "text" : "password"}
                      value={slskdApiKeyInput}
                      onChange={(e) => setSlskdApiKeyInput(e.target.value)}
                      autoComplete="off"
                      placeholder={
                        slskdStatus?.hasApiKey
                          ? "•••••••• (leave blank to keep current key)"
                          : "Configured in slskd.yml under web.authentication.api_keys"
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950/80 py-2 pr-9 pl-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSlskdKey((v) => !v)}
                      aria-label={showSlskdKey ? "Hide API key" : "Show API key"}
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
                    >
                      {showSlskdKey ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {slskdTestResult && (
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    slskdTestResult.connected
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {slskdTestResult.connected ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  )}
                  <span>
                    {slskdTestResult.connected
                      ? `Connection succeeded${slskdTestResult.version ? ` (slskd v${slskdTestResult.version})` : ""}${slskdTestResult.loggedIn ? " · Logged into Soulseek" : ""}. Click Save to enable.`
                      : (slskdTestResult.error ?? "Could not reach slskd at that URL.")}
                  </span>
                </div>
              )}

              {slskdError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                  <span>{slskdError}</span>
                </div>
              )}

              {slskdNotice && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{slskdNotice}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="submit"
                  disabled={slskdSaving || slskdTesting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50"
                >
                  {slskdSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save slskd Settings
                </button>

                <button
                  type="button"
                  disabled={slskdTesting || slskdSaving || !slskdUrlInput.trim()}
                  onClick={() => void handleTestSlskd()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
                >
                  {slskdTesting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                  ) : (
                    <Radio className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  Test Connection
                </button>

                {slskdStatus?.configured && (
                  <button
                    type="button"
                    disabled={slskdSaving || slskdTesting}
                    onClick={() => void handleDisconnectSlskd()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-45"
                  >
                    Disconnect
                  </button>
                )}
              </div>
              <p className="text-[11px] text-zinc-500">
                Saved directly in MusicOrbit&apos;s SQLite database — takes effect immediately with
                no <code className="text-zinc-400">.env</code> edits or container restart required.
              </p>
            </form>
            </section>
          )}
        </>
      )}

      {pickerMode && (
        <DirectoryPickerModal
          mode={pickerMode}
          initialPath={
            pickerMode === "downloads"
              ? (sysSettings?.postProcessing.downloadsDir ?? "")
              : pickerMode === "playlists"
                ? (sysSettings?.playlistSync.playlistsDir ?? "")
                : (health?.musicDir.path ?? "")
          }
          onClose={() => setPickerMode(null)}
          onSaved={() => {
            void loadSettings();
            if (pickerMode === "music") {
              onMusicDirChanged();
            }
          }}
        />
      )}

      {bulkImportOpen && (
        <BulkImportFolderModal
          initialPath={sysSettings?.downloadsDir ?? health?.musicDir.path ?? ""}
          onClose={() => setBulkImportOpen(false)}
          onImported={() => {
            void loadSettings();
            onMusicDirChanged();
          }}
          onOpenReviewQueue={onOpenReviewQueue}
        />
      )}
    </div>
  );
}
