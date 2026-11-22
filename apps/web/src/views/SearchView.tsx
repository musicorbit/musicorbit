import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FolderDown,
  Loader2,
  Lock,
  Radio,
  RefreshCw,
  Search,
  Square,
  Trash2,
  WifiOff,
} from "lucide-react";
import type {
  AcquisitionStatusResponse,
  DownloadsListResponse,
  SoulseekFileItem,
  SoulseekReleaseGroup,
  SoulseekSearchSummary,
} from "@musicorbit/shared";
import {
  clearCompletedDownloads,
  deleteSoulseekSearch,
  enqueueSoulseekDownloads,
  fetchAcquisitionStatus,
  fetchDownloads,
  fetchSoulseekSearchResults,
  removeDownload,
  startSoulseekSearch,
} from "../api/client";
import { formatBytes, formatDuration, formatSpeed } from "../utils/format";

type FormatFilter = "all" | "lossless" | "lossy";

export function SearchView() {
  const [status, setStatus] = useState<AcquisitionStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [tab, setTab] = useState<"search" | "downloads">("search");

  // Search state
  const [query, setQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState<SoulseekSearchSummary | null>(null);
  const [groups, setGroups] = useState<SoulseekReleaseGroup[]>([]);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [freeSlotsOnly, setFreeSlotsOnly] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [queuedKeys, setQueuedKeys] = useState<Record<string, boolean>>({});
  const [queueingKey, setQueueingKey] = useState<string | null>(null);
  const [startingSearch, setStartingSearch] = useState(false);

  // Downloads state
  const [downloads, setDownloads] = useState<DownloadsListResponse | null>(null);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const s = await fetchAcquisitionStatus();
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check slskd status");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadDownloads = useCallback(async () => {
    setDownloadsLoading(true);
    try {
      const data = await fetchDownloads();
      setDownloads(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load downloads");
    } finally {
      setDownloadsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Load downloads once connected, and poll every 2s while on the Downloads tab
  useEffect(() => {
    if (!status?.connected) return;
    void loadDownloads();
    if (tab !== "downloads") return;

    const timer = window.setInterval(() => {
      void fetchDownloads()
        .then(setDownloads)
        .catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [status?.connected, tab, loadDownloads]);

  // Poll active search responses every 1.2s until slskd marks it complete
  useEffect(() => {
    if (!activeSearch || activeSearch.isComplete) return;

    const poll = () => {
      void fetchSoulseekSearchResults(activeSearch.id)
        .then((res) => {
          setActiveSearch(res.search);
          setGroups(res.groups);
        })
        .catch(() => {});
    };

    poll();
    const timer = window.setInterval(poll, 1200);
    return () => window.clearInterval(timer);
  }, [activeSearch?.id, activeSearch?.isComplete]);

  const handleStartSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setStartingSearch(true);
    setError(null);
    setGroups([]);
    setExpandedGroups({});

    try {
      if (activeSearch && !activeSearch.isComplete) {
        await deleteSoulseekSearch(activeSearch.id).catch(() => {});
      }
      const created = await startSoulseekSearch(trimmed);
      setActiveSearch(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start search");
    } finally {
      setStartingSearch(false);
    }
  };

  const handleStopSearch = async () => {
    if (!activeSearch) return;
    try {
      await deleteSoulseekSearch(activeSearch.id);
    } catch {
      // Ignore stop errors
    } finally {
      setActiveSearch((prev) => (prev ? { ...prev, isComplete: true, state: "Stopped" } : null));
    }
  };

  const handleDownloadGroup = async (group: SoulseekReleaseGroup) => {
    const unlockedFiles = group.files.filter((f) => !f.isLocked);
    if (unlockedFiles.length === 0) return;

    setQueueingKey(group.id);
    setError(null);
    try {
      await enqueueSoulseekDownloads({
        username: group.username,
        files: unlockedFiles.map((f) => ({ filename: f.filename, size: f.size })),
      });
      setQueuedKeys((prev) => {
        const next = { ...prev, [group.id]: true };
        for (const f of unlockedFiles) {
          next[`${group.username}:${f.filename}`] = true;
        }
        return next;
      });
      void loadDownloads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enqueue album download");
    } finally {
      setQueueingKey(null);
    }
  };

  const handleDownloadSingleFile = async (username: string, file: SoulseekFileItem) => {
    const key = `${username}:${file.filename}`;
    setQueueingKey(key);
    setError(null);
    try {
      await enqueueSoulseekDownloads({
        username,
        files: [{ filename: file.filename, size: file.size }],
      });
      setQueuedKeys((prev) => ({ ...prev, [key]: true }));
      void loadDownloads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enqueue track download");
    } finally {
      setQueueingKey(null);
    }
  };

  const handleRemoveTransfer = async (username: string, transferId: string) => {
    try {
      await removeDownload(username, transferId);
      await loadDownloads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove transfer");
    }
  };

  const handleClearCompleted = async () => {
    try {
      await clearCompletedDownloads();
      await loadDownloads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear completed transfers");
    }
  };

  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      if (formatFilter === "lossless" && !g.isLossless) return false;
      if (formatFilter === "lossy" && g.isLossless) return false;
      if (freeSlotsOnly && !g.hasFreeUploadSlot) return false;
      return true;
    });
  }, [groups, formatFilter, freeSlotsOnly]);

  const isSearching = Boolean(activeSearch && !activeSearch.isComplete);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Soulseek Search</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Search the Soulseek network and manage downloads through your connected{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">slskd</code>{" "}
            instance.
          </p>
        </div>

        {/* Connection status pill */}
        <div className="flex items-center gap-2">
          {statusLoading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking slskd…
            </span>
          ) : status?.connected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              slskd connected{status.version ? ` · v${status.version}` : ""}
            </span>
          ) : status?.configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300">
              <WifiOff className="h-3.5 w-3.5" />
              slskd unreachable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <Radio className="h-3.5 w-3.5" />
              Not configured
            </span>
          )}

          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={statusLoading}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-45"
            title="Recheck slskd connection"
          >
            <RefreshCw className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Onboarding card when slskd is not configured */}
      {!statusLoading && status && !status.configured && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
              <Radio className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h3 className="text-base font-semibold text-zinc-100">
                  Connect an optional slskd instance
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  MusicOrbit drives Soulseek searches and downloads through{" "}
                  <strong className="text-zinc-200">slskd</strong>&apos;s REST API so the Soulseek
                  protocol and file sharing keep running cleanly in the background.
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300">
                <p className="text-zinc-500"># Add these two lines to your .env file and restart the API:</p>
                <p className="mt-1.5">SLSKD_URL=http://your-slskd-host:5030</p>
                <p>SLSKD_API_KEY=your_slskd_api_key</p>
              </div>

              <p className="text-xs text-zinc-500">
                In slskd, you can define an API key under{" "}
                <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
                  web.authentication.api_keys
                </code>{" "}
                in <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">slskd.yml</code>.
                MusicOrbit works fine without slskd if you only want a local music library and player.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Connection error card when configured but unreachable */}
      {!statusLoading && status?.configured && !status.connected && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <p className="font-medium">Could not reach slskd ({status.url})</p>
            <p className="mt-1 text-red-300/80">
              {status.error ?? "Verify SLSKD_URL, SLSKD_API_KEY, and network connectivity."}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Sub-tabs: Search & Downloads */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <button
          type="button"
          onClick={() => setTab("search")}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
            tab === "search"
              ? "bg-zinc-800 text-zinc-50"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <Search className="h-4 w-4" />
          Search Releases
        </button>

        <button
          type="button"
          onClick={() => setTab("downloads")}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
            tab === "downloads"
              ? "bg-zinc-800 text-zinc-50"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <Download className="h-4 w-4" />
          Downloads
          {downloads && downloads.activeCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
              {downloads.activeCount}
            </span>
          )}
        </button>
      </div>

      {tab === "search" ? (
        <div className="space-y-5">
          {/* Search form */}
          <form onSubmit={(e) => void handleStartSearch(e)} className="flex flex-wrap gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={!status?.connected}
                placeholder="Search artist, album, or song (e.g. Daft Punk Discovery FLAC)…"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/80 py-2.5 pr-4 pl-10 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
              />
            </div>

            {isSearching ? (
              <button
                type="button"
                onClick={() => void handleStopSearch()}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!status?.connected || startingSearch || !query.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
              >
                {startingSearch ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Search
              </button>
            )}
          </form>

          {/* Filters & Live Search Status */}
          {(activeSearch || groups.length > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "lossless", "lossy"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFormatFilter(mode)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      formatFilter === mode
                        ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {mode === "all"
                      ? `All (${groups.length})`
                      : mode === "lossless"
                        ? `FLAC / Lossless (${groups.filter((g) => g.isLossless).length})`
                        : `Lossy (${groups.filter((g) => !g.isLossless).length})`}
                  </button>
                ))}

                <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={freeSlotsOnly}
                    onChange={(e) => setFreeSlotsOnly(e.target.checked)}
                    className="rounded border-zinc-700 accent-amber-500"
                  />
                  Free slots only
                </label>
              </div>

              {activeSearch && (
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  {isSearching && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />}
                  <span>
                    {isSearching ? "Gathering peer responses…" : "Search complete"} ·{" "}
                    <strong className="text-zinc-200">{filteredGroups.length}</strong>{" "}
                    {filteredGroups.length === 1 ? "release" : "releases"}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Grouped Release Cards */}
          {filteredGroups.length > 0 ? (
            <div className="space-y-3">
              {filteredGroups.map((group) => {
                const expanded = Boolean(expandedGroups[group.id]);
                const groupQueued = Boolean(queuedKeys[group.id]);
                const allLocked = group.files.every((f) => f.isLocked);

                return (
                  <div
                    key={group.id}
                    className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/40"
                  >
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                        }
                        aria-label={expanded ? "Collapse folder" : "Expand folder"}
                        className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            className="truncate text-sm font-medium text-zinc-100"
                            title={group.directoryPath}
                          >
                            {group.folderName}
                          </p>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              group.isLossless
                                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                                : "bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700"
                            }`}
                          >
                            {group.format}
                          </span>
                          {group.avgBitrate && (
                            <span className="text-[11px] text-zinc-500">
                              {group.avgBitrate} kbps
                            </span>
                          )}
                          {group.hasLockedFiles && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                              <Lock className="h-2.5 w-2.5" /> Locked
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-400">
                          <span>
                            {group.trackCount} {group.trackCount === 1 ? "track" : "tracks"} ·{" "}
                            {formatBytes(group.totalSizeBytes)}
                          </span>
                          <span className="text-zinc-500">Peer: {group.username}</span>
                          <span className="text-zinc-500">{formatSpeed(group.uploadSpeed)}</span>
                          <span
                            className={
                              group.hasFreeUploadSlot ? "text-emerald-400" : "text-zinc-500"
                            }
                          >
                            {group.hasFreeUploadSlot
                              ? "Free slot"
                              : `Queue: ${group.queueLength}`}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={allLocked || queueingKey === group.id}
                        onClick={() => void handleDownloadGroup(group)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition disabled:opacity-45 ${
                          groupQueued
                            ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                            : "bg-amber-500 text-zinc-950 hover:bg-amber-400"
                        }`}
                      >
                        {queueingKey === group.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : groupQueued ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <FolderDown className="h-3.5 w-3.5" />
                        )}
                        {groupQueued ? "Queued" : "Download Album"}
                      </button>
                    </div>

                    {/* Expanded tracklist */}
                    {expanded && (
                      <div className="divide-y divide-zinc-800/60 border-t border-zinc-800/80 bg-zinc-950/40">
                        {group.files.map((file) => {
                          const fileKey = `${group.username}:${file.filename}`;
                          const fileQueued = Boolean(queuedKeys[fileKey]);
                          return (
                            <div
                              key={file.filename}
                              className="flex items-center gap-3 px-5 py-2 text-xs"
                            >
                              <span className="min-w-0 flex-1 truncate text-zinc-200">
                                {file.basename}
                              </span>
                              <span className="hidden text-zinc-500 sm:inline">
                                {file.extension.toUpperCase()}
                                {file.bitRate ? ` · ${file.bitRate} kbps` : ""}
                              </span>
                              <span className="w-12 text-right font-mono text-zinc-500">
                                {file.lengthSeconds ? formatDuration(file.lengthSeconds) : "—"}
                              </span>
                              <span className="w-16 text-right text-zinc-400">
                                {formatBytes(file.size)}
                              </span>
                              <button
                                type="button"
                                disabled={file.isLocked || queueingKey === fileKey}
                                onClick={() => void handleDownloadSingleFile(group.username, file)}
                                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                                  fileQueued
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : "border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                                }`}
                              >
                                {file.isLocked ? (
                                  <>
                                    <Lock className="h-3 w-3" /> Locked
                                  </>
                                ) : fileQueued ? (
                                  <>
                                    <Check className="h-3 w-3" /> Queued
                                  </>
                                ) : (
                                  <>
                                    <Download className="h-3 w-3" /> Get
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : activeSearch && !isSearching ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center text-sm text-zinc-400">
              No matching audio releases found for &ldquo;{activeSearch.query}&rdquo; with the
              current filters.
            </div>
          ) : null}
        </div>
      ) : (
        /* Downloads Tab */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
              <span>
                Active: <strong className="text-amber-300">{downloads?.activeCount ?? 0}</strong>
              </span>
              <span>
                Completed:{" "}
                <strong className="text-emerald-400">{downloads?.completedCount ?? 0}</strong>
              </span>
              <span>
                Failed: <strong className="text-red-400">{downloads?.failedCount ?? 0}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!status?.connected || (downloads?.completedCount ?? 0) === 0}
                onClick={() => void handleClearCompleted()}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-45"
              >
                Clear Completed
              </button>
              <button
                type="button"
                disabled={!status?.connected || downloadsLoading}
                onClick={() => void loadDownloads()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-45"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${downloadsLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          {!downloads || downloads.transfers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-14 text-center">
              <Download className="mx-auto h-7 w-7 text-zinc-600" />
              <p className="mt-3 text-sm font-medium text-zinc-300">No Soulseek downloads yet</p>
              <p className="mt-1 text-xs text-zinc-500">
                Search for an album or track and click Download to monitor live progress here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
              {downloads.transfers.map((tx) => (
                <div key={`${tx.username}-${tx.id}`} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{tx.basename}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {tx.folderName} · Peer: {tx.username} · {formatBytes(tx.size)}
                        {tx.isActive && tx.averageSpeed > 0
                          ? ` · ${formatSpeed(tx.averageSpeed)}`
                          : ""}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        tx.isCompleted
                          ? "bg-emerald-500/15 text-emerald-300"
                          : tx.isFailed
                            ? "bg-red-500/15 text-red-300"
                            : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {tx.state}
                    </span>

                    <button
                      type="button"
                      onClick={() => void handleRemoveTransfer(tx.username, tx.id)}
                      title="Cancel or remove transfer"
                      aria-label={`Remove ${tx.basename}`}
                      className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {tx.isActive && (
                    <div className="flex items-center gap-2.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full bg-amber-400 transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, tx.percentComplete))}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono text-[11px] text-zinc-400">
                        {tx.percentComplete.toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
