import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ListChecks,
  ListMusic,
  ListPlus,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AlbumDetailResponse,
  AlbumReleaseOption,
  AlbumTracklistResponse,
  TrackSummary,
} from "@musicorbit/shared";
import {
  deleteAlbum,
  deleteTrack,
  fetchAlbumDetail,
  fetchAlbumTracklist,
  retagAlbum,
} from "../api/client";
import { AddToPlaylistModal } from "../components/AddToPlaylistModal";
import { AlbumCover } from "../components/AlbumCover";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { EditTrackMetadataModal } from "../components/EditTrackMetadataModal";
import { RetagAlbumModal } from "../components/RetagAlbumModal";
import { usePlayer } from "../context/PlayerContext";
import { formatCodec, formatDuration, formatTotalDuration } from "../utils/format";

interface AlbumDetailViewProps {
  albumId: number;
  onBack: () => void;
  onSelectArtist: (artistId: number) => void;
  onAlbumRetagged: () => void;
  onPlaylistsChanged?: () => void;
  slskdConfigured?: boolean;
  onSearchSoulseek?: (query: string) => void;
}

interface AlbumTracklistUiCacheEntry {
  showFullTracklist: boolean;
  data: AlbumTracklistResponse | null;
}

/**
 * Keeps full-tracklist view state & cached data in memory across route navigations
 * so jumping to Soulseek Search (or back to Albums) and returning is instantaneous.
 */
const albumTracklistUiCache = new Map<number, AlbumTracklistUiCacheEntry>();

function formatReleaseOptionLabel(rel: AlbumReleaseOption): string {
  const parts = [rel.title];
  if (rel.year) parts.push(`(${rel.year})`);
  const meta = [
    rel.trackCount > 0 ? `${rel.trackCount} ${rel.trackCount === 1 ? "track" : "tracks"}` : null,
    rel.country,
    rel.provider === "deezer" ? "Deezer" : "MusicBrainz",
  ]
    .filter(Boolean)
    .join(" · ");
  return meta ? `${parts.join(" ")} — ${meta}` : parts.join(" ");
}

