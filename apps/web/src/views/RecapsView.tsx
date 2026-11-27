import { useCallback, useEffect, useState } from "react";
import {
  CalendarHeart,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Disc3,
  Download,
  FileJson,
  Flame,
  Gift,
  ListPlus,
  Loader2,
  Play,
  Share2,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import type { RecapPeriodType, RecapResponse } from "@musicorbit/shared";
import { fetchAlbumDetail, fetchRecap, saveRecapAsPlaylist } from "../api/client";
import { AlbumCover } from "../components/AlbumCover";
import { ArtistAvatar } from "../components/ArtistAvatar";
import { ImportSpotifyHistoryModal } from "../components/ImportSpotifyHistoryModal";
import { usePlayer } from "../context/PlayerContext";
import {
  buildRecapShareText,
  renderRecapShareCardBlob,
  type ShareCardFormat,
} from "../utils/recapShareCard";

interface RecapsViewProps {
  username?: string | null;
  initialType?: RecapPeriodType;
  initialPeriod?: string;
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
  onSelectPlaylist: (playlistId: number) => void;
  onPlaylistsChanged: () => void;
}

function formatMinutes(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h.toLocaleString()}h ${m}m` : `${h.toLocaleString()}h`;
  }
  return `${minutes.toLocaleString()} min`;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12:00 AM";
  if (hour === 12) return "12:00 PM";
  return hour > 12 ? `${hour - 12}:00 PM` : `${hour}:00 AM`;
}

export function RecapsView({
  username,
  initialType = "month",
  initialPeriod,
  onSelectAlbum,
  onSelectArtist,
  onSelectPlaylist,
  onPlaylistsChanged,
}: RecapsViewProps) {
  const { playQueue } = usePlayer();
  const [periodType, setPeriodType] = useState<RecapPeriodType>(initialType);
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(initialPeriod);
  const [recap, setRecap] = useState<RecapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewEarly, setPreviewEarly] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [spotifyImportOpen, setSpotifyImportOpen] = useState(false);

  // Save as playlist state
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [savedPlaylistId, setSavedPlaylistId] = useState<number | null>(null);
  const [savedPlaylistMsg, setSavedPlaylistMsg] = useState<string | null>(null);

  // Share modal state
  const [shareOpen, setShareOpen] = useState(false);
  const [shareFormat, setShareFormat] = useState<ShareCardFormat>("story");
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);
  const [sharePreviewUrl, setSharePreviewUrl] = useState<string | null>(null);
  const [renderingCard, setRenderingCard] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);

  const loadRecap = useCallback(async (type: RecapPeriodType, period?: string) => {
    setLoading(true);
    setError(null);
    setSavedPlaylistId(null);
    setSavedPlaylistMsg(null);
    setSlideIndex(0);
    try {
      const data = await fetchRecap(type, period);
      setRecap(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load recap");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecap(periodType, selectedPeriod);
  }, [periodType, selectedPeriod, loadRecap]);

  // Render PNG share preview whenever share modal opens or format switches
  useEffect(() => {
    if (!shareOpen || !recap || recap.totalPlays === 0) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setRenderingCard(true);
    setShareNotice(null);

    void renderRecapShareCardBlob(recap, shareFormat, username ?? undefined)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setShareBlob(blob);
        setSharePreviewUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setShareNotice(err instanceof Error ? err.message : "Could not generate image.");
        }
      })
      .finally(() => {
        if (!cancelled) setRenderingCard(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [shareOpen, shareFormat, recap, username]);

  const handleSwitchType = (nextType: RecapPeriodType) => {
    setPeriodType(nextType);
    setSelectedPeriod(undefined);
    setPreviewEarly(false);
  };

  const handleQuickPlayTrack = async (albumId: number | null, trackId: number | null) => {
    if (!albumId) return;
    try {
      const detail = await fetchAlbumDetail(albumId);
      if (detail.tracks.length === 0) return;
      const startIndex = trackId
        ? Math.max(
            0,
            detail.tracks.findIndex((t) => t.id === trackId),
          )
        : 0;
      playQueue(detail.tracks, startIndex);
    } catch {
      // Non-fatal
    }
  };

  const handleSavePlaylist = async () => {
    if (!recap || recap.topTracks.length === 0) return;
    setSavingPlaylist(true);
    setSavedPlaylistMsg(null);
    try {
      const res = await saveRecapAsPlaylist(recap.type, recap.period);
      setSavedPlaylistId(res.playlist.id);
      setSavedPlaylistMsg(`Saved "${res.playlist.name}" (${res.tracksAdded} tracks)`);
      onPlaylistsChanged();
    } catch (err) {
      setSavedPlaylistMsg(err instanceof Error ? err.message : "Could not save playlist");
    } finally {
      setSavingPlaylist(false);
    }
  };

  const handleDownloadPng = () => {
    if (!shareBlob || !recap) return;
    const url = URL.createObjectURL(shareBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `musicorbit-recap-${recap.period}-${shareFormat}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setShareNotice("Image downloaded! Ready to post on Instagram, X, Bluesky, or Stories.");
  };

  const handleNativeShare = async () => {
    if (!shareBlob || !recap) return;
    const filename = `musicorbit-recap-${recap.period}-${shareFormat}.png`;
    const file = new File([shareBlob], filename, { type: "image/png" });

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        // Pass `files` alone first — iOS Safari filters out image-only targets (like Instagram)
        // when `text` or `title` are combined with `files`.
        if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          setShareNotice("Shared!");
          return;
        }
        // Fallback for browsers that support text-only Web Share
        await navigator.share({
          title: `My ${recap.label} on MusicOrbit`,
          text: buildRecapShareText(recap),
        });
        setShareNotice("Shared!");
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    // Fallback when Web Share API is unavailable (desktop browsers or non-HTTPS LAN testing)
    handleDownloadPng();
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setShareNotice(
        "Image downloaded! Native mobile Share Sheet (Instagram, X, Messages) requires HTTPS and activates automatically on your Cloudflare Tunnel / HTTPS domain.",
      );
    }
  };

  const handleCopyImage = async () => {
    if (!shareBlob) return;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": shareBlob })]);
        setCopiedImage(true);
        setShareNotice("Image copied! Paste directly into Instagram, X, Bluesky, or Messages.");
        window.setTimeout(() => setCopiedImage(false), 1800);
        return;
      }
    } catch {
      // Fall through
    }
    setShareNotice("Image clipboard copy isn't supported in this browser — use Download PNG.");
  };

  const handleCopyText = async () => {
    if (!recap) return;
    try {
      await navigator.clipboard.writeText(buildRecapShareText(recap));
      setCopiedText(true);
      window.setTimeout(() => setCopiedText(false), 1800);
    } catch {
      setShareNotice("Clipboard access unavailable in this browser.");
    }
  };

  const availableOptions =
    periodType === "year" ? (recap?.availableYears ?? []) : (recap?.availableMonths ?? []);

  const isLockedPreChristmas =
    recap?.type === "year" && !recap.isPostChristmasUnlocked && !previewEarly;

  const totalSlides = 4;

  return (
    <div className="space-y-6">
      {/* Header + Period Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-zinc-50">
            <CalendarHeart className="h-6 w-6 text-amber-400" />
            Listening Recaps
          </h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            Monthly highlights and post-Christmas Yearly Recaps — 100% private &amp; local.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
            <button
              type="button"
              onClick={() => handleSwitchType("month")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                periodType === "month"
                  ? "bg-amber-500 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => handleSwitchType("year")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                periodType === "year"
                  ? "bg-amber-500 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Yearly
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSpotifyImportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-emerald-500/40 hover:bg-zinc-800 hover:text-emerald-300"
          >
            <FileJson className="h-3.5 w-3.5 text-emerald-400" />
            Import Spotify
          </button>

          {recap && recap.totalPlays > 0 && !isLockedPreChristmas && (
            <>
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share Recap
              </button>

              <button
                type="button"
                disabled={savingPlaylist || recap.topTracks.length === 0}
                onClick={() => void handleSavePlaylist()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300 disabled:opacity-50"
              >
                {savingPlaylist ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ListPlus className="h-3.5 w-3.5 text-amber-400" />
                )}
                Save Top 25 Playlist
              </button>
            </>
          )}
        </div>
      </div>

      {/* Period Selector Pills */}
      {availableOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {availableOptions.map((opt) => {
            const active = recap?.period === opt.period;
            return (
              <button
                key={opt.period}
                type="button"
                onClick={() => {
                  setSelectedPeriod(opt.period);
                  setPreviewEarly(false);
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                    : "border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {opt.label}{" "}
                <span className="text-[11px] opacity-70">({opt.plays})</span>
              </button>
            );
          })}
        </div>
      )}

      {savedPlaylistMsg && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
          <span>{savedPlaylistMsg}</span>
          {savedPlaylistId && (
            <button
              type="button"
              onClick={() => onSelectPlaylist(savedPlaylistId)}
              className="font-semibold text-emerald-300 underline hover:text-emerald-200"
            >
              Open Playlist →
            </button>
          )}
        </div>
      )}

      {loading && !recap && (
        <div className="h-96 animate-pulse rounded-3xl bg-zinc-900/70" />
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Post-Christmas Lock / Early Preview Card */}
      {recap && isLockedPreChristmas && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-zinc-900/90 to-zinc-950 px-6 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/35">
            <Gift className="h-8 w-8" />
          </div>
          <h3 className="mt-5 text-2xl font-bold text-zinc-50">
            Your {recap.period} Yearly Recap unlocks after Christmas!
          </h3>
          <p className="mt-2 max-w-md text-sm text-zinc-400">
            Unlocks automatically on <strong className="text-zinc-200">{recap.unlocksOn}</strong>.
            {recap.totalPlays > 0
              ? ` You've already logged ${recap.totalPlays.toLocaleString()} plays (${formatMinutes(recap.totalMinutes)}) so far this year.`
              : " Keep listening across Web and OpenSubsonic apps to build your year in music."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {recap.totalPlays > 0 && (
              <button
                type="button"
                onClick={() => setPreviewEarly(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
              >
                <Sparkles className="h-4 w-4" />
                Preview {recap.period} So Far
              </button>
            )}
            <button
              type="button"
              onClick={() => handleSwitchType("month")}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
            >
              View Monthly Recaps
            </button>
          </div>
        </div>
      )}

      {/* Empty Period State */}
      {recap && !isLockedPreChristmas && recap.totalPlays === 0 && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
          <Disc3 className="h-10 w-10 text-zinc-600" />
          <h3 className="mt-4 text-base font-semibold text-zinc-200">
            No plays recorded for {recap.label} yet
          </h3>
          <p className="mt-1 max-w-md text-sm text-zinc-500">
            Listen to songs in MusicOrbit or from OpenSubsonic clients like Arpeggi, Symfonium,
            Amperfy, or Feishin — or import your official Spotify JSON history to populate past
            months and years immediately.
          </p>
          <button
            type="button"
            onClick={() => setSpotifyImportOpen(true)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            <FileJson className="h-3.5 w-3.5" />
            Import Spotify History
          </button>
        </div>
      )}

      {/* Interactive Wrapped-Style Story Deck + Detailed Breakdown */}
      {recap && !isLockedPreChristmas && recap.totalPlays > 0 && (
        <>
          <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-[#0b0d1b] via-zinc-950 to-[#141016] p-6 sm:p-8">
            {/* Story Progress Bars */}
            <div className="mb-6 flex items-center gap-2">
              {Array.from({ length: totalSlides }).map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSlideIndex(idx)}
                  aria-label={`Slide ${idx + 1}`}
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"
                >
                  <div
                    className={`h-full rounded-full transition-all ${
                      idx <= slideIndex ? "w-full bg-amber-400" : "w-0"
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Slide 0: Overview */}
            {slideIndex === 0 && (
              <div className="grid items-center gap-6 md:grid-cols-2 md:gap-8">
                <div className="min-w-0 space-y-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                    {recap.isComplete ? recap.label : `${recap.label} · In Progress`}
                  </span>
                  <h3 className="text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
                    {formatMinutes(recap.totalMinutes)}{" "}
                    <span className="text-amber-400">in orbit.</span>
                  </h3>
                  <p className="text-sm text-zinc-400">
                    You played <strong className="text-zinc-100">{recap.totalPlays.toLocaleString()}</strong>{" "}
                    tracks across{" "}
                    <strong className="text-zinc-100">{recap.uniqueArtists.toLocaleString()}</strong>{" "}
                    artists and{" "}
                    <strong className="text-zinc-100">{recap.uniqueAlbums.toLocaleString()}</strong>{" "}
                    albums over{" "}
                    <strong className="text-zinc-100">{recap.activeDays}</strong> active{" "}
                    {recap.activeDays === 1 ? "day" : "days"}.
                  </p>
                  {recap.persona && (
                    <div className="flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5 py-2.5 text-xs">
                      <Flame className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <p className="min-w-0">
                        <span className="font-semibold text-zinc-100">{recap.persona.title}:</span>{" "}
                        <span className="text-zinc-400">{recap.persona.description}</span>
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-3.5">
                  <div className="min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase">Plays</p>
                    <p className="mt-1.5 text-2xl font-bold text-zinc-50">
                      {recap.totalPlays.toLocaleString()}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase">Longest Streak</p>
                    <p className="mt-1.5 text-2xl font-bold text-amber-400">
                      {recap.longestStreakDays}d
                    </p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase">Unique Songs</p>
                    <p className="mt-1.5 text-2xl font-bold text-zinc-50">
                      {recap.uniqueTracks.toLocaleString()}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase">Top App</p>
                    <p className="mt-1.5 truncate text-lg font-bold text-zinc-50">
                      {recap.clients[0]?.clientName ?? "MusicOrbit"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Slide 1: #1 Song & Top 5 Tracks */}
            {slideIndex === 1 && (
              <div className="grid items-center gap-6 md:grid-cols-2 md:gap-8">
                {recap.topTrack && (
                  <div className="min-w-0 flex flex-col items-start text-left">
                    <span className="text-xs font-bold tracking-wider text-amber-400 uppercase">
                      Your #1 Song
                    </span>
                    <div className="mt-4 flex w-full min-w-0 items-center gap-4">
                      {recap.topTrack.albumId && (
                        <AlbumCover
                          albumId={recap.topTrack.albumId}
                          coverHash={recap.topTrack.coverHash}
                          alt={recap.topTrack.albumTitle}
                          className="h-24 w-24 shrink-0 rounded-2xl shadow-xl sm:h-28 sm:w-28"
                          iconClassName="h-10 w-10"
                        />
                      )}
                      <div className="min-w-0 flex-1 text-left">
                        <h3 className="truncate text-xl font-bold text-zinc-50 sm:text-2xl">
                          {recap.topTrack.title}
                        </h3>
                        <p className="mt-1 truncate text-sm text-zinc-300">
                          {recap.topTrack.artistName}
                        </p>
                        <p className="mt-2 text-xs font-semibold text-amber-400">
                          {recap.topTrack.playCount} plays ·{" "}
                          {formatMinutes(recap.topTrack.totalMinutes)}
                        </p>
                        {recap.topTrack.albumId && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleQuickPlayTrack(
                                recap.topTrack!.albumId,
                                recap.topTrack!.trackId,
                              )
                            }
                            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            Play Now
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="min-w-0 space-y-2">
                  <p className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                    Top 5 Songs
                  </p>
                  {recap.topTracks.slice(0, 5).map((t, idx) => (
                    <div
                      key={`${t.trackId ?? t.title}-${idx}`}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/60 px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className={`w-5 shrink-0 text-center text-xs font-bold ${
                            idx === 0 ? "text-amber-400" : "text-zinc-500"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-100">{t.title}</p>
                          <p className="truncate text-xs text-zinc-400">{t.artistName}</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-amber-300">
                        {t.playCount}×
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Slide 2: #1 Artist & #1 Album */}
            {slideIndex === 2 && (
              <div className="grid items-center gap-6 md:grid-cols-2 md:gap-8">
                {recap.topArtist && (
                  <div className="min-w-0 space-y-4">
                    <span className="text-xs font-bold tracking-wider text-amber-400 uppercase">
                      Your #1 Artist
                    </span>
                    <div className="flex min-w-0 items-center gap-4">
                      {recap.topArtist.artistId ? (
                        <ArtistAvatar
                          artistId={recap.topArtist.artistId}
                          name={recap.topArtist.artistName}
                          imageHash={recap.topArtist.imageHash}
                          fallbackAlbumId={recap.topArtist.fallbackAlbumId}
                          className="h-20 w-20 sm:h-24 sm:w-24"
                          textClassName="text-2xl"
                        />
                      ) : (
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-2xl font-bold text-amber-300 sm:h-24 sm:w-24">
                          {recap.topArtist.artistName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-xl font-bold text-zinc-50 sm:text-2xl">
                          {recap.topArtist.artistName}
                        </h3>
                        <p className="mt-1 text-sm text-amber-300">
                          {recap.topArtist.playCount} plays ·{" "}
                          {formatMinutes(recap.topArtist.totalMinutes)}
                        </p>
                      </div>
                    </div>

                    {recap.topAlbum && (
                      <button
                        type="button"
                        disabled={!recap.topAlbum.albumId}
                        onClick={() =>
                          recap.topAlbum?.albumId && onSelectAlbum(recap.topAlbum.albumId)
                        }
                        className="flex w-full min-w-0 items-center gap-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3 text-left transition hover:border-amber-500/40"
                      >
                        {recap.topAlbum.albumId && (
                          <AlbumCover
                            albumId={recap.topAlbum.albumId}
                            coverHash={recap.topAlbum.coverHash}
                            alt={recap.topAlbum.albumTitle}
                            className="h-14 w-14 shrink-0 rounded-xl"
                            iconClassName="h-5 w-5"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold tracking-wider text-amber-400 uppercase">
                            #1 Album
                          </p>
                          <p className="truncate text-sm font-semibold text-zinc-100">
                            {recap.topAlbum.albumTitle}
                          </p>
                          <p className="truncate text-xs text-zinc-400">
                            {recap.topAlbum.artistName} · {recap.topAlbum.playCount} plays
                          </p>
                        </div>
                      </button>
                    )}
                  </div>
                )}

                <div className="min-w-0 space-y-2">
                  <p className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                    Top 5 Artists
                  </p>
                  {recap.topArtists.slice(0, 5).map((a, idx) => (
                    <button
                      key={`${a.artistId ?? a.artistName}-${idx}`}
                      type="button"
                      disabled={!a.artistId}
                      onClick={() => a.artistId && onSelectArtist(a.artistId)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/60 px-3 py-2 text-left transition hover:border-zinc-700"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`w-5 text-center text-xs font-bold ${
                            idx === 0 ? "text-amber-400" : "text-zinc-500"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="truncate text-sm font-medium text-zinc-100">
                          {a.artistName}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs text-zinc-400">
                        {a.playCount} plays · {formatMinutes(a.totalMinutes)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Slide 3: Listening DNA, Devices & Yearly Trend */}
            {slideIndex === 3 && (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <span className="text-xs font-bold tracking-wider text-amber-400 uppercase">
                    Your Listening DNA
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
                      <p className="text-[10px] font-medium text-zinc-400 uppercase">Peak Day</p>
                      <p className="mt-1 text-sm font-bold text-zinc-100">
                        {recap.peakDay?.date ?? "—"}
                      </p>
                      {recap.peakDay && (
                        <p className="text-xs text-amber-400">
                          {recap.peakDay.plays} plays ({recap.peakDay.minutes}m)
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
                      <p className="text-[10px] font-medium text-zinc-400 uppercase">Peak Hour</p>
                      <p className="mt-1 text-sm font-bold text-zinc-100">
                        {recap.peakHour !== null ? formatHour(recap.peakHour) : "—"}
                      </p>
                      {recap.persona && (
                        <p className="text-xs text-amber-400">{recap.persona.title}</p>
                      )}
                    </div>
                  </div>

                  {recap.topGenres.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-zinc-400 uppercase">
                        Top Genres
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {recap.topGenres.map((g) => (
                          <span
                            key={g.genre}
                            className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200"
                          >
                            {g.genre}{" "}
                            <span className="font-semibold text-amber-400">{g.percentage}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase">
                      <Smartphone className="h-3.5 w-3.5 text-amber-400" />
                      Apps &amp; Devices
                    </p>
                    <div className="space-y-2.5">
                      {recap.clients.map((c) => (
                        <div key={c.clientName} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-medium text-zinc-200">{c.clientName}</span>
                            <span className="text-zinc-400">
                              {c.playCount} plays ({c.percentage}%)
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className={`h-full rounded-full ${
                                c.source === "subsonic" ? "bg-amber-400" : "bg-emerald-400"
                              }`}
                              style={{ width: `${Math.max(4, c.percentage)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {recap.monthlyBreakdown.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-zinc-400 uppercase">
                        Month by Month
                      </p>
                      <div className="flex h-24 items-end gap-1.5">
                        {(() => {
                          const maxM = Math.max(1, ...recap.monthlyBreakdown.map((m) => m.plays));
                          return recap.monthlyBreakdown.map((m) => (
                            <div
                              key={m.month}
                              title={`${m.label}: ${m.plays} plays (${m.minutes}m)`}
                              className="flex flex-1 flex-col items-center gap-1"
                            >
                              <div className="flex h-16 w-full items-end">
                                <div
                                  className={`w-full rounded-t-sm ${
                                    m.plays > 0 ? "bg-amber-400/80" : "bg-zinc-800/70"
                                  }`}
                                  style={{
                                    height: `${m.plays > 0 ? Math.max(12, (m.plays / maxM) * 100) : 4}%`,
                                  }}
                                />
                              </div>
                              <span className="text-[10px] text-zinc-500">{m.label.slice(0, 1)}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Carousel Controls */}
            <div className="mt-7 flex items-center justify-between border-t border-zinc-800/80 pt-4">
              <button
                type="button"
                disabled={slideIndex === 0}
                onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>

              <span className="text-xs text-zinc-500">
                {slideIndex + 1} / {totalSlides}
              </span>

              <button
                type="button"
                onClick={() =>
                  slideIndex < totalSlides - 1
                    ? setSlideIndex((i) => i + 1)
                    : setShareOpen(true)
                }
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
              >
                {slideIndex < totalSlides - 1 ? (
                  <>
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    <Share2 className="h-3.5 w-3.5" />
                    Share Card
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Full Top Tracks & Top Albums Lists Below */}
          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5">
              <h3 className="mb-3.5 text-sm font-semibold text-zinc-100">
                Top Tracks ({recap.topTracks.length})
              </h3>
              <div className="divide-y divide-zinc-800/60">
                {recap.topTracks.slice(0, 15).map((t, idx) => (
                  <div
                    key={`${t.trackId ?? t.title}-${idx}`}
                    className="flex min-w-0 items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="w-5 shrink-0 text-right text-xs font-semibold text-zinc-500">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-100">{t.title}</p>
                        <p className="truncate text-xs text-zinc-400">
                          {t.artistName} · {t.albumTitle}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-amber-300">
                      {t.playCount}×
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5">
              <h3 className="mb-3.5 text-sm font-semibold text-zinc-100">
                Top Albums ({recap.topAlbums.length})
              </h3>
              <div className="space-y-2.5">
                {recap.topAlbums.map((al, idx) => (
                  <button
                    key={`${al.albumId ?? al.albumTitle}-${idx}`}
                    type="button"
                    disabled={!al.albumId}
                    onClick={() => al.albumId && onSelectAlbum(al.albumId)}
                    className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl p-1.5 text-left transition hover:bg-zinc-800/60 disabled:cursor-default"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="w-5 shrink-0 text-right text-xs font-semibold text-zinc-500">
                        {idx + 1}
                      </span>
                      {al.albumId && (
                        <AlbumCover
                          albumId={al.albumId}
                          coverHash={al.coverHash}
                          alt={al.albumTitle}
                          className="h-10 w-10 shrink-0 rounded-lg"
                          iconClassName="h-4 w-4"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {al.albumTitle}
                        </p>
                        <p className="truncate text-xs text-zinc-400">{al.artistName}</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                      {al.playCount} plays
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {/* Share Recap Modal */}
      {shareOpen && recap && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-50">Share {recap.label}</h3>
                <p className="text-xs text-zinc-400">
                  Generated locally in your browser — ready for Stories, X, Bluesky, or Messages.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                aria-label="Close share modal"
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center justify-center gap-2 border-b border-zinc-800/70 bg-zinc-900/40 px-5 py-2.5">
              <button
                type="button"
                onClick={() => setShareFormat("story")}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  shareFormat === "story"
                    ? "bg-amber-500 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                Story (9:16)
              </button>
              <button
                type="button"
                onClick={() => setShareFormat("square")}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  shareFormat === "square"
                    ? "bg-amber-500 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                Square (1:1)
              </button>
            </div>

            <div className="flex flex-1 items-center justify-center overflow-auto bg-zinc-950 p-5">
              {renderingCard || !sharePreviewUrl ? (
                <div className="flex flex-col items-center gap-2 py-16 text-xs text-zinc-400">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
                  Rendering high-res PNG card…
                </div>
              ) : (
                <img
                  src={sharePreviewUrl}
                  alt={`${recap.label} share card`}
                  className="max-h-[52vh] w-auto rounded-xl border border-zinc-800 shadow-2xl"
                />
              )}
            </div>

            <div className="space-y-3 border-t border-zinc-800 bg-zinc-900/50 px-5 py-4">
              {shareNotice && (
                <p className="text-center text-xs text-amber-300">{shareNotice}</p>
              )}
              {!shareNotice && typeof window !== "undefined" && !window.isSecureContext && (
                <p className="text-center text-[11px] text-zinc-400">
                  Tip: The native iOS/Android Share Sheet (Instagram, X, Messages) requires HTTPS —
                  it activates automatically over your Cloudflare Tunnel / HTTPS domain.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={renderingCard || !shareBlob}
                  onClick={() => void handleNativeShare()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share to Apps
                </button>
                <button
                  type="button"
                  disabled={renderingCard || !shareBlob}
                  onClick={() => void handleCopyImage()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  {copiedImage ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  {copiedImage ? "Copied!" : "Copy Image"}
                </button>
                <button
                  type="button"
                  disabled={renderingCard || !shareBlob}
                  onClick={handleDownloadPng}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5 text-amber-400" />
                  Download PNG
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-0.5 text-[11px] text-zinc-400">
                <a
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(buildRecapShareText(recap))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-amber-300 hover:underline"
                >
                  Post to X
                </a>
                <span>·</span>
                <a
                  href={`https://bsky.app/intent/compose?text=${encodeURIComponent(buildRecapShareText(recap))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-amber-300 hover:underline"
                >
                  Post to Bluesky
                </a>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => void handleCopyText()}
                  className="hover:text-amber-300 hover:underline"
                >
                  {copiedText ? "Text copied!" : "Copy text summary"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {spotifyImportOpen && (
        <ImportSpotifyHistoryModal
          onClose={() => setSpotifyImportOpen(false)}
          onImported={() => void loadRecap(periodType, selectedPeriod)}
        />
      )}
    </div>
  );
}
