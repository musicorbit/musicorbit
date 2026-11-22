import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ListMusic, ListPlus, Pause, Pencil, Play, Sparkles } from "lucide-react";
import type { AlbumDetailResponse, TrackSummary } from "@musicorbit/shared";
import { fetchAlbumDetail, retagAlbum } from "../api/client";
import { AddToPlaylistModal } from "../components/AddToPlaylistModal";
import { AlbumCover } from "../components/AlbumCover";
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
}

export function AlbumDetailView({
  albumId,
  onBack,
  onSelectArtist,
  onAlbumRetagged,
  onPlaylistsChanged,
}: AlbumDetailViewProps) {
  const [detail, setDetail] = useState<AlbumDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retagOpen, setRetagOpen] = useState(false);
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [playlistTrack, setPlaylistTrack] = useState<TrackSummary | null>(null);
  const { currentTrack, isPlaying, playQueue, togglePlay, addToQueue } = usePlayer();

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

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

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
          </div>
        </div>
      </div>

      {/* Tracklist */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
        <div className="divide-y divide-zinc-800/60">
          {tracks.map((track, idx) => {
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
                      <span className="group-hover:hidden">
                        {track.trackNumber ?? idx + 1}
                      </span>
                      <Play className="hidden h-3.5 w-3.5 fill-zinc-100 text-zinc-100 group-hover:block" />
                    </>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate font-medium ${
                      active ? "text-amber-400" : "text-zinc-100"
                    }`}
                  >
                    {track.title}
                  </p>
                  {track.artistName !== album.artistName && (
                    <p className="truncate text-xs text-zinc-400">{track.artistName}</p>
                  )}
                </div>

                <span className="hidden rounded bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-500 ring-1 ring-zinc-800 sm:inline">
                  {formatCodec(track.codec)}
                </span>

                <span className="w-12 text-right font-mono text-xs text-zinc-400">
                  {formatDuration(track.durationSeconds)}
                </span>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTrackId(track.id);
                    }}
                    title="Edit track metadata"
                    aria-label={`Edit metadata for ${track.title}`}
                    className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-amber-300"
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
                    className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-amber-300"
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
                    className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <ListPlus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
    </div>
  );
}
