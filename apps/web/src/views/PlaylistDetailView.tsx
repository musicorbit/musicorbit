import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  AcquisitionStatusResponse,
  MissingTrackBatchItemState,
  MissingTrackBatchJobStatus,
  MissingTrackSearchCandidate,
  PlaylistDetailResponse,
} from "@musicorbit/shared";
import {
  cancelMissingTracksBatchSearch,
  deletePlaylist,
  dismissMissingPlaylistTrack,
  downloadMissingPlaylistTrack,
  fetchAcquisitionStatus,
  fetchMissingTracksBatchStatus,
  fetchPlaylistDetail,
  getPlaylistExportUrl,
  recheckMissingPlaylistTracks,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  startMissingTracksBatchSearch,
} from "../api/client";
import { AlbumCover } from "../components/AlbumCover";
import { EditPlaylistCoverModal } from "../components/EditPlaylistCoverModal";
import { PlaylistCover } from "../components/PlaylistCover";
import { usePlayer } from "../context/PlayerContext";
import { formatCodec, formatDuration, formatTotalDuration } from "../utils/format";

interface PlaylistDetailViewProps {
  playlistId: number;
  onBack: () => void;
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
  onPlaylistsChanged: () => void;
}

function formatBytesShort(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatCandidateLabel(c: MissingTrackSearchCandidate): string {
  const fmt = c.extension.toUpperCase();
  const br = c.bitRate ? `${c.bitRate} kbps` : c.isLossless ? "Lossless" : "";
  const size = formatBytesShort(c.size);
  const slot = c.hasFreeUploadSlot ? "free slot" : `queue ${c.queueLength}`;
  return [fmt, br, size, `@${c.username}`, slot].filter(Boolean).join(" · ");
}

export function PlaylistDetailView({
  playlistId,
  onBack,
  onSelectAlbum,
  onSelectArtist,
  onPlaylistsChanged,
}: PlaylistDetailViewProps) {
  const [detail, setDetail] = useState<PlaylistDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slskdStatus, setSlskdStatus] = useState<AcquisitionStatusResponse | null>(null);
  const [batchJob, setBatchJob] = useState<MissingTrackBatchJobStatus | null>(null);
  const [concurrency, setConcurrency] = useState<number>(2);
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<Record<number, number>>({});
  const [downloadingIds, setDownloadingIds] = useState<Record<number, boolean>>({});
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [recheckNotice, setRecheckNotice] = useState<string | null>(null);
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const { currentTrack, isPlaying, playQueue, togglePlay } = usePlayer();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, acq, job] = await Promise.all([
        fetchPlaylistDetail(playlistId),
        fetchAcquisitionStatus().catch(() => null),
        fetchMissingTracksBatchStatus(playlistId).catch(() => null),
      ]);
      setDetail(res);
      setSlskdStatus(acq);
      if (job && job.items.length > 0) {
        setBatchJob(job);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load playlist");
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll batch search status while running so per-song progress updates live
  useEffect(() => {
    if (batchJob?.state !== "running") return;
    const timer = window.setInterval(() => {
      void fetchMissingTracksBatchStatus(playlistId)
        .then((next) => setBatchJob(next))
        .catch(() => {});
    }, 800);
    return () => window.clearInterval(timer);
  }, [batchJob?.state, playlistId]);

  const batchItemsById = useMemo(() => {
    const map = new Map<number, MissingTrackBatchItemState>();
    for (const item of batchJob?.items ?? []) {
      map.set(item.missingTrackId, item);
    }
    return map;
  }, [batchJob]);

  const handleMove = async (index: number, delta: -1 | 1) => {
    if (!detail) return;
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= detail.tracks.length) return;
    const ids = detail.tracks.map((t) => t.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(nextIdx, 0, moved);
    const updated = await reorderPlaylistTracks(playlistId, ids);
    setDetail(updated);
    onPlaylistsChanged();
  };

  const handleRemove = async (trackId: number) => {
    const updated = await removeTrackFromPlaylist(playlistId, trackId);
    setDetail(updated);
    onPlaylistsChanged();
  };

  const handleDeletePlaylist = async () => {
    await deletePlaylist(playlistId);
    onPlaylistsChanged();
    onBack();
  };

  const handleStartBatchSearch = async (missingTrackIds?: number[]) => {
    setBatchError(null);
    try {
      const next = await startMissingTracksBatchSearch(playlistId, {
        missingTrackIds,
        concurrency,
      });
      setBatchJob(next);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Could not start Soulseek search");
    }
  };

  const handleCancelBatchSearch = async () => {
    try {
      const next = await cancelMissingTracksBatchSearch(playlistId);
      setBatchJob(next);
    } catch {
      // Non-fatal
    }
  };

  const handleDownloadCandidate = async (
    missingTrackId: number,
    candidate: MissingTrackSearchCandidate,
  ) => {
    setDownloadingIds((prev) => ({ ...prev, [missingTrackId]: true }));
    setBatchError(null);
    try {
      await downloadMissingPlaylistTrack(playlistId, missingTrackId, {
        username: candidate.username,
        filename: candidate.filename,
        size: candidate.size,
      });
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              missingTracks: prev.missingTracks.map((m) =>
                m.id === missingTrackId ? { ...m, status: "queued" } : m,
              ),
            }
          : prev,
      );
      setBatchJob((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.missingTrackId === missingTrackId ? { ...item, state: "queued" } : item,
              ),
            }
          : prev,
      );
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Failed to enqueue download");
    } finally {
      setDownloadingIds((prev) => ({ ...prev, [missingTrackId]: false }));
    }
  };

  const foundDownloadables = useMemo(() => {
    if (!detail) return [];
    const list: Array<{ missingTrackId: number; candidate: MissingTrackSearchCandidate }> = [];
    for (const track of detail.missingTracks) {
      if (track.status === "queued") continue;
      const item = batchItemsById.get(track.id);
      if (!item || item.state !== "found" || item.candidates.length === 0) continue;
      const chosenIdx = selectedCandidateIdx[track.id] ?? 0;
      const cand = item.candidates[chosenIdx] ?? item.candidates[0];
      if (cand) list.push({ missingTrackId: track.id, candidate: cand });
    }
    return list;
  }, [detail, batchItemsById, selectedCandidateIdx]);

  const handleDownloadAllFound = async () => {
    if (foundDownloadables.length === 0) return;
    setDownloadingAll(true);
    setBatchError(null);
    try {
      for (const entry of foundDownloadables) {
        await handleDownloadCandidate(entry.missingTrackId, entry.candidate);
      }
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleRecheckLibrary = async () => {
    setRechecking(true);
    setRecheckNotice(null);
    setBatchError(null);
    try {
      const res = await recheckMissingPlaylistTracks(playlistId);
      setDetail({
        playlist: res.playlist,
        tracks: res.tracks,
        missingTracks: res.missingTracks,
      });
      onPlaylistsChanged();
      setRecheckNotice(
        res.newlyMatchedCount > 0
          ? `Matched ${res.newlyMatchedCount} newly available ${res.newlyMatchedCount === 1 ? "track" : "tracks"} from your library!`
          : "No newly scanned matches found yet.",
      );
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Could not re-check library");
    } finally {
      setRechecking(false);
    }
  };

  const handleDismissMissing = async (missingId: number) => {
    try {
      const updated = await dismissMissingPlaylistTrack(playlistId, missingId);
      setDetail(updated);
      onPlaylistsChanged();
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Could not dismiss track");
    }
  };

  if (loading) return <p className="text-sm text-zinc-400">Loading playlist…</p>;
  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Playlists
        </button>
        <p className="text-sm text-red-400">{error ?? "Playlist not found"}</p>
      </div>
    );
  }

  const { playlist, tracks, missingTracks } = detail;
  const isBatchRunning = batchJob?.state === "running";
  const batchPct =
    batchJob && batchJob.total > 0
      ? Math.round((batchJob.completed / batchJob.total) * 100)
      : 0;
  const activeSearchingCount =
    batchJob?.items.filter((i) => i.state === "searching").length ?? 0;
  const slskdConfigured = Boolean(slskdStatus?.configured);
  const slskdReady = Boolean(slskdStatus?.configured && slskdStatus?.connected);

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Playlists
      </button>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <button
          type="button"
          onClick={() => setCoverModalOpen(true)}
          title="Change playlist cover image"
          aria-label={`Change cover image for ${playlist.name}`}
          className="group relative h-44 w-44 shrink-0 overflow-hidden rounded-2xl shadow-xl focus:outline-none focus:ring-2 focus:ring-amber-500/70"
        >
          <PlaylistCover
            playlistId={playlist.id}
            coverHash={playlist.coverHash}
            coverAlbumId={playlist.coverAlbumId}
            alt={playlist.name}
            className="h-44 w-44 rounded-2xl"
            iconClassName="h-14 w-14"
          />
          <span className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/65 text-zinc-100 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100">
            <Camera className="h-6 w-6" />
            <span className="mt-1 text-xs font-medium">Edit Cover</span>
          </span>
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium tracking-wider text-amber-400 uppercase">Playlist</p>
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-50">{playlist.name}</h2>
          {playlist.description && (
            <p className="text-sm text-zinc-400">{playlist.description}</p>
          )}
          <p className="text-sm text-zinc-500">
            {playlist.trackCount} {playlist.trackCount === 1 ? "track" : "tracks"} ·{" "}
            {formatTotalDuration(playlist.totalDurationSeconds)}
            {missingTracks.length > 0 && (
              <span className="ml-2 text-amber-400">· {missingTracks.length} missing</span>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2.5 pt-3">
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => playQueue(tracks, 0)}
              className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              <Play className="h-4 w-4 fill-current" />
              Play Playlist
            </button>

            <a
              href={getPlaylistExportUrl(playlist.id)}
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
            >
              <Download className="h-4 w-4" />
              Export .m3u8
            </a>

            <button
              type="button"
              onClick={() => void handleDeletePlaylist()}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 text-xs font-medium text-zinc-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Matched Library Tracks */}
      {tracks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center text-sm text-zinc-400">
          {missingTracks.length > 0
            ? "None of these songs are in your local library yet. Search for them on Soulseek below!"
            : "This playlist has no tracks yet. Click the playlist icon on any track in your library to add songs here."}
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
          {tracks.map((track, idx) => {
            const active = currentTrack?.id === track.id;
            return (
              <div
                key={`${track.id}-${idx}`}
                onClick={() => {
                  if (active) togglePlay();
                  else playQueue(tracks, idx);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (active) togglePlay();
                    else playQueue(tracks, idx);
                  }
                }}
                className={`group flex items-center gap-3.5 px-4 py-2.5 text-sm transition ${
                  active ? "bg-amber-500/10" : "hover:bg-zinc-800/50"
                }`}
              >
                <span className="w-6 text-center text-xs text-zinc-500">
                  {active && isPlaying ? (
                    <Pause className="mx-auto h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  ) : (
                    idx + 1
                  )}
                </span>

                <AlbumCover
                  albumId={track.albumId}
                  alt={track.albumTitle}
                  className="h-9 w-9 shrink-0 rounded-md"
                  iconClassName="h-4 w-4"
                />

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate font-medium ${
                      active ? "text-amber-400" : "text-zinc-100"
                    }`}
                  >
                    {track.title}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectArtist(track.artistId);
                    }}
                    className="block max-w-full truncate text-xs text-zinc-400 hover:underline"
                  >
                    {track.artistName}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAlbum(track.albumId);
                  }}
                  className="hidden max-w-[200px] truncate text-xs text-zinc-400 hover:underline md:block"
                >
                  {track.albumTitle}
                </button>

                <span className="hidden rounded bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-500 ring-1 ring-zinc-800 sm:inline">
                  {formatCodec(track.codec)}
                </span>

                <span className="w-12 text-right font-mono text-xs text-zinc-400">
                  {formatDuration(track.durationSeconds)}
                </span>

                <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleMove(idx, -1);
                    }}
                    title="Move up"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === tracks.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleMove(idx, 1);
                    }}
                    title="Move down"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemove(track.id);
                    }}
                    title="Remove from playlist"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Missing Tracks & Rate-Limited Soulseek Batch Search */}
      {missingTracks.length > 0 && (
        <section className="space-y-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                Missing Tracks
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                  {missingTracks.length}
                </span>
              </h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                {slskdConfigured ? (
                  <>
                    Songs from your imported playlist that aren&apos;t in your local library yet.
                    Batch search queries Soulseek politely a few tracks at a time to respect{" "}
                    <code className="text-zinc-300">slskd</code> limits.
                  </>
                ) : (
                  "Songs from your imported playlist that aren't in your local library yet."
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {slskdConfigured && (
                <>
                  <label className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-400">
                    <span>Limit:</span>
                    <select
                      value={concurrency}
                      disabled={isBatchRunning}
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                      className="bg-transparent font-medium text-zinc-100 focus:outline-none disabled:opacity-50"
                    >
                      <option value={1} className="bg-zinc-900">
                        1 at a time
                      </option>
                      <option value={2} className="bg-zinc-900">
                        2 at a time
                      </option>
                      <option value={3} className="bg-zinc-900">
                        3 at a time
                      </option>
                    </select>
                  </label>

                  {isBatchRunning ? (
                    <button
                      type="button"
                      onClick={() => void handleCancelBatchSearch()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/15 px-3.5 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/25"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      Stop Search
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!slskdReady}
                      onClick={() => void handleStartBatchSearch()}
                      title={
                        slskdReady
                          ? "Search all missing tracks on Soulseek respecting the concurrency limit"
                          : "slskd is currently unreachable"
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
                    >
                      <Search className="h-3.5 w-3.5" />
                      Search All Missing
                    </button>
                  )}

                  {foundDownloadables.length > 0 && (
                    <button
                      type="button"
                      disabled={downloadingAll}
                      onClick={() => void handleDownloadAllFound()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-45"
                    >
                      {downloadingAll ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Download All Found ({foundDownloadables.length})
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                disabled={rechecking}
                onClick={() => void handleRecheckLibrary()}
                title="Re-match missing tracks against your local library after downloading & scanning"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rechecking ? "animate-spin" : ""}`} />
                Re-check Library
              </button>
            </div>
          </div>

          {slskdConfigured && !slskdReady && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              <code>slskd</code> is configured but currently unreachable
              {slskdStatus?.error ? ` (${slskdStatus.error})` : ""}. Check that your{" "}
              <code>slskd</code> instance is running to search missing tracks.
            </div>
          )}

          {batchError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{batchError}</span>
            </div>
          )}

          {recheckNotice && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>{recheckNotice}</span>
            </div>
          )}

          {/* Batch Progress Bar */}
          {batchJob && batchJob.total > 0 && (
            <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-zinc-200">
                  {batchJob.state === "running"
                    ? `Searching Soulseek (${activeSearchingCount}/${batchJob.concurrencyLimit} active) — ${batchJob.completed} of ${batchJob.total} finished`
                    : batchJob.state === "cancelled"
                      ? `Search stopped — ${batchJob.completed} of ${batchJob.total} checked`
                      : `Search finished — ${batchJob.foundCount} found, ${batchJob.notFoundCount} no matches`}
                </span>
                <span className="font-mono text-zinc-400">{batchPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    batchJob.state === "cancelled" ? "bg-zinc-500" : "bg-amber-400"
                  }`}
                  style={{ width: `${batchPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Per-Song Missing Track Rows */}
          <div className="divide-y divide-zinc-800/60 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40">
            {missingTracks.map((mt) => {
              const jobItem = batchItemsById.get(mt.id);
              const effectiveState =
                mt.status === "queued" ? "queued" : (jobItem?.state ?? "idle");
              const candidates = jobItem?.candidates ?? [];
              const chosenIdx = selectedCandidateIdx[mt.id] ?? 0;
              const chosenCandidate = candidates[chosenIdx] ?? candidates[0] ?? null;
              const isDownloading = Boolean(downloadingIds[mt.id]);

              return (
                <div
                  key={mt.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-100">{mt.title}</p>
                    <p className="truncate text-xs text-zinc-400">
                      {mt.artist}
                      {mt.album ? ` · ${mt.album}` : ""}
                    </p>
                  </div>

                  {/* Live Per-Song Status & Inline Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {effectiveState === "pending" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400">
                        <Clock className="h-3 w-3" />
                        Waiting…
                      </span>
                    )}

                    {effectiveState === "searching" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Searching…
                      </span>
                    )}

                    {effectiveState === "found" && chosenCandidate && (
                      <>
                        <select
                          value={chosenIdx}
                          onChange={(e) =>
                            setSelectedCandidateIdx((prev) => ({
                              ...prev,
                              [mt.id]: Number(e.target.value),
                            }))
                          }
                          aria-label={`Select match for ${mt.title}`}
                          className="max-w-[260px] truncate rounded-lg border border-emerald-500/30 bg-zinc-900 px-2.5 py-1 text-xs text-emerald-200 focus:border-emerald-400 focus:outline-none"
                        >
                          {candidates.map((cand, idx) => (
                            <option
                              key={`${cand.username}-${cand.filename}-${idx}`}
                              value={idx}
                              className="bg-zinc-900 text-zinc-100"
                            >
                              {formatCandidateLabel(cand)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={isDownloading}
                          onClick={() => void handleDownloadCandidate(mt.id, chosenCandidate)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-45"
                        >
                          {isDownloading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          Download
                        </button>
                      </>
                    )}

                    {effectiveState === "queued" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Queued in slskd
                      </span>
                    )}

                    {effectiveState === "not_found" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-400">
                        No matches
                      </span>
                    )}

                    {effectiveState === "error" && (
                      <span
                        title={jobItem?.error ?? "Search error"}
                        className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-xs text-red-300"
                      >
                        <AlertCircle className="h-3 w-3" />
                        Error
                      </span>
                    )}

                    {slskdConfigured &&
                      (effectiveState === "idle" ||
                        effectiveState === "not_found" ||
                        effectiveState === "error") && (
                        <button
                          type="button"
                          disabled={!slskdReady || isBatchRunning}
                          onClick={() => void handleStartBatchSearch([mt.id])}
                          title="Search Soulseek for this track"
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
                        >
                          <Search className="h-3 w-3" />
                          Search
                        </button>
                      )}

                    <button
                      type="button"
                      onClick={() => void handleDismissMissing(mt.id)}
                      title="Dismiss from missing list"
                      aria-label={`Dismiss ${mt.title}`}
                      className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {coverModalOpen && (
        <EditPlaylistCoverModal
          playlist={playlist}
          playlistTracks={tracks}
          onClose={() => setCoverModalOpen(false)}
          onUpdated={(updated) => {
            setDetail((prev) => (prev ? { ...prev, playlist: updated } : prev));
            onPlaylistsChanged();
          }}
        />
      )}
    </div>
  );
}
