import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Database,
  Disc3,
  FolderOpen,
  Library,
  ListMusic,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  AlertTriangle,
} from "lucide-react";
import type { HealthResponse } from "@musicorbit/shared";
import { fetchHealth } from "./api/client";

const UPCOMING_NAV = [
  { label: "Albums", icon: Disc3, step: "Step 3" },
  { label: "Artists", icon: Users, step: "Step 3" },
  { label: "Library", icon: Library, step: "Step 3" },
  { label: "Soulseek Search", icon: Search, step: "Step 4" },
  { label: "Review Queue", icon: Sparkles, step: "Step 5" },
  { label: "Playlists", icon: ListMusic, step: "Step 6" },
];

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHealth();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach API");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

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
            <span>System Status</span>
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
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">System Status</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Step 1 foundation — verifying API, SQLite database, and library path configuration.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadHealth()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="font-medium">Unable to reach MusicOrbit API</p>
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
                  <p className="mt-1 text-xs text-zinc-500">
                    Uptime: {health.uptimeSeconds}s
                  </p>
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

              {/* Library counts */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h3 className="text-sm font-medium text-zinc-300">Indexed Library</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  These counts come live from SQLite and will populate once we build the library
                  scanner in Step 2.
                </p>
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
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
