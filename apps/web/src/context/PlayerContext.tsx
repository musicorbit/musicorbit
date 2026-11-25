import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TrackSummary } from "@musicorbit/shared";
import { getTrackStreamUrl } from "../api/client";

export type RepeatMode = "off" | "all" | "one";

interface PlayerContextValue {
  queue: TrackSummary[];
  currentIndex: number;
  currentTrack: TrackSummary | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  canGoNext: boolean;
  canGoPrev: boolean;
  playbackError: string | null;
  playQueue: (tracks: TrackSummary[], startIndex?: number) => void;
  playTrack: (track: TrackSummary, contextTracks?: TrackSummary[]) => void;
  addToQueue: (track: TrackSummary) => void;
  removeFromQueue: (index: number) => void;
  removeTracksFromQueue: (trackIds: number[]) => void;
  jumpToIndex: (index: number) => void;
  clearQueue: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<TrackSummary[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const currentTrack =
    currentIndex >= 0 && currentIndex < queue.length ? (queue[currentIndex] ?? null) : null;

  const canGoNext =
    queue.length > 0 &&
    (currentIndex < queue.length - 1 ||
      repeatMode === "all" ||
      (shuffle && queue.length > 1));

  const canGoPrev = queue.length > 0 && (currentIndex > 0 || repeatMode === "all");

  // Keep refs of latest queue/index/modes for audio event listeners
  const stateRef = useRef({ queue, currentIndex, repeatMode, shuffle });
  stateRef.current = { queue, currentIndex, repeatMode, shuffle };

  const loadAndPlay = useCallback((track: TrackSummary) => {
    const audio = audioRef.current;
    if (!audio) return;
    setPlaybackError(null);
    setCurrentTime(0);
    setDuration(track.durationSeconds ?? 0);
    audio.src = getTrackStreamUrl(track.id);
    audio.load();
    void audio.play().catch((err: unknown) => {
      // Autoplay or codec issues surface cleanly in the player bar
      const msg = err instanceof Error ? err.message : "Playback could not start";
      setPlaybackError(msg);
      setIsPlaying(false);
    });
  }, []);

  const playQueue = useCallback(
    (tracks: TrackSummary[], startIndex = 0) => {
      if (tracks.length === 0) return;
      const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const track = tracks[safeIndex];
      if (!track) return;
      setQueue(tracks);
      setCurrentIndex(safeIndex);
      loadAndPlay(track);
    },
    [loadAndPlay],
  );

  const playTrack = useCallback(
    (track: TrackSummary, contextTracks?: TrackSummary[]) => {
      if (contextTracks && contextTracks.length > 0) {
        const idx = contextTracks.findIndex((t) => t.id === track.id);
        if (idx >= 0) {
          playQueue(contextTracks, idx);
          return;
        }
      }
      playQueue([track], 0);
    },
    [playQueue],
  );

  const addToQueue = useCallback((track: TrackSummary) => {
    setQueue((prev) => [...prev, track]);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const nextQueue = [...prev.slice(0, index), ...prev.slice(index + 1)];
      setCurrentIndex((cur) => {
        if (nextQueue.length === 0) {
          audioRef.current?.pause();
          setIsPlaying(false);
          return -1;
        }
        if (index < cur) return cur - 1;
        if (index === cur) {
          const replacementIdx = Math.min(cur, nextQueue.length - 1);
          const replacement = nextQueue[replacementIdx];
          if (replacement) {
            queueMicrotask(() => loadAndPlay(replacement));
          }
          return replacementIdx;
        }
        return cur;
      });
      return nextQueue;
    });
  }, [loadAndPlay]);

  const removeTracksFromQueue = useCallback(
    (trackIds: number[]) => {
      if (trackIds.length === 0) return;
      const toRemove = new Set(trackIds);
      const { queue: prevQueue, currentIndex: prevIdx } = stateRef.current;
      if (!prevQueue.some((t) => toRemove.has(t.id))) return;

      const nextQueue = prevQueue.filter((t) => !toRemove.has(t.id));
      const currentRemoved =
        prevIdx >= 0 && prevIdx < prevQueue.length && toRemove.has(prevQueue[prevIdx]!.id);

      if (nextQueue.length === 0) {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        setQueue([]);
        setCurrentIndex(-1);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setPlaybackError(null);
        return;
      }

      if (currentRemoved) {
        const removedBefore = prevQueue
          .slice(0, prevIdx)
          .filter((t) => toRemove.has(t.id)).length;
        const nextIdx = Math.min(prevIdx - removedBefore, nextQueue.length - 1);
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        setQueue(nextQueue);
        setCurrentIndex(nextIdx);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(nextQueue[nextIdx]?.durationSeconds ?? 0);
        setPlaybackError(null);
      } else {
        const removedBefore =
          prevIdx >= 0 ? prevQueue.slice(0, prevIdx).filter((t) => toRemove.has(t.id)).length : 0;
        setQueue(nextQueue);
        if (prevIdx >= 0) {
          setCurrentIndex(prevIdx - removedBefore);
        }
      }
    },
    [],
  );

  const jumpToIndex = useCallback(
    (index: number) => {
      const target = stateRef.current.queue[index];
      if (!target) return;
      setCurrentIndex(index);
      loadAndPlay(target);
    },
    [loadAndPlay],
  );

  const clearQueue = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setQueue([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackError(null);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.paused) {
      setPlaybackError(null);
      void audio.play().catch((err: unknown) => {
        setPlaybackError(err instanceof Error ? err.message : "Playback failed");
      });
    } else {
      audio.pause();
    }
  }, [currentTrack]);

  const next = useCallback(() => {
    const { queue: q, currentIndex: idx, repeatMode: rep, shuffle: shuf } = stateRef.current;
    if (q.length === 0) return;

    if (shuf && q.length > 1) {
      let randomIdx = idx;
      while (randomIdx === idx) {
        randomIdx = Math.floor(Math.random() * q.length);
      }
      const nextTrack = q[randomIdx];
      if (nextTrack) {
        setCurrentIndex(randomIdx);
        loadAndPlay(nextTrack);
      }
      return;
    }

    const nextIdx = idx + 1;
    if (nextIdx < q.length) {
      const nextTrack = q[nextIdx];
      if (nextTrack) {
        setCurrentIndex(nextIdx);
        loadAndPlay(nextTrack);
      }
    } else if (rep === "all") {
      const firstTrack = q[0];
      if (firstTrack) {
        setCurrentIndex(0);
        loadAndPlay(firstTrack);
      }
    }
    // No next track available: leave current playback state untouched
  }, [loadAndPlay]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    const { queue: q, currentIndex: idx, repeatMode: rep } = stateRef.current;
    if (q.length === 0) return;

    // Standard player behavior: if more than 3s into a track, restart it instead of skipping back
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    if (idx > 0) {
      const prevTrack = q[idx - 1];
      if (prevTrack) {
        setCurrentIndex(idx - 1);
        loadAndPlay(prevTrack);
      }
    } else if (rep === "all") {
      const lastTrack = q[q.length - 1];
      if (lastTrack) {
        setCurrentIndex(q.length - 1);
        loadAndPlay(lastTrack);
      }
    }
  }, [loadAndPlay]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
    setCurrentTime(audio.currentTime);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (clamped > 0) setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((m) => !m);
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => !s);
  }, []);

  // Sync volume & mute to the hidden <audio> element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  // Wire OS/hardware media keys via the Media Session API
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artistName,
      album: currentTrack.albumTitle,
      artwork: [
        {
          src: `/api/albums/${currentTrack.albumId}/cover`,
          sizes: "512x512",
        },
      ],
    });
    navigator.mediaSession.setActionHandler("play", () => togglePlay());
    navigator.mediaSession.setActionHandler("pause", () => togglePlay());
    navigator.mediaSession.setActionHandler("previoustrack", canGoPrev ? () => prev() : null);
    navigator.mediaSession.setActionHandler("nexttrack", canGoNext ? () => next() : null);
  }, [currentTrack, togglePlay, prev, next, canGoPrev, canGoNext]);

  // Spacebar toggles play/pause when not typing in an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !currentTrack) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "BUTTON" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentTrack, togglePlay]);

  return (
    <PlayerContext.Provider
      value={{
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
        playQueue,
        playTrack,
        addToQueue,
        removeFromQueue,
        removeTracksFromQueue,
        jumpToIndex,
        clearQueue,
        togglePlay,
        next,
        prev,
        seek,
        setVolume,
        toggleMute,
        toggleRepeat,
        toggleShuffle,
      }}
    >
      {children}
      {/* Single persistent HTML5 audio element lives above all views so route changes never interrupt playback */}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onEnded={() => {
          const { queue: q, currentIndex: idx, repeatMode: rep, shuffle: shuf } = stateRef.current;
          if (rep === "one" && audioRef.current) {
            audioRef.current.currentTime = 0;
            void audioRef.current.play();
          } else if (idx < q.length - 1 || rep === "all" || (shuf && q.length > 1)) {
            next();
          } else {
            setIsPlaying(false);
          }
        }}
        onError={() => {
          setPlaybackError("Browser could not decode or load this audio file.");
          setIsPlaying(false);
        }}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayer must be used inside PlayerProvider");
  }
  return ctx;
}
