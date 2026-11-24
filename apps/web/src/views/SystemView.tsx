import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Database,
  FolderInput,
  FolderOpen,
  ListMusic,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import type {
  AcquisitionStatusResponse,
  DuplicatePolicy,
  HealthResponse,
  ImportFileAction,
  InboxScanResult,
  PlaylistSyncRunResult,
  ScanStatusResponse,
  SystemSettingsResponse,
} from "@musicorbit/shared";
import {
  fetchSystemSettings,
  runPlaylistSyncNow,
  scanInbox,
  updatePlaylistSyncSettings,
  updatePostProcessingSettings,
} from "../api/client";
import { DirectoryPickerModal } from "../components/DirectoryPickerModal";

interface SystemViewProps {
  health: HealthResponse | null;
  scanStatus: ScanStatusResponse | null;
  slskdStatus?: AcquisitionStatusResponse | null;
  loading: boolean;
  startingScan: boolean;
  onScan: (force: boolean) => void;
  onRefresh: () => void;
  onMusicDirChanged: () => void;
  onOpenSoulseek?: () => void;
}

export function SystemView({
  health,
  scanStatus,
  slskdStatus,
  loading,
  startingScan,
  onScan,
  onRefresh,
  onMusicDirChanged,
  onOpenSoulseek,
}: SystemViewProps) {
  const [pickerMode, setPickerMode] = useState<"music" | "downloads" | "playlists" | null>(null);
  const [sysSettings, setSysSettings] = useState<SystemSettingsResponse | null>(null);
  const [fileAction, setFileAction] = useState<ImportFileAction>("move");
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>("upgrade");
  const [autoWatchEnabled, setAutoWatchEnabled] = useState(false);
  const [autoWatchIntervalSeconds, setAutoWatchIntervalSeconds] = useState(60);
  const [autoImportThreshold, setAutoImportThreshold] = useState(85);
  const [includeYearInAlbumFolder, setIncludeYearInAlbumFolder] = useState(false);
  const [autoEmbedCoverArt, setAutoEmbedCoverArt] = useState(true);
  const [autoFetchLyrics, setAutoFetchLyrics] = useState(false);
  const [playlistSyncEnabled, setPlaylistSyncEnabled] = useState(false);
  const [savingSync, setSavingSync] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [syncResult, setSyncResult] = useState<PlaylistSyncRunResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [savingPp, setSavingPp] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [ppError, setPpError] = useState<string | null>(null);
  const [runningInbox, setRunningInbox] = useState(false);
  const [inboxResult, setInboxResult] = useState<InboxScanResult | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const next = await fetchSystemSettings();
      setSysSettings(next);
      setFileAction(next.postProcessing.fileAction);
      setDuplicatePolicy(next.postProcessing.duplicatePolicy);
      setAutoWatchEnabled(next.postProcessing.autoWatchEnabled);
      setAutoWatchIntervalSeconds(next.postProcessing.autoWatchIntervalSeconds);
      setAutoImportThreshold(next.postProcessing.autoImportThreshold);
      setIncludeYearInAlbumFolder(next.postProcessing.includeYearInAlbumFolder);
      setAutoEmbedCoverArt(next.postProcessing.autoEmbedCoverArt);
      setAutoFetchLyrics(next.postProcessing.autoFetchLyrics);
      setPlaylistSyncEnabled(next.playlistSync.enabled);
    } catch {
      // Non-fatal; health banner handles offline state
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

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
        includeYearInAlbumFolder,
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
            System &amp; Library Scanner
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Manage incremental audio scanning, library paths, and automated post-processing.
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
          <div className="grid gap-4 sm:grid-cols-3">
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

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium tracking-wider text-zinc-400 uppercase">
                  Music Directory
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
                <button
                  type="button"
                  onClick={() => setPickerMode("music")}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300"
                >
                  Change Folder
                </button>
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
                  <p className="font-medium">Point MusicOrbit at a music folder to scan</p>
                  <p className="mt-1 text-amber-200/80">
                    Current folder{" "}
                    <code className="rounded bg-zinc-900/80 px-1.5 py-0.5 text-xs">
                      {health.musicDir.path}
                    </code>{" "}
                    does not exist yet. Click <strong>Select Music Folder</strong> to choose your
                    library directory directly from the UI.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPickerMode("music")}
                className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
              >
                Select Music Folder
              </button>
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

          {/* Post-Processing & Automated Downloads Pipeline */}
          {sysSettings && (
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
                    checked={includeYearInAlbumFolder}
                    onChange={(e) => setIncludeYearInAlbumFolder(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                  />
                  <span>
                    <strong className="block font-medium">Include year in album folders</strong>
                    <span className="text-zinc-500">
                      Organizes as <code>Artist/Album (Year)/01 - Title</code>.
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
                <button
                  type="button"
                  onClick={() => setPickerMode("playlists")}
                  className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300"
                >
                  Change Folder
                </button>
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

          {/* Optional slskd (Soulseek) Integration Card */}
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
                    : "Soulseek search and download actions are automatically hidden while slskd is not configured."}
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

                {slskdStatus?.configured && onOpenSoulseek && (
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

            {slskdStatus?.configured ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/90 bg-zinc-950/60 px-4 py-3 text-xs">
                <span className="font-mono text-zinc-400">{slskdStatus.url}</span>
                {slskdStatus.connected ? (
                  <span className="text-zinc-500">
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
            ) : (
              <p className="rounded-xl border border-zinc-800/90 bg-zinc-950/60 px-4 py-3 text-xs text-zinc-400">
                To enable, set <code className="text-zinc-200">SLSKD_URL</code> and{" "}
                <code className="text-zinc-200">SLSKD_API_KEY</code> in your{" "}
                <code className="text-zinc-200">.env</code> file and restart MusicOrbit.
              </p>
            )}
          </section>
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
    </div>
  );
}
