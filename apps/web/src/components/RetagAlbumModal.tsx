import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Disc3, Loader2, Search, Sparkles, X } from "lucide-react";
import type {
  ApplyTaggingRequest,
  MusicBrainzReleaseCandidate,
  RetagTrackOverride,
} from "@musicorbit/shared";
import { fetchMusicBrainzRelease, searchMusicBrainz } from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

export interface EditableTrackRow {
  filePath: string;
  basename: string;
  title: string;
  artist: string;
  trackNumber: number | null;
  discNumber: number | null;
  recordingMbid?: string | null;
}

interface RetagAlbumModalProps {
  mode: "import" | "retag";
  heading: string;
  subheading?: string;
  initialArtist: string;
  initialAlbum: string;
  initialYear: number | null;
  initialGenre?: string | null;
  initialCandidates?: MusicBrainzReleaseCandidate[];
  initialTracks: EditableTrackRow[];
  onClose: () => void;
  onSubmit: (payload: ApplyTaggingRequest) => Promise<void>;
}

export function RetagAlbumModal({
  mode,
  heading,
  subheading,
  initialArtist,
  initialAlbum,
  initialYear,
  initialGenre = "",
  initialCandidates = [],
  initialTracks,
  onClose,
  onSubmit,
}: RetagAlbumModalProps) {
  const [mbArtistQuery, setMbArtistQuery] = useState(
    initialArtist === "Unknown Artist" ? "" : initialArtist,
  );
  const [mbAlbumQuery, setMbAlbumQuery] = useState(initialAlbum);
  const [candidates, setCandidates] = useState<MusicBrainzReleaseCandidate[]>(initialCandidates);
  const [searchingMb, setSearchingMb] = useState(false);
  const [loadingMbid, setLoadingMbid] = useState<string | null>(null);
  const [selectedMbid, setSelectedMbid] = useState<string | null>(null);
  const [selectedArtistMbid, setSelectedArtistMbid] = useState<string | null>(null);

  const [artist, setArtist] = useState(initialArtist);
  const [album, setAlbum] = useState(initialAlbum);
  const [yearText, setYearText] = useState(initialYear ? String(initialYear) : "");
  const [genre, setGenre] = useState(initialGenre ?? "");
  const [tracks, setTracks] = useState<EditableTrackRow[]>(initialTracks);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useModalAccessibility(dialogRef, onClose);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSearchMusicBrainz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mbArtistQuery.trim() && !mbAlbumQuery.trim()) return;

    setSearchingMb(true);
    setError(null);
    try {
      const res = await searchMusicBrainz({
        artist: mbArtistQuery.trim() || undefined,
        album: mbAlbumQuery.trim() || undefined,
        trackCount: tracks.length,
      });
      setCandidates(res);
      if (res.length === 0) {
        setError("No MusicBrainz releases found for that query. Try a simpler album or artist name.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "MusicBrainz search failed");
    } finally {
      setSearchingMb(false);
    }
  };

  const handleApplyCandidate = async (candidate: MusicBrainzReleaseCandidate) => {
    setLoadingMbid(candidate.mbid);
    setError(null);
    try {
      const detail = await fetchMusicBrainzRelease(candidate.mbid);
      setSelectedMbid(detail.mbid);
      setSelectedArtistMbid(detail.artistMbid);
      setArtist(detail.artist);
      setAlbum(detail.title);
      setYearText(detail.year ? String(detail.year) : "");

      setTracks((prev) =>
        prev.map((row, idx) => {
          // Match by track position if single-disc or index alignment
          const mbTrack =
            detail.tracks.find(
              (t) =>
                row.trackNumber !== null &&
                t.trackNumber === row.trackNumber &&
                t.discNumber === (row.discNumber ?? 1),
            ) ?? detail.tracks[idx];
          if (!mbTrack) return row;
          return {
            ...row,
            title: mbTrack.title,
            artist: mbTrack.artist || detail.artist,
            trackNumber: mbTrack.trackNumber,
            discNumber: mbTrack.discNumber,
            recordingMbid: mbTrack.recordingMbid,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load MusicBrainz release details");
    } finally {
      setLoadingMbid(null);
    }
  };

  const updateTrack = (index: number, patch: Partial<EditableTrackRow>) => {
    setTracks((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const handleSave = async () => {
    const trimmedArtist = artist.trim();
    const trimmedAlbum = album.trim();
    if (!trimmedArtist || !trimmedAlbum) {
      setError("Artist and Album are required.");
      return;
    }

    let parsedYear: number | null = null;
    if (yearText.trim()) {
      const n = Number.parseInt(yearText.trim(), 10);
      if (!Number.isFinite(n) || n < 1800 || n > 2200) {
        setError("Year must be a 4-digit year (e.g. 2021) or blank.");
        return;
      }
      parsedYear = n;
    }

    const trackOverrides: RetagTrackOverride[] = tracks.map((t, idx) => ({
      filePath: t.filePath,
      title: t.title.trim() || t.basename,
      artist: t.artist.trim() || trimmedArtist,
      trackNumber: t.trackNumber ?? idx + 1,
      discNumber: t.discNumber ?? 1,
      recordingMbid: t.recordingMbid ?? null,
    }));

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        artist: trimmedArtist,
        album: trimmedAlbum,
        year: parsedYear,
        genre: genre.trim() || null,
        mbid: selectedMbid,
        artistMbid: selectedArtistMbid,
        tracks: trackOverrides,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save tags");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-50">
              <Sparkles className="h-4 w-4 text-amber-400" />
              {heading}
            </h3>
            {subheading && <p className="mt-0.5 truncate text-xs text-zinc-400">{subheading}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tag editor"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Step A: MusicBrainz Release Lookup */}
          <section className="space-y-3 rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold tracking-wider text-zinc-300 uppercase">
                1. Match on MusicBrainz
              </h4>
              <span className="text-[11px] text-zinc-500">
                Click a release to auto-fill tags &amp; tracklist
              </span>
            </div>

            <form
              onSubmit={(e) => void handleSearchMusicBrainz(e)}
              className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            >
              <input
                type="text"
                value={mbArtistQuery}
                onChange={(e) => setMbArtistQuery(e.target.value)}
                placeholder="Artist name…"
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
              />
              <input
                type="text"
                value={mbAlbumQuery}
                onChange={(e) => setMbAlbumQuery(e.target.value)}
                placeholder="Album title…"
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
              />
              <button
                type="submit"
                disabled={searchingMb || (!mbArtistQuery.trim() && !mbAlbumQuery.trim())}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-45"
              >
                {searchingMb ? (
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Search
              </button>
            </form>

            {candidates.length > 0 && (
              <div className="grid max-h-56 gap-2 overflow-y-auto pt-1 sm:grid-cols-2">
                {candidates.map((c) => {
                  const selected = selectedMbid === c.mbid;
                  const busy = loadingMbid === c.mbid;
                  return (
                    <button
                      key={c.mbid}
                      type="button"
                      disabled={loadingMbid !== null}
                      onClick={() => void handleApplyCandidate(c)}
                      className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                        selected
                          ? "border-amber-500/60 bg-amber-500/10"
                          : "border-zinc-800 bg-zinc-900/70 hover:border-zinc-700 hover:bg-zinc-900"
                      }`}
                    >
                      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-800 text-zinc-500">
                        <Disc3 className="h-5 w-5" />
                        <img
                          src={c.coverArtUrl}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        {busy && (
                          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/75">
                            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-zinc-100">{c.title}</p>
                        <p className="truncate text-[11px] text-zinc-400">{c.artist}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                          {c.year && <span>{c.year}</span>}
                          {c.country && <span>· {c.country}</span>}
                          <span>· {c.trackCount} tracks</span>
                          <span
                            className={`rounded px-1 py-0.2 font-semibold ${
                              c.score >= 85
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {c.score}%
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Step B: Review & Edit Tags */}
          <section className="space-y-4">
            <h4 className="text-xs font-semibold tracking-wider text-zinc-300 uppercase">
              2. Review &amp; Fine-Tune Tags
            </h4>

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_100px]">
              <label className="block space-y-1">
                <span className="text-xs text-zinc-400">Album Artist</span>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-zinc-400">Album Title</span>
                <input
                  type="text"
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-zinc-400">Genre</span>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="Pop, Rock…"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-zinc-400">Year</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={yearText}
                  onChange={(e) => setYearText(e.target.value)}
                  placeholder="2021"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                />
              </label>
            </div>

            {/* Editable track rows */}
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
              <div className="grid grid-cols-[56px_1.2fr_1fr_1fr] gap-2 border-b border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-400">
                <span>#</span>
                <span>Track Title</span>
                <span>Track Artist</span>
                <span>Source Filename</span>
              </div>
              <div className="max-h-60 divide-y divide-zinc-800/60 overflow-y-auto">
                {tracks.map((row, idx) => (
                  <div
                    key={row.filePath}
                    className="grid grid-cols-[56px_1.2fr_1fr_1fr] items-center gap-2 px-3 py-2"
                  >
                    <input
                      type="number"
                      min={1}
                      value={row.trackNumber ?? idx + 1}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        updateTrack(idx, { trackNumber: Number.isFinite(n) && n > 0 ? n : null });
                      }}
                      className="w-12 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={row.title}
                      onChange={(e) => updateTrack(idx, { title: e.target.value })}
                      className="min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={row.artist}
                      onChange={(e) => updateTrack(idx, { artist: e.target.value })}
                      className="min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                    />
                    <span className="truncate text-xs text-zinc-500" title={row.basename}>
                      {row.basename}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/50 px-6 py-4">
          <p className="text-xs text-zinc-500">
            {mode === "import"
              ? `Writes embedded tags and moves ${tracks.length} ${tracks.length === 1 ? "file" : "files"} into Artist / Album.`
              : `Rewrites embedded tags in place for ${tracks.length} ${tracks.length === 1 ? "file" : "files"} and refreshes library.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {saving
                ? "Writing Tags…"
                : mode === "import"
                  ? "Retag & Import"
                  : "Save Tags"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
