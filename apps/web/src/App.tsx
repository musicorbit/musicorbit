import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Disc3,
  ListMusic,
  Music,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type {
  AlbumSummary,
  ArtistSummary,
  HealthResponse,
  ScanStatusResponse,
  TrackSummary,
} from "@musicorbit/shared";
import {
  fetchAlbums,
  fetchArtists,
  fetchHealth,
  fetchScanStatus,
  fetchTracks,
  triggerScan,
} from "./api/client";
import { PlayerBar } from "./components/PlayerBar";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { AlbumsView } from "./views/AlbumsView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { ArtistsView } from "./views/ArtistsView";
import { SystemView } from "./views/SystemView";
import { TracksView } from "./views/TracksView";

type Route =
  | { view: "albums" }
  | { view: "album-detail"; albumId: number }
  | { view: "artists" }
  | { view: "artist-detail"; artistId: number }
  | { view: "tracks" }
  | { view: "system" };

const UPCOMING_NAV = [
  { label: "Soulseek Search", icon: Search, step: "Step 4" },
  { label: "Review Queue", icon: Sparkles, step: "Step 5" },
  { label: "Playlists", icon: ListMusic, step: "Step 6" },
];

function MusicOrbitShell() {
  const { currentTrack } = usePlayer();
  const [route, setRoute] = useState<Route>({ view: "albums" });
  const [searchQuery, setSearchQuery] = useState("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatusResponse | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingScan, setStartingScan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLibrary = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const [h, s, al, ar, tr] = await Promise.all([
        fetchHealth(),
        fetchScanStatus(),
        fetchAlbums(q),
        fetchArtists(q),
        fetchTracks(q, 200),
      ]);
      setHealth(h);
      setScanStatus(s);
      setAlbums(al);
      setArtists(ar);
      setTracks(tr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach MusicOrbit API");
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch when search query changes (debounced 180ms for smooth typing)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLibrary(searchQuery);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchQuery, loadLibrary]);

  // Poll scan status while a scan is running
  useEffect(() => {
    if (scanStatus?.state !== "running") return;
    const timer = window.setInterval(() => {
      void fetchScanStatus()
        .then((next) => {
          setScanStatus(next);
          if (next.state !== "running") {
            void loadLibrary(searchQuery);
          }
        })
        .catch(() => {});
    }, 500);
    return () => window.clearInterval(timer);
  }, [scanStatus?.state, searchQuery, loadLibrary]);

  const handleScan = async (force = false) => {
    setStartingScan(true);
    setError(null);
    try {
      const next = await triggerScan(force);
      setScanStatus(next);
      if (next.state !== "running") {
        await loadLibrary(searchQuery);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start library scan");
    } finally {
      setStartingScan(false);
    }
  };

  const navItems = [
    { id: "albums" as const, label: "Albums", icon: Disc3, count: health?.counts.albums },
    { id: "artists" as const, label: "Artists", icon: Users, count: health?.counts.artists },
    { id: "tracks" as const, label: "Tracks", icon: Music, count: health?.counts.tracks },
    { id: "system" as const, label: "System & Scanner", icon: Activity, count: undefined },
  ];

  const isNavActive = (id: "albums" | "artists" | "tracks" | "system") => {
    if (route.view === id) return true;
    if (id === "albums" && route.view === "album-detail") return true;
    if (id === "artists" && route.view === "artist-detail") return true;
    return false;
  };

  const showSearchBar =
    route.view === "albums" || route.view === "artists" || route.view === "tracks";

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/40 px-4 py-6">
        <button
          type="button"
          onClick={() => setRoute({ view: "albums" })}
          className="mb-8 flex items-center gap-3 px-2 text-left"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
            <Disc3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-50">MusicOrbit</h1>
            <p className="text-xs text-zinc-500">v{health?.version ?? "0.1.0"}</p>
          </div>
        </button>

        <nav className="flex flex-1 flex-col gap-1">
          <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
            Library
          </p>

          {navItems.map(({ id, label, icon: Icon, count }) => {
            const active = isNavActive(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setRoute({ view: id })}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-zinc-800/90 text-zinc-50"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${active ? "text-amber-400" : "text-zinc-500"}`} />
                  {label}
                </span>
                {count !== undefined && (
                  <span className="text-xs font-normal text-zinc-500">{count}</span>
                )}
              </button>
            );
          })}

          <p className="mt-6 mb-1.5 px-3 text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
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

      {/* Main Content (adds bottom padding when PlayerBar is visible so nothing gets covered) */}
      <main className={`flex-1 px-8 py-8 ${currentTrack ? "pb-32" : "pb-12"}`}>
        <div className="mx-auto max-w-6xl">
          {/* Top header for main library views */}
          {showSearchBar && (
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-50 capitalize">
                  {route.view}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {route.view === "albums" &&
                    `${albums.length} ${albums.length === 1 ? "album" : "albums"}`}
                  {route.view === "artists" &&
                    `${artists.length} ${artists.length === 1 ? "artist" : "artists"}`}
                  {route.view === "tracks" &&
                    `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`}
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="relative w-64 sm:w-72">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Filter ${route.view}…`}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900/80 py-2 pr-8 pl-9 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void handleScan(false)}
                  disabled={scanStatus?.state === "running" || startingScan}
                  title="Scan library for new or updated audio files"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${scanStatus?.state === "running" ? "animate-spin text-amber-400" : ""}`}
                  />
                  <span className="hidden sm:inline">
                    {scanStatus?.state === "running" ? "Scanning…" : "Scan"}
                  </span>
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="font-medium">API Error</p>
                <p className="mt-1 text-red-300/80">{error}</p>
              </div>
            </div>
          )}

          {route.view === "albums" && (
            <AlbumsView
              albums={albums}
              loading={loading}
              searchQuery={searchQuery}
              onSelectAlbum={(albumId) => setRoute({ view: "album-detail", albumId })}
              onSelectArtist={(artistId) => setRoute({ view: "artist-detail", artistId })}
              onGoToScanner={() => setRoute({ view: "system" })}
            />
          )}

          {route.view === "album-detail" && (
            <AlbumDetailView
              albumId={route.albumId}
              onBack={() => setRoute({ view: "albums" })}
              onSelectArtist={(artistId) => setRoute({ view: "artist-detail", artistId })}
            />
          )}

          {route.view === "artists" && (
            <ArtistsView
              artists={artists}
              loading={loading}
              searchQuery={searchQuery}
              onSelectArtist={(artistId) => setRoute({ view: "artist-detail", artistId })}
              onGoToScanner={() => setRoute({ view: "system" })}
            />
          )}

          {route.view === "artist-detail" && (
            <ArtistDetailView
              artistId={route.artistId}
              onBack={() => setRoute({ view: "artists" })}
              onSelectAlbum={(albumId) => setRoute({ view: "album-detail", albumId })}
              onSelectArtist={(artistId) => setRoute({ view: "artist-detail", artistId })}
              onGoToScanner={() => setRoute({ view: "system" })}
              onArtistImageChanged={() => void loadLibrary(searchQuery)}
            />
          )}

          {route.view === "tracks" && (
            <TracksView
              tracks={tracks}
              loading={loading}
              searchQuery={searchQuery}
              onSelectAlbum={(albumId) => setRoute({ view: "album-detail", albumId })}
              onSelectArtist={(artistId) => setRoute({ view: "artist-detail", artistId })}
              onGoToScanner={() => setRoute({ view: "system" })}
            />
          )}

          {route.view === "system" && (
            <SystemView
              health={health}
              scanStatus={scanStatus}
              loading={loading}
              startingScan={startingScan}
              onScan={(force) => void handleScan(force)}
              onRefresh={() => void loadLibrary(searchQuery)}
            />
          )}
        </div>
      </main>

      <PlayerBar
        onSelectAlbum={(albumId) => setRoute({ view: "album-detail", albumId })}
        onSelectArtist={(artistId) => setRoute({ view: "artist-detail", artistId })}
      />
    </div>
  );
}

export function App() {
  return (
    <PlayerProvider>
      <MusicOrbitShell />
    </PlayerProvider>
  );
}