export function AlbumDetailView({
  albumId,
  onBack,
  onSelectArtist,
  onAlbumRetagged,
  onPlaylistsChanged,
  slskdConfigured = false,
  onSearchSoulseek,
}: AlbumDetailViewProps) {
  const cachedUi = albumTracklistUiCache.get(albumId);
  const [detail, setDetail] = useState<AlbumDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retagOpen, setRetagOpen] = useState(false);
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [playlistTrack, setPlaylistTrack] = useState<TrackSummary | null>(null);
  const [deletingTrack, setDeletingTrack] = useState<TrackSummary | null>(null);
  const [deletingAlbum, setDeletingAlbum] = useState(false);

  // Full album tracklist lookup state (restored immediately from in-memory UI cache)
  const [showFullTracklist, setShowFullTracklist] = useState(cachedUi?.showFullTracklist ?? false);
  const [tracklist, setTracklist] = useState<AlbumTracklistResponse | null>(cachedUi?.data ?? null);
  const [tracklistLoading, setTracklistLoading] = useState(false);
  const [tracklistError, setTracklistError] = useState<string | null>(null);
  const [tracklistFilter, setTracklistFilter] = useState<"all" | "missing">("all");

  const { currentTrack, isPlaying, playQueue, togglePlay, addToQueue, removeTracksFromQueue } =
    usePlayer();

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAlbumDetail(albumId);
      setDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load album");
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  const loadFullTracklist = useCallback(
    async (options?: { releaseId?: string; refresh?: boolean; silent?: boolean }) => {
      if (!options?.silent) {
        setTracklistLoading(true);
      }
      setTracklistError(null);
      try {
        const res = await fetchAlbumTracklist(albumId, {
          releaseId: options?.releaseId,
          refresh: options?.refresh,
        });
        setTracklist(res);
        const hasTracks = res.tracks.length > 0;
        if (!hasTracks) {
          albumTracklistUiCache.set(albumId, { showFullTracklist: false, data: res });
        } else {
          const existing = albumTracklistUiCache.get(albumId);
          albumTracklistUiCache.set(albumId, {
            showFullTracklist: existing?.showFullTracklist ?? true,
            data: res,
          });
        }
      } catch (err) {
        setTracklistError(
          err instanceof Error ? err.message : "Could not fetch full album tracklist",
        );
        albumTracklistUiCache.set(albumId, { showFullTracklist: false, data: null });
      } finally {
        if (!options?.silent) {
          setTracklistLoading(false);
        }
      }
    },
    [albumId],
  );

  useEffect(() => {
    const remembered = albumTracklistUiCache.get(albumId);
    setShowFullTracklist(remembered?.showFullTracklist ?? false);
    setTracklist(remembered?.data ?? null);
    setTracklistError(null);
    setTracklistFilter("all");
    void loadDetail();
    // If Full Tracklist was open for this album, quietly sync ownership against the instant SQLite cache
    if (remembered?.showFullTracklist) {
      void loadFullTracklist({ silent: Boolean(remembered.data) });
    }
  }, [albumId, loadDetail, loadFullTracklist]);

  const isFullTracklistShown =
    showFullTracklist && !tracklistError && Boolean(tracklist && tracklist.tracks.length > 0);

  const handleToggleFullTracklist = () => {
    if (isFullTracklistShown) {
      setShowFullTracklist(false);
      albumTracklistUiCache.set(albumId, { showFullTracklist: false, data: tracklist });
      return;
    }
    setShowFullTracklist(true);
    if (!tracklist || tracklistError || tracklist.tracks.length === 0) {
      if (!tracklistLoading) {
        void loadFullTracklist({ refresh: Boolean(tracklistError) });
      }
    } else {
      albumTracklistUiCache.set(albumId, { showFullTracklist: true, data: tracklist });
      // Quietly refresh ownership against the fast SQLite cache in case new tracks were scanned
      void loadFullTracklist({ silent: true });
    }
  };

  const ownedTracksById = useMemo(() => {
    const map = new Map<number, { track: TrackSummary; index: number }>();
    (detail?.tracks ?? []).forEach((track, index) => {
      map.set(track.id, { track, index });
    });
    return map;
  }, [detail?.tracks]);

  const unmatchedOwnedTracks = useMemo(() => {
    if (!detail || !tracklist || tracklist.tracks.length === 0) return [];
    const matchedIds = new Set(
      tracklist.tracks.map((t) => t.ownedTrackId).filter((id): id is number => id !== null),
    );
    return detail.tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => !matchedIds.has(track.id));
  }, [detail, tracklist]);

  if (loading) {
    return <p className="text-sm text-zinc-400">Loading album…</p>;
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="text-sm text-red-400">{error ?? "Album not found"}</p>
      </div>
    );
  }

  const { album, tracks } = detail;
  const isAlbumActive = currentTrack?.albumId === album.id;

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Albums
      </button>

      {/* Album Hero */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <AlbumCover
          albumId={album.id}
          coverHash={album.coverHash}
          alt={album.title}
          className="h-48 w-48 shrink-0 rounded-2xl shadow-xl"
          iconClassName="h-16 w-16"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium tracking-wider text-amber-400 uppercase">Album</p>
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-50">{album.title}</h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
            <button
              type="button"
              onClick={() => onSelectArtist(album.artistId)}
              className="font-medium text-zinc-200 hover:text-amber-300 hover:underline"
            >
              {album.artistName}
            </button>
            {album.year != null && album.year > 0 && <span>· {album.year}</span>}
            {album.genre && <span>· {album.genre}</span>}
            <span>
              · {album.trackCount} {album.trackCount === 1 ? "track" : "tracks"}
            </span>
            <span>· {formatTotalDuration(album.totalDurationSeconds)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-3">
            <button
              type="button"
              onClick={() => {
                if (isAlbumActive) {
                  togglePlay();
                } else {
                  playQueue(tracks, 0);
                }
              }}
              disabled={tracks.length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              {isAlbumActive && isPlaying ? (
                <>
                  <Pause className="h-4 w-4 fill-current" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  Play Album
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setRetagOpen(true)}
              disabled={tracks.length === 0}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              Fix Tags
            </button>

            <button
              type="button"
              onClick={handleToggleFullTracklist}
              disabled={tracklistLoading}
              aria-pressed={isFullTracklistShown}
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition disabled:opacity-70 ${
                isFullTracklistShown
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/20"
                  : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              {tracklistLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              ) : (
                <ListChecks className="h-4 w-4 text-amber-400" />
              )}
              {tracklistLoading
                ? "Loading Tracklist…"
                : isFullTracklistShown
                  ? "Showing Full Tracklist"
                  : "Full Tracklist"}
            </button>

            <button
              type="button"
              onClick={() => setDeletingAlbum(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" />
              Delete Album
            </button>
          </div>
        </div>
      </div>

      {/* Full Tracklist Completeness Header */}
      {showFullTracklist && (
        <section className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-4">
          {tracklistLoading && !tracklist ? (
            <div className="flex items-center gap-2.5 py-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              Looking up full tracklist on Deezer &amp; MusicBrainz…
            </div>
          ) : tracklistError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{tracklistError}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  void loadFullTracklist({
                    releaseId: tracklist?.selectedRelease?.id,
                    refresh: true,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            </div>
          ) : tracklist && tracklist.tracks.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  {tracklist.missingCount === 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Complete · {tracklist.ownedCount} of {tracklist.tracks.length} tracks in
                      library
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30">
                      {tracklist.ownedCount} of {tracklist.tracks.length} in library ·{" "}
                      {tracklist.missingCount} missing
                    </span>
                  )}

                  {tracklist.missingCount > 0 && (
                    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setTracklistFilter("all")}
                        className={`rounded-md px-2.5 py-1 font-medium transition ${
                          tracklistFilter === "all"
                            ? "bg-zinc-800 text-zinc-100"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        All ({tracklist.tracks.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTracklistFilter("missing")}
                        className={`rounded-md px-2.5 py-1 font-medium transition ${
                          tracklistFilter === "missing"
                            ? "bg-zinc-800 text-amber-300"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Missing ({tracklist.missingCount})
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {tracklist.releases.length > 1 && (
                    <label className="flex items-center gap-1.5 text-xs text-zinc-200">
                      <span className="sr-only">Album edition</span>
                      <select
                        value={tracklist.selectedRelease?.id ?? ""}
                        disabled={tracklistLoading}
                        onChange={(e) => void loadFullTracklist({ releaseId: e.target.value })}
                        aria-label="Select album edition"
                        className="max-w-xs truncate rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
                      >
                        {tracklist.releases.map((rel) => (
                          <option
                            key={rel.id}
                            value={rel.id}
                            className="bg-zinc-900 text-zinc-100"
                          >
                            {formatReleaseOptionLabel(rel)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <button
                    type="button"
                    disabled={tracklistLoading}
                    onClick={() => void loadFullTracklist({ refresh: true })}
                    title="Refresh tracklist from Deezer & MusicBrainz"
                    aria-label="Refresh tracklist from Deezer and MusicBrainz"
                    className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-45"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${tracklistLoading ? "animate-spin" : ""}`} />
                  </button>

                  {slskdConfigured && onSearchSoulseek && tracklist.missingCount > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        onSearchSoulseek(
                          `${album.artistName} ${tracklist.selectedRelease?.title ?? album.title}`,
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
                    >
                      <Search className="h-3.5 w-3.5" />
                      Find Album on Soulseek
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    tracklist.missingCount === 0 ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                  style={{
                    width: `${Math.round((tracklist.ownedCount / Math.max(1, tracklist.tracks.length)) * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
              <span>
                No matching full tracklist was found on Deezer or MusicBrainz for{" "}
                <strong className="text-zinc-200">{album.title}</strong>.
              </span>
              <button
                type="button"
                onClick={() => void loadFullTracklist()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
              >
                <RefreshCw className="h-3 w-3" />
                Try Again
              </button>
            </div>
          )}
        </section>
      )}

      {/* Tracklist */}
      {(() => {
        const renderOwnedTrackRow = (
          track: TrackSummary,
          idx: number,
          displayTrackNumber?: number,
          showInLibraryBadge = false,
        ) => {
          const active = currentTrack?.id === track.id;
          return (
            <div
              key={track.id}
              onClick={() => {
                if (active) {
                  togglePlay();
                } else {
                  playQueue(tracks, idx);
                }
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
              className={`group flex items-center gap-4 px-4 py-3 text-sm transition ${
                active ? "bg-amber-500/10" : "hover:bg-zinc-800/50"
              }`}
            >
              <div className="flex w-7 shrink-0 items-center justify-center text-xs text-zinc-500">
                {active && isPlaying ? (
                  <Pause className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                ) : (
                  <>
                    <span className="group-hover:hidden group-focus-within:hidden">
                      {displayTrackNumber ?? track.trackNumber ?? idx + 1}
                    </span>
                    <Play className="hidden h-3.5 w-3.5 fill-zinc-100 text-zinc-100 group-hover:block group-focus-within:block" />
                  </>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className={`truncate font-medium ${active ? "text-amber-400" : "text-zinc-100"}`}
                >
                  {track.title}
                </p>
                {track.artistName !== album.artistName && (
                  <p className="truncate text-xs text-zinc-400">{track.artistName}</p>
                )}
              </div>

              {showInLibraryBadge && (
                <span className="hidden items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/25 md:inline-flex">
                  <CheckCircle2 className="h-3 w-3" />
                  In Library
                </span>
              )}

              <span className="hidden rounded bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-500 ring-1 ring-zinc-800 sm:inline">
                {formatCodec(track.codec)}
              </span>

              <span className="hidden w-12 text-right font-mono text-xs text-zinc-400 sm:inline">
                {formatDuration(track.durationSeconds)}
              </span>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingTrackId(track.id);
                  }}
                  title="Edit track metadata"
                  aria-label={`Edit metadata for ${track.title}`}
                  className="rounded-lg p-1.5 text-zinc-400 opacity-100 transition hover:bg-zinc-800 hover:text-amber-300 lg:text-zinc-500 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:focus-visible:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPlaylistTrack(track);
                  }}
                  title="Add to playlist"
                  aria-label={`Add ${track.title} to playlist`}
                  className="rounded-lg p-1.5 text-zinc-400 opacity-100 transition hover:bg-zinc-800 hover:text-amber-300 lg:text-zinc-500 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:focus-visible:opacity-100"
                >
                  <ListMusic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    addToQueue(track);
                  }}
                  title="Add to queue"
                  aria-label={`Add ${track.title} to queue`}
                  className="rounded-lg p-1.5 text-zinc-400 opacity-100 transition hover:bg-zinc-800 hover:text-zinc-100 lg:text-zinc-500 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:focus-visible:opacity-100"
                >
                  <ListPlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingTrack(track);
                  }}
                  title="Delete song permanently"
                  aria-label={`Delete ${track.title}`}
                  className="rounded-lg p-1.5 text-zinc-400 opacity-100 transition hover:bg-red-500/15 hover:text-red-400 lg:text-zinc-500 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:focus-visible:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        };

        if (showFullTracklist && tracklist && tracklist.tracks.length > 0) {
          const visibleRows =
            tracklistFilter === "missing"
              ? tracklist.tracks.filter((t) => t.ownedTrackId === null)
              : tracklist.tracks;
          const discNumbers = new Set(visibleRows.map((t) => t.discNumber));
          const hasMultipleDiscs = discNumbers.size > 1;
          let lastDisc: number | null = null;

          return (
            <div className="space-y-5">
              <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
                <div className="divide-y divide-zinc-800/60">
                  {visibleRows.map((exp, rowIdx) => {
                    const discHeader =
                      hasMultipleDiscs && exp.discNumber !== lastDisc ? (
                        <div
                          key={`disc-${exp.discNumber}`}
                          className="bg-zinc-950/70 px-4 py-2 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase"
                        >
                          Disc {exp.discNumber}
                        </div>
                      ) : null;
                    lastDisc = exp.discNumber;

                    const ownedMatch =
                      exp.ownedTrackId !== null ? ownedTracksById.get(exp.ownedTrackId) : undefined;

                    if (ownedMatch) {
                      return (
                        <div key={`exp-${exp.discNumber}-${exp.trackNumber}-${rowIdx}`}>
                          {discHeader}
                          {renderOwnedTrackRow(
                            ownedMatch.track,
                            ownedMatch.index,
                            exp.trackNumber,
                            true,
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={`exp-${exp.discNumber}-${exp.trackNumber}-${rowIdx}`}>
                        {discHeader}
                        <div className="flex items-center gap-4 bg-zinc-950/35 px-4 py-3 text-sm text-zinc-500">
                          <div className="flex w-7 shrink-0 items-center justify-center text-xs text-zinc-600">
                            {exp.trackNumber}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-zinc-400">{exp.title}</p>
                            {exp.artist && exp.artist !== album.artistName && (
                              <p className="truncate text-xs text-zinc-500">{exp.artist}</p>
                            )}
                          </div>

                          <span className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                            Missing
                          </span>

                          <span className="w-12 text-right font-mono text-xs text-zinc-600">
                            {formatDuration(exp.durationSeconds)}
                          </span>

                          {slskdConfigured && onSearchSoulseek && (
                            <button
                              type="button"
                              onClick={() =>
                                onSearchSoulseek(`${exp.artist || album.artistName} ${exp.title}`)
                              }
                              title={`Search Soulseek for "${exp.title}"`}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300"
                            >
                              <Search className="h-3 w-3" />
                              Search
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {unmatchedOwnedTracks.length > 0 && tracklistFilter === "all" && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                    Additional tracks in your library ({unmatchedOwnedTracks.length})
                  </h3>
                  <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
                    <div className="divide-y divide-zinc-800/60">
                      {unmatchedOwnedTracks.map(({ track, index }) =>
                        renderOwnedTrackRow(track, index, undefined, true),
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        }

        return (
          <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
            <div className="divide-y divide-zinc-800/60">
              {tracks.map((track, idx) => renderOwnedTrackRow(track, idx))}
            </div>
          </div>
        );
      })()}

      {retagOpen && (
        <RetagAlbumModal
          mode="retag"
          heading={`Fix Tags — ${album.title}`}
          subheading={`${album.artistName} · ${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`}
          initialArtist={album.artistName}
          initialAlbum={album.title}
          initialYear={album.year && album.year > 0 ? album.year : null}
          initialGenre={album.genre}
          initialTracks={tracks.map((t, idx) => ({
            filePath: t.filePath,
            basename: t.filePath.split(/[\\/]/).pop() ?? t.title,
            title: t.title,
            artist: t.artistName,
            trackNumber: t.trackNumber ?? idx + 1,
            discNumber: t.discNumber ?? 1,
          }))}
          onClose={() => setRetagOpen(false)}
          onSubmit={async (payload) => {
            await retagAlbum(album.id, payload);
            onAlbumRetagged();
            // If album title/artist changed, a new album row may exist; return to Albums cleanly
            if (
              payload.album.trim() !== album.title ||
              payload.artist.trim() !== album.artistName
            ) {
              onBack();
            } else {
              await loadDetail();
              albumTracklistUiCache.delete(album.id);
              if (showFullTracklist) {
                void loadFullTracklist({ refresh: true });
              } else {
                setTracklist(null);
              }
            }
          }}
        />
      )}

      {editingTrackId !== null && (
        <EditTrackMetadataModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
          onSaved={() => {
            onAlbumRetagged();
            void loadDetail();
            if (showFullTracklist) {
              void loadFullTracklist({
                releaseId: tracklist?.selectedRelease?.id,
                silent: true,
              });
            } else {
              albumTracklistUiCache.delete(album.id);
              setTracklist(null);
            }
          }}
        />
      )}

      {playlistTrack && (
        <AddToPlaylistModal
          track={playlistTrack}
          onClose={() => setPlaylistTrack(null)}
          onChanged={() => onPlaylistsChanged?.()}
        />
      )}

      {deletingTrack && (
        <ConfirmDeleteModal
          title={`Delete "${deletingTrack.title}"?`}
          subtitle={`${deletingTrack.artistName} · ${album.title}`}
          description="Removes this song from your library, any playlists that include it, and cleans up empty folders automatically."
          confirmLabel="Delete Song"
          onClose={() => setDeletingTrack(null)}
          onConfirm={async () => {
            const res = await deleteTrack(deletingTrack.id);
            removeTracksFromQueue(res.deletedTrackIds);
            onAlbumRetagged();
            onPlaylistsChanged?.();
            if (res.albumRemoved) {
              albumTracklistUiCache.delete(album.id);
              onBack();
            } else {
              await loadDetail();
              if (showFullTracklist) {
                void loadFullTracklist({
                  releaseId: tracklist?.selectedRelease?.id,
                  silent: true,
                });
              } else {
                albumTracklistUiCache.delete(album.id);
                setTracklist(null);
              }
            }
          }}
        />
      )}

      {deletingAlbum && (
        <ConfirmDeleteModal
          title={`Delete album "${album.title}"?`}
          subtitle={`${album.artistName} · ${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`}
          description={`Permanently deletes all ${tracks.length} ${tracks.length === 1 ? "song" : "songs"} in this album from your library, playlists, and disk, and removes empty folders.`}
          confirmLabel={`Delete Album (${tracks.length})`}
          onClose={() => setDeletingAlbum(false)}
          onConfirm={async () => {
            const res = await deleteAlbum(album.id);
            removeTracksFromQueue(res.deletedTrackIds);
            albumTracklistUiCache.delete(album.id);
            onAlbumRetagged();
            onPlaylistsChanged?.();
            onBack();
          }}
        />
      )}
    </div>
  );
}
