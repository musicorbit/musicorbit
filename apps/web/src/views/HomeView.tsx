import { useCallback, useEffect, useState } from "react";
import {
  CalendarHeart,
  Clock,
  Disc3,
  Flame,
  HardDrive,
  Headphones,
  Play,
  RefreshCw,
  Smartphone,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { HomeStatsResponse, StatsRange } from "@musicorbit/shared";
import { fetchAlbumDetail, fetchHomeStats } from "../api/client";
import { AlbumCover } from "../components/AlbumCover";
import { ArtistAvatar } from "../components/ArtistAvatar";
import { usePlayer } from "../context/PlayerContext";

interface HomeViewProps {
  username?: string | null;
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
  onOpenAlbums: () => void;
  onOpenRecaps: (initialType?: "month" | "year", initialPeriod?: string) => void;
  onOpenSystem: () => void;
}

const RANGE_OPTIONS: Array<{ id: StatsRange; label: string }> = [
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "year", label: "This Year" },
  { id: "all", label: "All Time" },
];

function formatMinutes(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h.toLocaleString()}h ${m}m` : `${h.toLocaleString()}h`;
  }
  return `${minutes.toLocaleString()}m`;
}

function formatLibraryHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  if (hours >= 10) return `${Math.round(hours).toLocaleString()} hrs`;
  if (hours >= 1) return `${hours.toFixed(1)} hrs`;
  return `${Math.round(totalSeconds / 60)} min`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour > 12 ? `${hour - 12}p` : `${hour}a`;
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "Just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeView({
  username,
  onSelectAlbum,
  onSelectArtist,
  onOpenAlbums,
  onOpenRecaps,
  onOpenSystem,
}: HomeViewProps) {
  const { playQueue } = usePlayer();
  const [range, setRange] = useState<StatsRange>("30d");
  const [stats, setStats] = useState<HomeStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async (selectedRange: StatsRange) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHomeStats(selectedRange);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load listening stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats(range);
  }, [range, loadStats]);

  const handleQuickPlayAlbum = async (albumId: number, startTrackId?: number | null) => {
    try {
      const detail = await fetchAlbumDetail(albumId);
      if (detail.tracks.length === 0) return;
      const startIndex = startTrackId
        ? Math.max(
            0,
            detail.tracks.findIndex((t) => t.id === startTrackId),
          )
        : 0;
      playQueue(detail.tracks, startIndex);
    } catch {
      // Non-fatal
    }
  };

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-zinc-900/70" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-2xl bg-zinc-900/70" />
          <div className="h-64 animate-pulse rounded-2xl bg-zinc-900/70" />
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  const maxHeatmapPlays = Math.max(1, ...stats.dailyActivity.map((d) => d.plays));
  const maxHourPlays = Math.max(1, ...stats.hourlyActivity.map((h) => h.plays));
  const hasListeningData = stats.listening.allTimePlays > 0;

  return (
    <div className="space-y-7">
      {/* Header + Range Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
            {getGreeting()}
            {username ? `, ${username}` : ""}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            {stats.listening.persona
              ? `${stats.listening.persona.title} — ${stats.listening.persona.description}`
              : "Your private listening space, stats, and cross-device history."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRange(opt.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  range === opt.id
                    ? "bg-amber-500 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onOpenRecaps("month")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:border-amber-400/60 hover:bg-amber-500/20"
          >
            <CalendarHeart className="h-3.5 w-3.5" />
            Recaps
          </button>

          <button
            type="button"
            onClick={() => void loadStats(range)}
            disabled={loading}
            title="Refresh stats"
            aria-label="Refresh stats"
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Post-Christmas Yearly Recap Celebration Banner */}
      {stats.yearlyRecapBanner && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/35 bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-zinc-900/80 p-5">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/35">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-50">
                {stats.yearlyRecapBanner.unlocked
                  ? `Your ${stats.yearlyRecapBanner.year} MusicOrbit Yearly Recap is ready!`
                  : `${stats.yearlyRecapBanner.year} Yearly Recap unlocks ${stats.yearlyRecapBanner.unlocksOn}`}
              </p>
              <p className="mt-0.5 text-xs text-zinc-300">
                {stats.yearlyRecapBanner.unlocked
                  ? `Explore your top songs, artists, listening persona, and shareable recap cards across ${stats.yearlyRecapBanner.plays.toLocaleString()} plays.`
                  : `${stats.yearlyRecapBanner.plays.toLocaleString()} plays tracked so far this year — preview your progress or check your monthly recaps anytime.`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onOpenRecaps("year", String(stats.yearlyRecapBanner?.year ?? new Date().getFullYear()))
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            <CalendarHeart className="h-3.5 w-3.5" />
            {stats.yearlyRecapBanner.unlocked ? "Open Yearly Recap" : "Preview Recap"}
          </button>
        </div>
      )}

      {/* 4-Up KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-1 text-xs font-medium text-zinc-400">
            <span className="truncate">Listening Time</span>
            <Clock className="h-4 w-4 shrink-0 text-amber-400" />
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight text-zinc-50 sm:mt-2.5 sm:text-2xl">
            {formatMinutes(stats.listening.totalMinutes)}
          </p>
          <p className="mt-1 truncate text-[11px] text-zinc-500 sm:text-xs">
            {stats.listening.totalPlays.toLocaleString()}{" "}
            {stats.listening.totalPlays === 1 ? "play" : "plays"} ·{" "}
            {formatMinutes(stats.listening.allTimeMinutes)} all-time
          </p>
        </div>

        <div className="min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-1 text-xs font-medium text-zinc-400">
            <span className="truncate">Listening Streak</span>
            <Flame className="h-4 w-4 shrink-0 text-amber-400" />
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight text-zinc-50 sm:mt-2.5 sm:text-2xl">
            {stats.listening.currentStreakDays}{" "}
            <span className="text-sm font-medium text-zinc-400 sm:text-base">
              {stats.listening.currentStreakDays === 1 ? "day" : "days"}
            </span>
          </p>
          <p className="mt-1 truncate text-[11px] text-zinc-500 sm:text-xs">
            Longest: {stats.listening.longestStreakDays}d · {stats.listening.monthPlays} this mo
          </p>
        </div>

        <div className="min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-1 text-xs font-medium text-zinc-400">
            <span className="truncate">Library Footprint</span>
            <HardDrive className="h-4 w-4 shrink-0 text-amber-400" />
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight text-zinc-50 sm:mt-2.5 sm:text-2xl">
            {stats.library.trackCount.toLocaleString()}{" "}
            <span className="text-sm font-medium text-zinc-400 sm:text-base">tracks</span>
          </p>
          <p className="mt-1 truncate text-[11px] text-zinc-500 sm:text-xs">
            {stats.library.albumCount.toLocaleString()} albums ·{" "}
            {formatLibraryHours(stats.library.totalDurationSeconds)} ·{" "}
            {formatBytes(stats.library.totalSizeBytes)}
          </p>
        </div>

        <div className="min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-1 text-xs font-medium text-zinc-400">
            <span className="truncate">Lossless Audio</span>
            <Headphones className="h-4 w-4 shrink-0 text-emerald-400" />
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight text-zinc-50 sm:mt-2.5 sm:text-2xl">
            {stats.library.losslessPercentage}%
          </p>
          <p className="mt-1 truncate text-[11px] text-zinc-500 sm:text-xs">
            {stats.library.codecs.length > 0
              ? stats.library.codecs
                  .slice(0, 3)
                  .map((c) => `${c.codec} ${c.percentage}%`)
                  .join(" · ")
              : "No audio files indexed yet"}
          </p>
        </div>
      </div>

      {/* Empty listening state banner (library stats & recently added still show below!) */}
      {!hasListeningData && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-5">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              Your listening stats &amp; recaps start filling in as you play
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Play songs right here in MusicOrbit or from OpenSubsonic apps like{" "}
              <strong className="text-zinc-200">Arpeggi</strong>,{" "}
              <strong className="text-zinc-200">Symfonium</strong>,{" "}
              <strong className="text-zinc-200">Amperfy</strong>, or{" "}
              <strong className="text-zinc-200">Feishin</strong> — every completed listen builds
              your dashboard, device split, and Monthly &amp; Yearly Recaps.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenAlbums}
              className="rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
            >
              Browse Albums
            </button>
            <button
              type="button"
              onClick={onOpenSystem}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
            >
              Connect Mobile App
            </button>
          </div>
        </div>
      )}

      {/* Recently Played + Apps & Devices Split */}
      {hasListeningData && (
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5 lg:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-1.5">
              <h3 className="text-sm font-semibold text-zinc-100">Recently Played</h3>
              <span className="text-[11px] text-zinc-500 sm:text-xs">
                Synced across Web &amp; OpenSubsonic
              </span>
            </div>
            <div className="divide-y divide-zinc-800/60">
              {stats.recentlyPlayed.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="group flex items-start justify-between gap-2.5 py-2.5 first:pt-0 last:pb-0 sm:items-center sm:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button
                      type="button"
                      disabled={!item.albumId}
                      onClick={() =>
                        item.albumId && void handleQuickPlayAlbum(item.albumId, item.trackId)
                      }
                      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg disabled:cursor-default"
                      title={item.albumId ? `Play ${item.title}` : undefined}
                    >
                      {item.albumId ? (
                        <AlbumCover
                          albumId={item.albumId}
                          coverHash={item.coverHash}
                          alt={item.albumTitle}
                          className="h-10 w-10 rounded-lg"
                          iconClassName="h-4 w-4"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500">
                          <Disc3 className="h-4 w-4" />
                        </div>
                      )}
                      {item.albumId && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100">
                          <Play className="h-4 w-4 fill-amber-400 text-amber-400" />
                        </span>
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{item.title}</p>
                      <p className="truncate text-xs text-zinc-400">
                        {item.artistId ? (
                          <button
                            type="button"
                            onClick={() => onSelectArtist(item.artistId!)}
                            className="hover:text-amber-300 hover:underline"
                          >
                            {item.artistName}
                          </button>
                        ) : (
                          item.artistName
                        )}{" "}
                        ·{" "}
                        {item.albumId ? (
                          <button
                            type="button"
                            onClick={() => onSelectAlbum(item.albumId!)}
                            className="hover:text-zinc-200 hover:underline"
                          >
                            {item.albumTitle}
                          </button>
                        ) : (
                          item.albumTitle
                        )}
                      </p>
                      <div className="mt-1 flex items-center gap-2 sm:hidden">
                        <span
                          className={`inline-flex max-w-[140px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            item.source === "subsonic"
                              ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25"
                              : "bg-zinc-800 text-zinc-300"
                          }`}
                        >
                          {item.clientName}
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {formatRelativeTime(item.playedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="hidden shrink-0 items-center gap-2.5 text-right sm:flex">
                    <span
                      className={`inline-flex max-w-[140px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        item.source === "subsonic"
                          ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25"
                          : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {item.clientName}
                    </span>
                    <span className="w-14 text-[11px] text-zinc-500">
                      {formatRelativeTime(item.playedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Apps & Devices + Top Genres */}
          <div className="min-w-0 space-y-5 sm:space-y-6">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-100">
                  <Smartphone className="h-4 w-4 shrink-0 text-amber-400" />
                  <span className="truncate">Where You Listen</span>
                </h3>
                <span className="shrink-0 text-[11px] text-zinc-500">
                  {RANGE_OPTIONS.find((r) => r.id === range)?.label}
                </span>
              </div>

              {stats.clients.length === 0 ? (
                <p className="text-xs text-zinc-500">No plays in this period yet.</p>
              ) : (
                <div className="space-y-3">
                  {stats.clients.map((c) => (
                    <div key={c.clientName} className="min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate font-medium text-zinc-200">
                          {c.clientName}
                        </span>
                        <span className="shrink-0 tabular-nums text-zinc-400">
                          {c.playCount} ({c.percentage}%)
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
              )}
            </section>

            <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5">
              <h3 className="mb-3 text-sm font-semibold text-zinc-100">Top Genres</h3>
              {stats.topGenres.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Tag album genres in MusicOrbit to unlock genre breakdowns.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {stats.topGenres.map((g) => (
                    <span
                      key={g.genre}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-200"
                    >
                      <span className="truncate">{g.genre}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-amber-400">
                        {g.percentage}%
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Top Artists & Top Tracks for Selected Range */}
      {stats.topArtists.length > 0 && (
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <TrendingUp className="h-4 w-4 shrink-0 text-amber-400" />
                Top Artists
              </h3>
              <span className="shrink-0 text-xs text-zinc-500">
                {stats.listening.uniqueArtists} unique
              </span>
            </div>
            <div className="space-y-2.5">
              {stats.topArtists.slice(0, 6).map((artist, idx) => (
                <button
                  key={`${artist.artistId ?? artist.artistName}-${idx}`}
                  type="button"
                  disabled={!artist.artistId}
                  onClick={() => artist.artistId && onSelectArtist(artist.artistId)}
                  className="flex w-full min-w-0 items-center justify-between gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-zinc-800/60 disabled:cursor-default sm:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                    <span
                      className={`w-5 shrink-0 text-center text-xs font-bold ${
                        idx === 0 ? "text-amber-400" : "text-zinc-500"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    {artist.artistId ? (
                      <ArtistAvatar
                        artistId={artist.artistId}
                        name={artist.artistName}
                        imageHash={artist.imageHash}
                        fallbackAlbumId={artist.fallbackAlbumId}
                        className="h-9 w-9"
                        textClassName="text-xs"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-400">
                        {artist.artistName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="min-w-0 truncate text-sm font-medium text-zinc-100">
                      {artist.artistName}
                    </span>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-zinc-400 sm:text-xs">
                    {artist.playCount}× · {formatMinutes(artist.totalMinutes)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">On Repeat</h3>
              <span className="shrink-0 text-xs text-zinc-500">
                {stats.listening.uniqueTracks} tracks played
              </span>
            </div>
            <div className="space-y-2.5">
              {stats.topTracks.slice(0, 6).map((track, idx) => (
                <div
                  key={`${track.trackId ?? track.title}-${idx}`}
                  className="group flex min-w-0 items-center justify-between gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-zinc-800/60 sm:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                    <span
                      className={`w-5 shrink-0 text-center text-xs font-bold ${
                        idx === 0 ? "text-amber-400" : "text-zinc-500"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      disabled={!track.albumId}
                      onClick={() =>
                        track.albumId && void handleQuickPlayAlbum(track.albumId, track.trackId)
                      }
                      className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg disabled:cursor-default"
                    >
                      {track.albumId ? (
                        <AlbumCover
                          albumId={track.albumId}
                          coverHash={track.coverHash}
                          alt={track.albumTitle}
                          className="h-9 w-9 rounded-lg"
                          iconClassName="h-4 w-4"
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500">
                          <Disc3 className="h-4 w-4" />
                        </div>
                      )}
                      {track.albumId && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100">
                          <Play className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        </span>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{track.title}</p>
                      <p className="truncate text-xs text-zinc-400">{track.artistName}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-amber-300">
                    {track.playCount}×
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Activity Heatmap + Hour-of-Day Rhythm */}
      {hasListeningData && (
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">Last 90 Days</h3>
              <span className="text-xs text-zinc-500">Daily plays</span>
            </div>
            <div className="grid grid-cols-13 gap-1 sm:gap-1.5">
              {stats.dailyActivity.map((day) => {
                const ratio = day.plays / maxHeatmapPlays;
                const tone =
                  day.plays === 0
                    ? "bg-zinc-800/70"
                    : ratio < 0.25
                      ? "bg-amber-500/25"
                      : ratio < 0.55
                        ? "bg-amber-500/50"
                        : ratio < 0.8
                          ? "bg-amber-400/75"
                          : "bg-amber-400";
                return (
                  <div
                    key={day.date}
                    title={`${day.date}: ${day.plays} plays (${day.minutes}m)`}
                    className={`aspect-square rounded-[3px] sm:rounded-[4px] ${tone}`}
                  />
                );
              })}
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/45 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">Listening Rhythm</h3>
              {stats.listening.peakHour !== null && (
                <span className="text-xs text-amber-300">
                  Peak: {formatHour(stats.listening.peakHour)}
                </span>
              )}
            </div>
            <div className="flex h-28 items-end gap-1 pt-2">
              {stats.hourlyActivity.map((bucket) => {
                const pct = bucket.plays > 0 ? Math.max(10, (bucket.plays / maxHourPlays) * 100) : 4;
                const isPeak = bucket.hour === stats.listening.peakHour && bucket.plays > 0;
                return (
                  <div
                    key={bucket.hour}
                    title={`${formatHour(bucket.hour)}: ${bucket.plays} plays`}
                    className="flex flex-1 flex-col items-center gap-1"
                  >
                    <div className="flex h-20 w-full items-end">
                      <div
                        className={`w-full rounded-t-sm transition-all ${
                          isPeak
                            ? "bg-amber-400"
                            : bucket.plays > 0
                              ? "bg-amber-500/45"
                              : "bg-zinc-800/60"
                        }`}
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-zinc-500">
              <span>12a</span>
              <span>6a</span>
              <span>12p</span>
              <span>6p</span>
              <span>11p</span>
            </div>
          </section>
        </div>
      )}

      {/* Recently Added Albums Shelf */}
      {stats.recentlyAddedAlbums.length > 0 && (
        <section className="space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">Recently Added</h3>
            <button
              type="button"
              onClick={onOpenAlbums}
              className="text-xs font-medium text-amber-400 transition hover:text-amber-300"
            >
              View all albums →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
            {stats.recentlyAddedAlbums.map((album) => (
              <div
                key={album.id}
                onClick={() => onSelectAlbum(album.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectAlbum(album.id);
                  }
                }}
                className="group cursor-pointer space-y-2 text-left"
              >
                <div className="relative overflow-hidden rounded-xl">
                  <AlbumCover
                    albumId={album.id}
                    coverHash={album.coverHash}
                    alt={album.title}
                    className="aspect-square w-full rounded-xl transition duration-300 group-hover:scale-105"
                    iconClassName="h-8 w-8"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleQuickPlayAlbum(album.id);
                    }}
                    aria-label={`Play ${album.title}`}
                    className="absolute right-2 bottom-2 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-zinc-950 shadow-lg opacity-95 transition hover:bg-amber-400 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <Play className="h-4 w-4 translate-x-0.5 fill-current" />
                  </button>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-zinc-100 group-hover:text-amber-300">
                    {album.title}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">{album.artistName}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
