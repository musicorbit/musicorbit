import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Disc3,
  FolderOpen,
  Library,
  ListMusic,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import type {
  AlbumSummary,
  HealthResponse,
  ScanStatusResponse,
  TrackSummary,
} from "@musicorbit/shared";
import {
  fetchAlbums,
  fetchHealth,
  fetchScanStatus,
  fetchTracks,
  triggerScan,
} from "./api/client";

const UPCOMING_NAV = [
  { label: "Albums", icon: Disc3, step: "Step 3" },
  { label: "Artists", icon: Users, step: "Step 3" },
  { label: "Library", icon: Library, step: "Step 3" },
  { label: "Soulseek Search", icon: Search, step: "Step 4" },
  { label: "Review Queue", icon: Sparkles, step: "Step 5" },
  { label: "Playlists", icon: ListMusic, step: "Step 6" },
];

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatusResponse | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingScan, setStartingScan] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, s, al, tr] = await Promise.all([
        fetchHealth(),
        fetchScanStatus(),
        fetchAlbums(),
        fetchTracks(25),
      ]);
      setHealth(h);
      setScanStatus(s);
      setAlbums(al);
      setTracks(tr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach API");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Poll scan status every 500ms while a scan is actively running
  useEffect(() => {
    if (scanStatus?.state !== "running") return;

    const timer = window.setInterval(() => {
      void fetchScanStatus()
        .then((next) => {
          setScanStatus(next);
          if (next.state !== "running") {
            void loadAll();
          }
        })
        .catch(() => {});
    }, 500);

    return () => window.clearInterval(timer);
  }, [scanStatus?.state, loadAll]);

  const handleScan = async (force = false) => {
    setStartingScan(true);
    setError(null);
    try {
      const next = await triggerScan(force);
      setScanStatus(next);
      if (next.state !== "running") {
        await loadAll();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start library scan");
    } finally {
      setStartingScan(false);
    }
  };

  const isScanning = scanStatus?.state === "running";
  const progressPct =
    scanStatus && scanStatus.filesTotal > 0
      ? Math.round((scanStatus.filesProcessed / scanStatus.filesTotal) * 100)
      : 0;

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/40 px-4 py-6">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
            <Disc3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-50">MusicOrbit</h1>
            <p className="text-xs text-zinc-500">v{health?.version ?? "0.1.0"}</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-3 rounded-lg bg-zinc-800/80 px-3 py-2 text-sm font-medium text-zinc-100">
            <Activity className="h-4 w-4 text-amber-400" />
            <span>System &amp; Scanner</span>
          </div>

          <p className="mt-6 mb-2 px-3 text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
            Coming Next
          </p>

          {UPCOMING_NAV.map(({ label, icon: Icon, step }) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-zinc-500"
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-zinc-600" />
                {label}
              </span>
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-zinc-800">
                {step}
              </span>
            </div>
          ))}
        </nav>

        <div className="mt-6 rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-3 text-xs text-zinc-400">
          Open-source self-hosted music hub (AGPL-3.0).
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
                System &amp; Library Scanner
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Step 2 — incremental audio scanning, tag extraction, and SQLite indexing.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleScan(false)}
                disabled={isScanning || startingScan || !health?.musicDir.exists}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-sm font-medium text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
              >
                <Play className="h-4 w-4" />
                {isScanning ? "Scanning…" : "Scan Library"}
              </button>
              <button
                type="button"
                onClick={() => void handleScan(true)}
                disabled={isScanning || startingScan || !health?.musicDir.exists}
                title="Re-read tags for all files even if unchanged"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
              >
                <RotateCcw className="h-4 w-4" />
                Full Rescan
              </button>
              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="font-medium">API Error</p>
                <p className="mt-1 text-red-300/80">{error}</p>
              </div>
            </div>
          )}

          {health && (
            <div className="space-y-6">
              {/* Status summary cards */}
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
                  <p className="mt-3 text-xl font-semibold text-zinc-50">
                    {health.musicDir.exists ? "Ready" : "Not Found Yet"}
                  </p>
                  <p className="mt-1 truncate text-xs text-zinc-500" title={health.musicDir.path}>
                    {health.musicDir.path}
                  </p>
                </div>
              </div>

              {!health.musicDir.exists && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <p className="font-medium">Point MusicOrbit at a music folder to scan</p>
                  <p className="mt-1 text-amber-200/80">
                    Either drop a few audio files into{" "}
                    <code className="rounded bg-zinc-900/80 px-1.5 py-0.5 text-xs">
                      {health.musicDir.path}
                    </code>{" "}
                    or set <code className="rounded bg-zinc-900/80 px-1.5 py-0.5 text-xs">MUSIC_DIR</code>{" "}
                    in <code className="rounded bg-zinc-900/80 px-1.5 py-0.5 text-xs">.env</code> and
                    restart the API.
                  </p>
                </div>
              )}

              {/* Library counts & scan status */}
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

              {/* Indexed metadata preview (Step 2 verification before Step 3 UI) */}
              {tracks.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-zinc-200">
                        Indexed Tracks Preview ({albums.length} albums)
                      </h3>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Showing up to 25 indexed tracks. Full album grid &amp; audio playback arrive
                        in Step 3.
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-400">
                          <th className="py-2 pr-3 font-medium">#</th>
                          <th className="py-2 pr-3 font-medium">Title</th>
                          <th className="py-2 pr-3 font-medium">Artist</th>
                          <th className="py-2 pr-3 font-medium">Album</th>
                          <th className="py-2 pr-3 font-medium">Format</th>
                          <th className="py-2 text-right font-medium">Length</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60">
                        {tracks.map((track) => (
                          <tr key={track.id} className="text-zinc-300">
                            <td className="py-2 pr-3 text-zinc-500">
                              {track.trackNumber ?? "—"}
                            </td>
                            <td className="py-2 pr-3 font-medium text-zinc-100">{track.title}</td>
                            <td className="py-2 pr-3 text-zinc-400">{track.artistName}</td>
                            <td className="py-2 pr-3 text-zinc-400">{track.albumTitle}</td>
                            <td className="py-2 pr-3 text-zinc-500">{track.codec ?? "—"}</td>
                            <td className="py-2 text-right text-zinc-400">
                              {formatDuration(track.durationSeconds)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
