import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpCircle,
  Disc3,
  HelpCircle,
  KeyRound,
  ListMusic,
  LogOut,
  Menu,
  Music,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import type {
  AcquisitionStatusResponse,
  AlbumSummary,
  ArtistSummary,
  AuthStatusResponse,
  HealthResponse,
  PlaylistSummary,
  ScanStatusResponse,
  TrackSummary,
  UpdateCheckResponse,
} from "@musicorbit/shared";
import {
  fetchAcquisitionStatus,
  fetchAlbums,
  fetchArtists,
  fetchAuthStatus,
  fetchHealth,
  fetchImports,
  fetchPlaylists,
  fetchScanStatus,
  fetchTracks,
  fetchUpdateStatus,
  logoutUser,
  setOnboardingCompleted,
  triggerScan,
} from "./api/client";
import { AuthGate } from "./components/AuthGate";
import { ChangePasswordModal } from "./components/ChangePasswordModal";
import { OnboardingTour } from "./components/OnboardingTour";
import { PlayerBar } from "./components/PlayerBar";
import { UploadMusicModal } from "./components/UploadMusicModal";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { AlbumsView } from "./views/AlbumsView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { ArtistsView } from "./views/ArtistsView";
import { LogsView } from "./views/LogsView";
import { PlaylistDetailView } from "./views/PlaylistDetailView";
import { PlaylistsView } from "./views/PlaylistsView";
import { ReviewQueueView } from "./views/ReviewQueueView";
import { SearchView } from "./views/SearchView";
import { SystemView } from "./views/SystemView";
import { TracksView } from "./views/TracksView";
import { UsersView } from "./views/UsersView";

type Route =
  | { view: "albums" }
  | { view: "album-detail"; albumId: number }
  | { view: "artists" }
  | { view: "artist-detail"; artistId: number }
  | { view: "tracks" }
  | { view: "playlists" }
  | { view: "playlist-detail"; playlistId: number }
  | { view: "search" }
  | { view: "review" }
  | { view: "system" }
  | { view: "users" }
  | { view: "logs" };

function routeToPath(route: Route): string {
  switch (route.view) {
    case "albums":
      return "/";
    case "album-detail":
      return `/albums/${route.albumId}`;
    case "artists":
      return "/artists";
    case "artist-detail":
      return `/artists/${route.artistId}`;
    case "tracks":
      return "/tracks";
    case "playlists":
      return "/playlists";
    case "playlist-detail":
      return `/playlists/${route.playlistId}`;
    case "search":
      return "/search";
    case "review":
      return "/review";
    case "system":
      return "/system";
    case "users":
      return "/users";
    case "logs":
      return "/logs";
  }
}

function pathToRoute(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const segments = clean.split("/").filter(Boolean);
  const first = segments[0];
  const second = segments[1];
  const parsedId = second && /^\d+$/.test(second) ? Number(second) : null;

  if (first === "albums" && parsedId !== null) return { view: "album-detail", albumId: parsedId };
  if (first === "artists") {
    return parsedId !== null ? { view: "artist-detail", artistId: parsedId } : { view: "artists" };
  }
  if (first === "tracks") return { view: "tracks" };
  if (first === "playlists") {
    return parsedId !== null
      ? { view: "playlist-detail", playlistId: parsedId }
      : { view: "playlists" };
  }
  if (first === "search") return { view: "search" };
  if (first === "review") return { view: "review" };
  if (first === "system") return { view: "system" };
  if (first === "users") return { view: "users" };
  if (first === "logs") return { view: "logs" };
  return { view: "albums" };
}

