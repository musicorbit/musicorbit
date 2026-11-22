import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  ListMusic,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import type { PlaylistDetailResponse } from "@musicorbit/shared";
import {
  deletePlaylist,
  fetchPlaylistDetail,
  getPlaylistExportUrl,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
} from "../api/client";
import { AlbumCover } from "../components/AlbumCover";
import { usePlayer } from "../context/PlayerContext";
import { formatCodec, formatDuration, formatTotalDuration } from "../utils/format";

interface PlaylistDetailViewProps {
  playlistId: number;
  onBack: () => void;
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
  onPlaylistsChanged: () => void;
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
  const { currentTrack, isPlaying, playQueue, togglePlay } = usePlayer();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPlaylistDetail(playlistId);
      setDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load playlist");
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const { playlist, tracks } = detail;

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
        {playlist.coverAlbumId ? (
          <AlbumCover
            albumId={playlist.coverAlbumId}
            alt={playlist.name}
            className="h-44 w-44 shrink-0 rounded-2xl shadow-xl"
            iconClassName="h-14 w-14"
          />
        ) : (
          <div className="flex h-44 w-44 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-600 ring-1 ring-zinc-800">
            <ListMusic className="h-14 w-14" />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium tracking-wider text-amber-400 uppercase">Playlist</p>
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-50">{playlist.name}</h2>
          {playlist.description && (
            <p className="text-sm text-zinc-400">{playlist.description}</p>
          )}
          <p className="text-sm text-zinc-500">
            {playlist.trackCount} {playlist.trackCount === 1 ? "track" : "tracks"} ·{" "}
            {formatTotalDuration(playlist.totalDurationSeconds)}
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

      {tracks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center text-sm text-zinc-400">
          This playlist has no tracks yet. Click the playlist icon on any track in your library to
          add songs here.
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

                <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
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
    </div>
  );
}
