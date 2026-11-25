import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Mic2,
  Minus,
  Music,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import type { TrackLyricsResponse, TrackSummary } from "@musicorbit/shared";
import { fetchTrackLyrics } from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";
import { AlbumCover } from "./AlbumCover";

interface LyricsOverlayProps {
  track: TrackSummary;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
}

function formatSourceBadge(lyrics: TrackLyricsResponse): string {
  if (lyrics.instrumental) return "Instrumental";
  if (lyrics.hasSynced) {
    if (lyrics.source === "sidecar") return "Synced · .lrc";
    if (lyrics.source === "embedded") return "Synced · Embedded";
    return "Synced · LRCLIB";
  }
  if (lyrics.hasPlain) return "Unsynced lyrics";
  return "No lyrics found";
}

export function LyricsOverlay({
  track,
  currentTime,
  isPlaying,
  onSeek,
  onClose,
  onSelectAlbum,
  onSelectArtist,
}: LyricsOverlayProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resumeTimerRef = useRef<number | null>(null);

  const [lyrics, setLyrics] = useState<TrackLyricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timingOffset, setTimingOffset] = useState(0);
  const [userScrolling, setUserScrolling] = useState(false);

  useModalAccessibility(dialogRef, onClose);

  const loadLyrics = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetchTrackLyrics(track.id, refresh);
        setLyrics(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load lyrics");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [track.id],
  );

  // Fetch lyrics automatically whenever the currently playing track changes
  useEffect(() => {
    setTimingOffset(0);
    setUserScrolling(false);
    lineRefs.current = [];
    void loadLyrics(false);
  }, [track.id, loadLyrics]);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) {
        window.clearTimeout(resumeTimerRef.current);
      }
    };
  }, []);

  const syncedLines = lyrics?.syncedLines ?? [];

  // Determine active lyric line based on currentTime + user timing nudge
  const activeLineIndex = useMemo(() => {
    if (syncedLines.length === 0) return -1;
    const adjusted = currentTime + timingOffset;
    let active = -1;
    for (let i = 0; i < syncedLines.length; i++) {
      if (syncedLines[i]!.timeSeconds <= adjusted) {
        active = i;
      } else {
        break;
      }
    }
    return active;
  }, [syncedLines, currentTime, timingOffset]);

  // Smoothly center the active lyric line as the song progresses
  useEffect(() => {
    if (userScrolling || activeLineIndex < 0) return;
    const el = lineRefs.current[activeLineIndex];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLineIndex, userScrolling]);

  const handleManualScroll = () => {
    if (!lyrics?.hasSynced) return;
    setUserScrolling(true);
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      setUserScrolling(false);
    }, 5000);
  };

  const handleSyncToCurrentLine = () => {
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
    }
    setUserScrolling(false);
    if (activeLineIndex >= 0) {
      lineRefs.current[activeLineIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const adjustOffset = (delta: number) => {
    setTimingOffset((prev) => Math.round((prev + delta) * 10) / 10);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Lyrics for ${track.title}`}
      tabIndex={-1}
      className="fixed inset-x-0 top-0 bottom-20 z-30 flex flex-col overflow-hidden bg-zinc-950/96 backdrop-blur-2xl focus:outline-none"
    >
      {/* Ambient blurred album cover backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={`/api/albums/${track.albumId}/cover`}
          alt=""
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
          className="h-full w-full scale-110 object-cover opacity-20 blur-3xl saturate-150"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/85 via-zinc-950/75 to-zinc-950/95" />
      </div>

      {/* Top Header */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/70 px-6 py-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <AlbumCover
            albumId={track.albumId}
            alt={track.albumTitle}
            className="h-11 w-11 shrink-0 rounded-lg shadow-lg"
            iconClassName="h-5 w-5"
          />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-zinc-50">{track.title}</h2>
            <p className="truncate text-xs text-zinc-400">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSelectArtist(track.artistId);
                }}
                className="hover:text-amber-300 hover:underline"
              >
                {track.artistName}
              </button>
              {" · "}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSelectAlbum(track.albumId);
                }}
                className="hover:text-amber-300 hover:underline"
              >
                {track.albumTitle}
              </button>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {lyrics && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                lyrics.hasSynced
                  ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                  : lyrics.instrumental
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                    : "bg-zinc-800/90 text-zinc-300"
              }`}
            >
              {formatSourceBadge(lyrics)}
            </span>
          )}

          {/* Timing Offset Nudge (synced lyrics only) */}
          {lyrics?.hasSynced && (
            <div className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 text-xs">
              <button
                type="button"
                onClick={() => adjustOffset(-0.5)}
                title="Delay lyrics by 0.5s"
                aria-label="Delay lyrics by 0.5 seconds"
                className="px-2 py-1.5 text-zinc-400 transition hover:text-zinc-100"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setTimingOffset(0)}
                title="Reset timing offset"
                className="px-1.5 py-1 font-mono text-[11px] text-zinc-300 hover:text-amber-300"
              >
                {timingOffset === 0
                  ? "Sync"
                  : `${timingOffset > 0 ? "+" : ""}${timingOffset.toFixed(1)}s`}
              </button>
              <button
                type="button"
                onClick={() => adjustOffset(0.5)}
                title="Advance lyrics by 0.5s"
                aria-label="Advance lyrics by 0.5 seconds"
                className="px-2 py-1.5 text-zinc-400 transition hover:text-zinc-100"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={loading || refreshing}
            onClick={() => void loadLyrics(true)}
            title="Re-fetch lyrics from LRCLIB"
            aria-label="Re-fetch lyrics from LRCLIB"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-45"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
            <span className="hidden sm:inline">Re-fetch</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close lyrics"
            className="rounded-lg border border-zinc-800 bg-zinc-900/90 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Sing-Along Lyrics Stage */}
      <div
        onWheel={handleManualScroll}
        onTouchMove={handleManualScroll}
        className="relative z-10 flex-1 overflow-y-auto px-6 py-10 sm:px-12"
      >
        <div className="mx-auto max-w-3xl">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-28 text-sm text-zinc-400">
              <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
              <p>Loading lyrics for {track.title}…</p>
            </div>
          ) : error ? (
            <div className="mx-auto my-20 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-200">
              <AlertCircle className="h-6 w-6 text-red-400" />
              <p>{error}</p>
              <button
                type="button"
                onClick={() => void loadLyrics(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Try Again
              </button>
            </div>
          ) : lyrics?.hasSynced ? (
            <div className="space-y-4 py-[18vh]">
              {/* Intro indicator before the first sung lyric */}
              {activeLineIndex === -1 && (syncedLines[0]?.timeSeconds ?? 0) > 1.5 && (
                <div className="flex items-center gap-2 pl-4 text-lg font-medium text-amber-400/80">
                  <span className={isPlaying ? "animate-pulse" : ""}>♪ ♪ ♪</span>
                </div>
              )}

              {syncedLines.map((line, idx) => {
                const isActive = idx === activeLineIndex;
                const isPast = activeLineIndex >= 0 && idx < activeLineIndex;

                return (
                  <button
                    key={`${line.timeSeconds}-${idx}`}
                    ref={(el) => {
                      lineRefs.current[idx] = el;
                    }}
                    type="button"
                    onClick={() => {
                      onSeek(Math.max(0, line.timeSeconds - timingOffset));
                      setUserScrolling(false);
                    }}
                    className={`block w-full rounded-xl border-l-4 px-4 py-2.5 text-left text-2xl leading-snug font-bold tracking-tight transition-colors duration-300 sm:text-3xl ${
                      isActive
                        ? "border-amber-400 bg-amber-500/10 text-zinc-50"
                        : isPast
                          ? "border-transparent text-zinc-500/50 hover:bg-zinc-900/40 hover:text-zinc-300"
                          : "border-transparent text-zinc-400/75 hover:bg-zinc-900/40 hover:text-zinc-100"
                    }`}
                  >
                    {line.text ? (
                      <span
                        className={`block origin-left pr-4 transition-transform duration-300 ${
                          isActive ? "scale-[1.02]" : "scale-100"
                        }`}
                      >
                        {line.text}
                      </span>
                    ) : (
                      <span className="text-base tracking-widest text-amber-400/60">♪ ♪ ♪</span>
                    )}
                  </button>
                );
              })}

              <p className="pt-8 pl-4 text-xs text-zinc-500">
                Click any lyric line to jump playback there.
              </p>
            </div>
          ) : lyrics?.hasPlain && lyrics.plainLyrics ? (
            <div className="space-y-4 py-6">
              <p className="text-xs text-zinc-500">
                Timed lyrics weren&apos;t available for this version — showing plain lyrics.
              </p>
              <div className="whitespace-pre-wrap text-xl leading-relaxed font-medium text-zinc-200 sm:text-2xl">
                {lyrics.plainLyrics}
              </div>
            </div>
          ) : lyrics?.instrumental ? (
            <div className="flex flex-col items-center justify-center gap-3 py-28 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                <Music className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-100">Instrumental Track</h3>
              <p className="max-w-sm text-sm text-zinc-400">
                LRCLIB marks this track as instrumental — sit back and enjoy the music.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-28 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800">
                <Mic2 className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-100">No lyrics found yet</h3>
              <p className="max-w-md text-sm text-zinc-400">
                We couldn&apos;t find lyrics for <strong>{track.title}</strong> by{" "}
                <strong>{track.artistName}</strong> on LRCLIB. Check the track&apos;s tags or try
                re-fetching.
              </p>
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void loadLyrics(true)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Re-fetch from LRCLIB
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Floating button to re-center auto-scroll when user scrolls manually */}
      {lyrics?.hasSynced && userScrolling && activeLineIndex >= 0 && (
        <button
          type="button"
          onClick={handleSyncToCurrentLine}
          className="fixed right-6 bottom-24 z-40 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 shadow-xl transition hover:bg-amber-400"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Sync to playing line
        </button>
      )}
    </div>
  );
}
