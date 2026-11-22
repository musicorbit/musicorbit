import { useState } from "react";
import { ListMusic, ListPlus, Music, Pause, Pencil, Play } from "lucide-react";
import type { TrackSummary } from "@musicorbit/shared";
import { AddToPlaylistModal } from "../components/AddToPlaylistModal";
import { AlbumCover } from "../components/AlbumCover";
import { EditTrackMetadataModal } from "../components/EditTrackMetadataModal";
import { usePlayer } from "../context/PlayerContext";
import { formatCodec, formatDuration } from "../utils/format";

interface TracksViewProps {
  tracks: TrackSummary[];
  loading: boolean;
  searchQuery: string;
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
  onGoToScanner: () => void;
  onTrackMetadataSaved?: () => void;
  onPlaylistsChanged?: () => void;
}

export function TracksView({
  tracks,
  loading,
  searchQuery,
  onSelectAlbum,
  onSelectArtist,
  onGoToScanner,
  onTrackMetadataSaved,
  onPlaylistsChanged,
}: TracksViewProps) {
  const { currentTrack, isPlaying, playQueue, togglePlay, addToQueue } = usePlayer();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [playlistTrack, setPlaylistTrack] = useState<TrackSummary | null>(null);

  if (loading && tracks.length === 0) {
    return <p className="text-sm text-zinc-400">Loading tracks…</p>;
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800">
          <Music className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-medium text-zinc-200">
          {searchQuery ? `No tracks matching "${searchQuery}"` : "No tracks indexed yet"}
        </h3>
        {!searchQuery && (
          <button
            type="button"
            onClick={onGoToScanner}
            className="mt-5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-amber-400"
          >
            Go to Library Scanner
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
      <div className="divide-y divide-zinc-800/60">
        {tracks.map((track, idx) => {
          const active = currentTrack?.id === track.id;
          return (
            <div
              key={track.id}
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
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md">
                <AlbumCover
                  albumId={track.albumId}
                  alt={track.albumTitle}
                  className="h-10 w-10 rounded-md"
                  iconClassName="h-4 w-4"
                />
                <div
                  className={`absolute inset-0 flex items-center justify-center bg-zinc-950/60 transition ${
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {active && isPlaying ? (
                    <Pause className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ) : (
                    <Play className="ml-0.5 h-4 w-4 fill-zinc-100 text-zinc-100" />
                  )}
                </div>
              </div>

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
                  className="block max-w-full truncate text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
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
                className="hidden max-w-[220px] truncate text-xs text-zinc-400 hover:text-zinc-200 hover:underline md:block"
              >
                {track.albumTitle}
              </button>

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
                  title="Edit metadata"
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

      {editingTrackId !== null && (
        <EditTrackMetadataModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
          onSaved={() => onTrackMetadataSaved?.()}
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