function MusicOrbitShell() {
  const { currentTrack } = usePlayer();
  const [route, setRouteState] = useState<Route>(() =>
    typeof window !== "undefined" ? pathToRoute(window.location.pathname) : { view: "albums" },
  );
  const routeRef = useRef<Route>(route);
  routeRef.current = route;
  const historyDepthRef = useRef(0);

  const navigate = useCallback((next: Route, options?: { replace?: boolean }) => {
    const currentPath = routeToPath(routeRef.current);
    const nextPath = routeToPath(next);
    if (currentPath === nextPath) {
      setRouteState(next);
      return;
    }
    if (typeof window !== "undefined") {
      if (options?.replace) {
        window.history.replaceState({ moRoute: true, depth: historyDepthRef.current }, "", nextPath);
      } else {
        historyDepthRef.current += 1;
        window.history.pushState({ moRoute: true, depth: historyDepthRef.current }, "", nextPath);
      }
      window.scrollTo({ top: 0 });
    }
    routeRef.current = next;
    setRouteState(next);
  }, []);

  const goBackOr = useCallback(
    (fallback: Route) => {
      if (typeof window !== "undefined" && historyDepthRef.current > 0) {
        window.history.back();
        return;
      }
      navigate(fallback, { replace: true });
    },
    [navigate],
  );

  // Sync browser Back/Forward buttons and mobile swipe-back gestures with SPA routes
  useEffect(() => {
    const initialPath = routeToPath(routeRef.current);
    const existingDepth =
      typeof window.history.state?.depth === "number" ? window.history.state.depth : 0;
    historyDepthRef.current = existingDepth;
    window.history.replaceState({ moRoute: true, depth: existingDepth }, "", initialPath);

    const onPopState = (e: PopStateEvent) => {
      const nextDepth = typeof e.state?.depth === "number" ? e.state.depth : 0;
      historyDepthRef.current = Math.max(0, nextDepth);
      const nextRoute = pathToRoute(window.location.pathname);
      routeRef.current = nextRoute;
      setMobileNavOpen(false);
      setRouteState(nextRoute);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatusResponse | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [slskdStatus, setSlskdStatus] = useState<AcquisitionStatusResponse | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [soulseekLaunch, setSoulseekLaunch] = useState<{ query: string; nonce: number } | null>(
    null,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const autoTourTriggeredForUserRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingScan, setStartingScan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check optional authentication status first
  useEffect(() => {
    void fetchAuthStatus()
      .then(setAuthStatus)
      .catch(() => {
        // Fallback so API offline errors render inside the main shell
        setAuthStatus({
          authEnabled: false,
          authenticated: true,
          needsSetup: false,
          user: null,
        });
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const isAuthorized = !authStatus?.authEnabled || authStatus.authenticated;

  const loadLibrary = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const [h, s, al, ar, tr, pl, imp, acq] = await Promise.all([
        fetchHealth(),
        fetchScanStatus(),
        fetchAlbums(q),
        fetchArtists(q),
        fetchTracks(q, 200),
        fetchPlaylists(),
        fetchImports("needs_review"),
        fetchAcquisitionStatus().catch(() => null),
      ]);
      setHealth(h);
      setScanStatus(s);
      setAlbums(al);
      setArtists(ar);
      setTracks(tr);
      setPlaylists(pl);
      setNeedsReviewCount(imp.needsReviewCount);
      setSlskdStatus(acq);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach MusicOrbit API");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPlaylists = useCallback(async () => {
    try {
      const pl = await fetchPlaylists();
      setPlaylists(pl);
    } catch {
      // Non-fatal
    }
  }, []);

  // Re-fetch when search query changes or after login (debounced 180ms for smooth typing)
  useEffect(() => {
    if (!authChecked || !isAuthorized) return;
    const timer = window.setTimeout(() => {
      void loadLibrary(searchQuery);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [authChecked, isAuthorized, searchQuery, loadLibrary]);

  // Poll scan status while a scan is running
  useEffect(() => {
    if (!isAuthorized || scanStatus?.state !== "running") return;
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
  }, [isAuthorized, scanStatus?.state, searchQuery, loadLibrary]);

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

  const handleLogout = async () => {
    try {
      await logoutUser();
    } finally {
      setAlbums([]);
      setArtists([]);
      setTracks([]);
      setPlaylists([]);
      setHealth(null);
      setScanStatus(null);
      setNeedsReviewCount(0);
      setSearchQuery("");
      setUploadOpen(false);
      setChangePasswordOpen(false);
      setTourOpen(false);
      autoTourTriggeredForUserRef.current = null;
      navigate({ view: "albums" }, { replace: true });
      const next = await fetchAuthStatus().catch(() => ({
        authEnabled: true,
        authenticated: false,
        needsSetup: false,
        user: null,
      }));
      setAuthStatus(next);
    }
  };

  const isAdmin = !authStatus?.authEnabled || authStatus.user?.role === "admin";
  const slskdConfigured = Boolean(slskdStatus?.configured);
  const hasSoulseekPermission =
    !authStatus?.authEnabled || isAdmin || Boolean(authStatus?.user?.canUseSoulseek);
  const canUseSoulseek = slskdConfigured && hasSoulseekPermission;

  // Non-blocking Admin check for newer GitHub Releases (cached 12h server-side)
  useEffect(() => {
    if (!authChecked || !isAuthorized || !isAdmin) {
      setUpdateInfo(null);
      return;
    }
    let cancelled = false;
    void fetchUpdateStatus()
      .then((info) => {
        if (!cancelled) setUpdateInfo(info);
      })
      .catch(() => {
        // Silent failure if offline or disabled
      });
    return () => {
      cancelled = true;
    };
  }, [authChecked, isAuthorized, isAdmin]);

  const handleOpenSoulseekSearch = useCallback(
    (initialQuery?: string) => {
      if (initialQuery?.trim()) {
        setSoulseekLaunch({ query: initialQuery.trim(), nonce: Date.now() });
      }
      navigate({ view: "search" });
    },
    [navigate],
  );

  // Auto-launch the spotlight onboarding tour once on a user's first desktop login (skip on mobile/tablet where sidebar is collapsed)
  useEffect(() => {
    const user = authStatus?.user;
    if (!authChecked || !isAuthorized || !user || loading) return;
    if (typeof window !== "undefined" && window.innerWidth < 1024) return;
    if (user.onboardingCompleted) return;
    if (autoTourTriggeredForUserRef.current === user.id) return;
    autoTourTriggeredForUserRef.current = user.id;
    navigate({ view: "albums" }, { replace: true });
    setTourOpen(true);
  }, [authChecked, isAuthorized, authStatus?.user, loading, navigate]);

  // Dismiss active spotlight tour if viewport shrinks below desktop breakpoint
  useEffect(() => {
    if (!tourOpen) return;
    const onResize = () => {
      if (window.innerWidth < 1024) setTourOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [tourOpen]);

  const handleCompleteTour = useCallback(() => {
    setTourOpen(false);
    setAuthStatus((prev) =>
      prev?.user
        ? {
            ...prev,
            user: { ...prev.user, onboardingCompleted: true },
          }
        : prev,
    );
    void setOnboardingCompleted(true).catch(() => {});
  }, []);

  const handleEnsureAlbumsView = useCallback(() => {
    if (routeRef.current.view !== "albums") {
      navigate({ view: "albums" }, { replace: true });
    }
  }, [navigate]);

  // Bounce away from routes that are unavailable for the current user's role/permissions
  useEffect(() => {
    if (!hasSoulseekPermission && route.view === "search") {
      navigate({ view: "albums" }, { replace: true });
    } else if (!isAdmin && route.view === "users") {
      navigate({ view: "albums" }, { replace: true });
    }
  }, [hasSoulseekPermission, isAdmin, route.view, navigate]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        Loading MusicOrbit…
      </div>
    );
  }

  if (authStatus?.authEnabled && !authStatus.authenticated) {
    return (
      <AuthGate
        needsSetup={authStatus.needsSetup}
        onAuthenticated={(next) => {
          navigate({ view: "albums" }, { replace: true });
          setAuthStatus(next);
        }}
      />
    );
  }

  const navItems: Array<{
    id:
      | "albums"
      | "artists"
      | "tracks"
      | "playlists"
      | "search"
      | "review"
      | "system"
      | "users"
      | "logs";
    label: string;
    icon: typeof Disc3;
    count: number | undefined;
    highlightBadge?: boolean;
    badgeText?: string;
  }> = [
    { id: "albums", label: "Albums", icon: Disc3, count: health?.counts.albums },
    { id: "artists", label: "Artists", icon: Users, count: health?.counts.artists },
    { id: "tracks", label: "Tracks", icon: Music, count: health?.counts.tracks },
    { id: "playlists", label: "Playlists", icon: ListMusic, count: playlists.length },
    ...(hasSoulseekPermission
      ? [{ id: "search" as const, label: "Soulseek Search", icon: Search, count: undefined }]
      : []),
    {
      id: "review",
      label: "Review Queue",
      icon: Sparkles,
      count: needsReviewCount > 0 ? needsReviewCount : undefined,
      highlightBadge: needsReviewCount > 0,
    },
    {
      id: "system",
      label: isAdmin ? "System & Scanner" : "Library Settings",
      icon: Activity,
      count: undefined,
      highlightBadge: Boolean(isAdmin && updateInfo?.updateAvailable),
      badgeText: isAdmin && updateInfo?.updateAvailable ? "Update" : undefined,
    },
    ...(authStatus?.authEnabled && isAdmin
      ? [{ id: "users" as const, label: "Users", icon: ShieldCheck, count: undefined }]
      : []),
    { id: "logs", label: "Activity Logs", icon: ScrollText, count: undefined },
  ];

  const isNavActive = (
    id:
      | "albums"
      | "artists"
      | "tracks"
      | "playlists"
      | "search"
      | "review"
      | "system"
      | "users"
      | "logs",
  ) => {
    if (route.view === id) return true;
    if (id === "albums" && route.view === "album-detail") return true;
    if (id === "artists" && route.view === "artist-detail") return true;
    if (id === "playlists" && route.view === "playlist-detail") return true;
    return false;
  };

  const showSearchBar =
    route.view === "albums" || route.view === "artists" || route.view === "tracks";

  const navigateFromSidebar = (
    id:
      | "albums"
      | "artists"
      | "tracks"
      | "playlists"
      | "search"
      | "review"
      | "system"
      | "users"
      | "logs",
  ) => {
    navigate({ view: id });
    setMobileNavOpen(false);
  };

  const renderSidebarBody = (inMobileDrawer: boolean) => (
    <>
      <div className="mb-6 flex items-center justify-between gap-2 px-2 lg:mb-8">
        <button
          type="button"
          onClick={() => navigateFromSidebar("albums")}
          className="flex items-center gap-3 text-left"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
            <Disc3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-50">MusicOrbit</h1>
            <p className="text-xs text-zinc-500">v{health?.version ?? "0.1.0"}</p>
          </div>
        </button>

        {inMobileDrawer && (
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
          Library
        </p>

        {navItems.map(({ id, label, icon: Icon, count, highlightBadge, badgeText }) => {
          const active = isNavActive(id);
          return (
            <button
              key={id}
              type="button"
              data-tour={inMobileDrawer ? undefined : `nav-${id}`}
              onClick={() => navigateFromSidebar(id)}
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition lg:py-2 ${
                active
                  ? "bg-zinc-800/90 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon className={`h-4 w-4 ${active ? "text-amber-400" : "text-zinc-500"}`} />
                {label}
              </span>
              {(count !== undefined || badgeText) && (
                <span
                  className={
                    highlightBadge
                      ? "rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300"
                      : "text-xs font-normal text-zinc-500"
                  }
                >
                  {badgeText ?? count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-6 space-y-2.5">
        {isAdmin && updateInfo?.updateAvailable && updateInfo.latestVersion && (
          <button
            type="button"
            onClick={() => navigateFromSidebar("system")}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/15"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ArrowUpCircle className="h-4 w-4 shrink-0 text-amber-400" />
              <span className="truncate font-medium">
                v{updateInfo.latestVersion} available
              </span>
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-amber-300">Details</span>
          </button>
        )}

        {authStatus?.authEnabled && authStatus.user && (
          <div
            data-tour={inMobileDrawer ? undefined : "user-card"}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-100">{authStatus.user.username}</p>
              <p className="text-[10px] text-zinc-500">
                {authStatus.user.role === "admin" ? "Administrator" : "Member"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!inMobileDrawer && (
                <button
                  type="button"
                  onClick={() => {
                    navigate({ view: "albums" });
                    setTourOpen(true);
                  }}
                  title="Quick tour"
                  aria-label="Replay quick tour"
                  className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-amber-300"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  setChangePasswordOpen(true);
                }}
                title="Change password"
                aria-label="Change password"
                className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-amber-300 lg:p-1"
              >
                <KeyRound className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  void handleLogout();
                }}
                title="Sign out"
                aria-label="Sign out"
                className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 lg:p-1"
              >
                <LogOut className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-3 text-xs text-zinc-400">
          <span>Open-source self-hosted music hub (AGPL-3.0).</span>
          {!authStatus?.authEnabled && !inMobileDrawer && (
            <button
              type="button"
              onClick={() => {
                navigate({ view: "albums" });
                setTourOpen(true);
              }}
              title="Replay quick tour"
              aria-label="Replay quick tour"
              className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-amber-300"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 lg:flex-row">
      {/* Mobile / Tablet Sticky Top Bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-950/90 px-3 backdrop-blur-xl lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-200 transition hover:bg-zinc-800"
          >
            <Menu className="h-5 w-5" />
            {needsReviewCount > 0 && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-zinc-950" />
            )}
          </button>

          <button
            type="button"
            onClick={() => navigate({ view: "albums" })}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
              <Disc3 className="h-4 w-4" />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight text-zinc-50">
              MusicOrbit
            </span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            aria-label="Upload music"
            title="Upload music"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden xs:inline sm:inline">Upload</span>
          </button>
          <button
            type="button"
            onClick={() => void handleScan(false)}
            disabled={scanStatus?.state === "running" || startingScan}
            aria-label="Scan library"
            title="Scan library"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
          >
            <RefreshCw
              className={`h-4 w-4 ${scanStatus?.state === "running" ? "animate-spin text-amber-400" : ""}`}
            />
          </button>
        </div>
      </header>

      {/* Mobile Slide-Over Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 bg-zinc-950/75 backdrop-blur-sm"
          />
          <aside className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-950 px-4 py-5 shadow-2xl">
            {renderSidebarBody(true)}
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/40 px-4 py-6 lg:flex">
        {renderSidebarBody(false)}
      </aside>

      {/* Main Content (adds bottom padding when PlayerBar is visible so nothing gets covered) */}
      <main
        className={`min-w-0 flex-1 px-4 py-5 sm:px-6 md:px-8 md:py-8 ${
          currentTrack ? "pb-36 md:pb-32" : "pb-12"
        }`}
      >
        <div className="mx-auto max-w-6xl">
          {/* Top header for main library views */}
          {showSearchBar && (
            <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-50 capitalize sm:text-2xl">
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

              <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-2.5">
                <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
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
                  data-tour="upload-btn"
                  onClick={() => setUploadOpen(true)}
                  title="Upload songs or an album folder from your computer"
                  className="hidden items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 lg:inline-flex"
                >
                  <Upload className="h-4 w-4" />
                  <span>Upload</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleScan(false)}
                  disabled={scanStatus?.state === "running" || startingScan}
                  title="Scan library for new or updated audio files"
                  className="hidden items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45 lg:inline-flex"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${scanStatus?.state === "running" ? "animate-spin text-amber-400" : ""}`}
                  />
                  <span>{scanStatus?.state === "running" ? "Scanning…" : "Scan"}</span>
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
              onSelectAlbum={(albumId) => navigate({ view: "album-detail", albumId })}
              onSelectArtist={(artistId) => navigate({ view: "artist-detail", artistId })}
              onGoToScanner={() => navigate({ view: "system" })}
            />
          )}

          {route.view === "album-detail" && (
            <AlbumDetailView
              albumId={route.albumId}
              onBack={() => goBackOr({ view: "albums" })}
              onSelectArtist={(artistId) => navigate({ view: "artist-detail", artistId })}
              onAlbumRetagged={() => void loadLibrary(searchQuery)}
              onPlaylistsChanged={() => void refreshPlaylists()}
              slskdConfigured={canUseSoulseek}
              onSearchSoulseek={handleOpenSoulseekSearch}
            />
          )}

          {route.view === "artists" && (
            <ArtistsView
              artists={artists}
              loading={loading}
              searchQuery={searchQuery}
              onSelectArtist={(artistId) => navigate({ view: "artist-detail", artistId })}
              onGoToScanner={() => navigate({ view: "system" })}
            />
          )}

          {route.view === "artist-detail" && (
            <ArtistDetailView
              artistId={route.artistId}
              onBack={() => goBackOr({ view: "artists" })}
              onSelectAlbum={(albumId) => navigate({ view: "album-detail", albumId })}
              onSelectArtist={(artistId) => navigate({ view: "artist-detail", artistId })}
              onGoToScanner={() => navigate({ view: "system" })}
              onArtistImageChanged={() => void loadLibrary(searchQuery)}
              onPlaylistsChanged={() => void refreshPlaylists()}
            />
          )}

          {route.view === "tracks" && (
            <TracksView
              tracks={tracks}
              loading={loading}
              searchQuery={searchQuery}
              onSelectAlbum={(albumId) => navigate({ view: "album-detail", albumId })}
              onSelectArtist={(artistId) => navigate({ view: "artist-detail", artistId })}
              onGoToScanner={() => navigate({ view: "system" })}
              onTrackMetadataSaved={() => void loadLibrary(searchQuery)}
              onPlaylistsChanged={() => void refreshPlaylists()}
            />
          )}

          {route.view === "playlists" && (
            <PlaylistsView
              playlists={playlists}
              loading={loading}
              onSelectPlaylist={(playlistId) => navigate({ view: "playlist-detail", playlistId })}
              onPlaylistsChanged={() => void refreshPlaylists()}
            />
          )}

          {route.view === "playlist-detail" && (
            <PlaylistDetailView
              playlistId={route.playlistId}
              canUseSoulseek={canUseSoulseek}
              onBack={() => goBackOr({ view: "playlists" })}
              onSelectAlbum={(albumId) => navigate({ view: "album-detail", albumId })}
              onSelectArtist={(artistId) => navigate({ view: "artist-detail", artistId })}
              onPlaylistsChanged={() => void refreshPlaylists()}
            />
          )}

          {route.view === "search" && hasSoulseekPermission && (
            <SearchView
              isAdmin={isAdmin}
              onOpenSettings={() => navigate({ view: "system" })}
              initialQuery={soulseekLaunch?.query}
              initialQueryNonce={soulseekLaunch?.nonce}
            />
          )}

          {route.view === "review" && (
            <ReviewQueueView
              isAdmin={isAdmin}
              onLibraryChanged={() => void loadLibrary(searchQuery)}
            />
          )}

          {route.view === "system" && (
            <SystemView
              isAdmin={isAdmin}
              canUseSoulseek={canUseSoulseek}
              health={health}
              scanStatus={scanStatus}
              slskdStatus={slskdStatus}
              updateInfo={updateInfo}
              loading={loading}
              startingScan={startingScan}
              onScan={(force) => void handleScan(force)}
              onRefresh={() => void loadLibrary(searchQuery)}
              onMusicDirChanged={() => void loadLibrary(searchQuery)}
              onOpenSoulseek={() => handleOpenSoulseekSearch()}
              onSlskdStatusChanged={(next) => setSlskdStatus(next)}
              onUpdateInfoChanged={(next) => setUpdateInfo(next)}
              onOpenReviewQueue={() => navigate({ view: "review" })}
              onOpenUpload={() => setUploadOpen(true)}
            />
          )}

          {route.view === "users" && authStatus?.authEnabled && isAdmin && (
            <UsersView
              currentUserId={authStatus.user?.id ?? null}
              slskdConfigured={slskdConfigured}
            />
          )}

          {route.view === "logs" && <LogsView isAdmin={isAdmin} />}
        </div>
      </main>

      <PlayerBar
        onSelectAlbum={(albumId) => navigate({ view: "album-detail", albumId })}
        onSelectArtist={(artistId) => navigate({ view: "artist-detail", artistId })}
      />

      {uploadOpen && (
        <UploadMusicModal
          onClose={() => setUploadOpen(false)}
          onUploaded={() => void loadLibrary(searchQuery)}
          onOpenReviewQueue={() => navigate({ view: "review" })}
        />
      )}

      {changePasswordOpen && authStatus?.user && (
        <ChangePasswordModal
          username={authStatus.user.username}
          onClose={() => setChangePasswordOpen(false)}
        />
      )}

      {tourOpen && (
        <OnboardingTour
          username={authStatus?.user?.username ?? ""}
          isAdmin={isAdmin}
          authEnabled={Boolean(authStatus?.authEnabled)}
          canUseSoulseek={canUseSoulseek}
          onEnsureAlbumsView={handleEnsureAlbumsView}
          onComplete={handleCompleteTour}
        />
      )}
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
