import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderOpen,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type { HealthResponse, ScanStatusResponse } from "@musicorbit/shared";
import { DirectoryPickerModal } from "../components/DirectoryPickerModal";

interface SystemViewProps {
  health: HealthResponse | null;
  scanStatus: ScanStatusResponse | null;
  loading: boolean;
  startingScan: boolean;
  onScan: (force: boolean) => void;
  onRefresh: () => void;
  onMusicDirChanged: () => void;
}

export function SystemView({
  health,
  scanStatus,
  loading,
  startingScan,
  onScan,
  onRefresh,
  onMusicDirChanged,
}: SystemViewProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
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
            Manage incremental audio scanning, database status, and library paths.
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
            onClick={onRefresh}
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
                  onClick={() => setPickerOpen(true)}
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
                onClick={() => setPickerOpen(true)}
                className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
              >
                Select Music Folder
              </button>
            </div>
          )}

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
        </>
      )}
      {pickerOpen && (
        <DirectoryPickerModal
          initialPath={health?.musicDir.path ?? ""}
          onClose={() => setPickerOpen(false)}
          onSaved={() => onMusicDirChanged()}
        />
      )}
    </div>
  );
}
