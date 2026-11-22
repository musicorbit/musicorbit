import { useState } from "react";
import {
  AlertCircle,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { formatBitrate, formatCodec, formatDuration } from "../utils/format";
import { AlbumCover } from "./AlbumCover";

interface PlayerBarProps {
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
}

export function PlayerBar({ onSelectAlbum, onSelectArtist }: PlayerBarProps) {
  const {
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    repeatMode,
    shuffle,
    canGoNext,
    canGoPrev,
    playbackError,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleRepeat,
    toggleShuffle,
    jumpToIndex,
    removeFromQueue,
    clearQueue,
  } = usePlayer();

  const [queueOpen, setQueueOpen] = useState(false);

  if (!currentTrack) {
    return null;
  }

  const maxTime = duration > 0 ? duration : currentTrack.durationSeconds ?? 0;
  const bitrateLabel = formatBitrate(currentTrack.bitrate);

  return (
    <>
      {/* Slide-over Queue Drawer */}
      {queueOpen && (
        <div className="fixed right-4 bottom-24 z-40 flex max-h-[65vh] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Play Queue</h3>
              <p className="text-xs text-zinc-500">
                {queue.length} {queue.length === 1 ? "track" : "tracks"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  clearQueue();
                  setQueueOpen(false);
                }}
                className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setQueueOpen(false)}
                aria-label="Close queue"
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 divide-y divide-zinc-800/60 overflow-y-auto">
            {queue.map((track, idx) => {
              const active = idx === currentIndex;
              return (
                <div
                  key={`${track.id}-${idx}`}
                  className={`group flex items-center gap-3 px-4 py-2.5 text-xs transition ${
                    active ? "bg-amber-500/10" : "hover:bg-zinc-800/50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => jumpToIndex(idx)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
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
                      <p className="truncate text-zinc-400">{track.artistName}</p>
                    </div>
                  </button>
                  <span className="text-zinc-500">{formatDuration(track.durationSeconds)}</span>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(idx)}
                    aria-label="Remove from queue"
                    className="rounded p-1 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fixed Bottom Player Bar */}
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800/90 bg-zinc-950/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* Track info */}
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => onSelectAlbum(currentTrack.albumId)}
              className="shrink-0 overflow-hidden rounded-lg transition hover:opacity-85"
              title={`Open album: ${currentTrack.albumTitle}`}
            >
              <AlbumCover
                albumId={currentTrack.albumId}
                alt={currentTrack.albumTitle}
                className="h-12 w-12 rounded-lg"
                iconClassName="h-5 w-5"
              />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelectAlbum(currentTrack.albumId)}
                className="block max-w-full truncate text-left text-sm font-medium text-zinc-100 hover:text-amber-400"
              >
                {currentTrack.title}
              </button>
              <button
                type="button"
                onClick={() => onSelectArtist(currentTrack.artistId)}
                className="block max-w-full truncate text-left text-xs text-zinc-400 hover:text-zinc-200"
              >
                {currentTrack.artistName} · {currentTrack.albumTitle}
              </button>
              {playbackError && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-red-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {playbackError}
                </p>
              )}
            </div>
          </div>

          {/* Transport controls & Scrubber */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleShuffle}
                aria-label="Toggle shuffle"
                title={shuffle ? "Shuffle: On" : "Shuffle: Off"}
                className={`rounded-lg p-1.5 transition ${
                  shuffle ? "text-amber-400" : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                <Shuffle className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={prev}
                disabled={!canGoPrev}
                aria-label="Previous track"
                title={canGoPrev ? "Previous track" : "No previous track"}
                className="rounded-lg p-1.5 text-zinc-300 transition hover:text-zinc-50 disabled:text-zinc-600 disabled:opacity-40 disabled:hover:text-zinc-600"
              >
                <SkipBack className="h-4 w-4 fill-current" />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-zinc-950 transition hover:bg-amber-400"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                )}
              </button>

              <button
                type="button"
                onClick={next}
                disabled={!canGoNext}
                aria-label="Next track"
                title={canGoNext ? "Next track" : "No next track"}
                className="rounded-lg p-1.5 text-zinc-300 transition hover:text-zinc-50 disabled:text-zinc-600 disabled:opacity-40 disabled:hover:text-zinc-600"
              >
                <SkipForward className="h-4 w-4 fill-current" />
              </button>

              <button
                type="button"
                onClick={toggleRepeat}
                aria-label="Toggle repeat"
                title={`Repeat: ${repeatMode}`}
                className={`rounded-lg p-1.5 transition ${
                  repeatMode !== "off" ? "text-amber-400" : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {repeatMode === "one" ? (
                  <Repeat1 className="h-4 w-4" />
                ) : (
                  <Repeat className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="flex w-full items-center gap-2.5">
              <span className="w-10 text-right font-mono text-[11px] text-zinc-400">
                {formatDuration(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={maxTime || 1}
                step={0.1}
                value={Math.min(currentTime, maxTime || 1)}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Seek position"
                className="h-1.5 flex-1 cursor-pointer accent-amber-400"
              />
              <span className="w-10 font-mono text-[11px] text-zinc-400">
                {formatDuration(maxTime)}
              </span>
            </div>
          </div>

          {/* Right controls: Codec badge, Queue, Volume */}
          <div className="hidden items-center justify-end gap-3 md:flex">
            <span className="rounded bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-400 ring-1 ring-zinc-800">
              {formatCodec(currentTrack.codec)}
              {bitrateLabel ? ` · ${bitrateLabel}` : ""}
            </span>

            <button
              type="button"
              onClick={() => setQueueOpen((o) => !o)}
              aria-label="Toggle queue"
              title="Play queue"
              className={`relative rounded-lg p-2 transition ${
                queueOpen
                  ? "bg-amber-500/15 text-amber-400"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
            >
              <ListMusic className="h-4 w-4" />
              {queue.length > 1 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-800 px-1 text-[10px] font-medium text-zinc-200 ring-1 ring-zinc-700">
                  {queue.length}
                </span>
              )}
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                className="rounded-lg p-1.5 text-zinc-400 transition hover:text-zinc-100"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1.5 w-20 cursor-pointer accent-amber-400"
              />
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
