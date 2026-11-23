import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Disc3,
  Loader2,
  Music,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type {
  ApplyTaggingRequest,
  ImportDuplicateMatch,
  MusicBrainzReleaseCandidate,
  RetagTrackOverride,
  TrackMetadataSuggestion,
} from "@musicorbit/shared";
import { fetchMusicBrainzRelease, lookupImportTrack, searchMusicBrainz } from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";
import { formatBitrate, formatCodec } from "../utils/format";

export interface EditableTrackRow {
  filePath: string;
  basename: string;
  title: string;
  artist: string;
  trackNumber: number | null;
  discNumber: number | null;
  recordingMbid?: string | null;
  codec?: string | null;
  bitrate?: number | null;
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
  duplicates?: ImportDuplicateMatch[];
  onClose: () => void;
  onSubmit: (payload: ApplyTaggingRequest) => Promise<void>;
}

interface PendingDiffEntry {
  key: string;
  label: string;
  currentValue: string;
  suggestedValue: string;
  isEmptyCurrent: boolean;
  isDifferent: boolean;
  apply: () => void;
}

interface PendingSuggestionDiff {
  sourceLabel: string;
  coverArtUrl: string | null;
  mbid: string | null;
  artistMbid: string | null;
  entries: PendingDiffEntry[];
}

function normalizeTitle(val: string): string {
  return val
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\d{1,3}[\s._-]+/, "")
    .replace(/\s*[\(\[](feat\.?|ft\.?|remaster(?:ed)?[^)\]]*)[\)\]]/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  duplicates = [],
  onClose,
  onSubmit,
}: RetagAlbumModalProps) {
  const isSingleTrack = initialTracks.length === 1;
  const firstTrack = initialTracks[0];

  const [lookupTab, setLookupTab] = useState<"song" | "album">(
    mode === "import" && isSingleTrack ? "song" : "album",
  );
  const [songProvider, setSongProvider] = useState<"deezer" | "musicbrainz">("deezer");
  const [songTitleQuery, setSongTitleQuery] = useState(firstTrack?.title ?? "");
  const [songArtistQuery, setSongArtistQuery] = useState(
    firstTrack?.artist && firstTrack.artist !== "Unknown Artist" && firstTrack.artist !== "Various Artists"
      ? firstTrack.artist
      : initialArtist !== "Unknown Artist" && initialArtist !== "Various Artists"
        ? initialArtist
        : "",
  );
  const [songSuggestions, setSongSuggestions] = useState<TrackMetadataSuggestion[]>([]);
  const [searchingSong, setSearchingSong] = useState(false);

  const [mbArtistQuery, setMbArtistQuery] = useState(
    initialArtist === "Unknown Artist" || initialArtist === "Various Artists"
      ? (firstTrack?.artist ?? "")
      : initialArtist,
  );
  const [mbAlbumQuery, setMbAlbumQuery] = useState(initialAlbum);
  const [candidates, setCandidates] = useState<MusicBrainzReleaseCandidate[]>(initialCandidates);
  const [searchingMb, setSearchingMb] = useState(false);
  const [loadingMbid, setLoadingMbid] = useState<string | null>(null);
  const [selectedMbid, setSelectedMbid] = useState<string | null>(null);
  const [selectedArtistMbid, setSelectedArtistMbid] = useState<string | null>(null);
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);

  const [artist, setArtist] = useState(initialArtist);
  const [album, setAlbum] = useState(initialAlbum);
  const [yearText, setYearText] = useState(initialYear ? String(initialYear) : "");
  const [genre, setGenre] = useState(initialGenre ?? "");
  const [tracks, setTracks] = useState<EditableTrackRow[]>(initialTracks);
  const [duplicateResolution, setDuplicateResolution] = useState<
    "replace" | "keep_both" | "skip"
  >("replace");

  const [pendingDiff, setPendingDiff] = useState<PendingSuggestionDiff | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useModalAccessibility(dialogRef, onClose);

  const openDiffPreview = (diff: PendingSuggestionDiff) => {
    const initialChecked: Record<string, boolean> = {};
    for (const entry of diff.entries) {
      initialChecked[entry.key] = entry.isDifferent;
    }
    setPendingDiff(diff);
    setCheckedKeys(initialChecked);
    setAppliedNotice(null);
  };

  const handleSearchSong = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!songTitleQuery.trim() && !songArtistQuery.trim()) return;
    setSearchingSong(true);
    setError(null);
    setPendingDiff(null);
    try {
      const res = await lookupImportTrack({
        provider: songProvider,
        title: songTitleQuery.trim() || undefined,
        artist: songArtistQuery.trim() || undefined,
      });
      setSongSuggestions(res);
      if (res.length === 0) {
        setError("No matching songs found. Try adjusting the song title or artist.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Song lookup failed");
    } finally {
      setSearchingSong(false);
    }
  };

  const handleSelectSongSuggestion = (s: TrackMetadataSuggestion) => {
    const f = s.fields;
    const entries: PendingDiffEntry[] = [];
    const targetTrack = tracks[0];

    const pushField = (
      key: string,
      label: string,
      cur: string,
      sug: string | null | undefined,
      apply: () => void,
    ) => {
      const cleanSug = (sug ?? "").trim();
      if (!cleanSug) return;
      entries.push({
        key,
        label,
        currentValue: cur,
        suggestedValue: cleanSug,
        isEmptyCurrent: !cur.trim() || cur === "Unknown Artist" || cur === "Various Artists",
        isDifferent: cur.trim() !== cleanSug,
        apply,
      });
    };

    const sugArtist = f.albumArtist?.trim() || f.artists?.trim() || "";
    const sugTrackArtist = f.artists?.trim() || sugArtist;

    pushField("albumArtist", "Album Artist", artist, sugArtist, () => setArtist(sugArtist));
    pushField("album", "Album", album, f.album, () => setAlbum(f.album!.trim()));
    if (f.year) {
      const yStr = String(f.year);
      pushField("year", "Year", yearText, yStr, () => setYearText(yStr));
    }
    if (f.genres) {
      pushField("genre", "Genre", genre, f.genres, () => setGenre(f.genres!.trim()));
    }
    if (targetTrack) {
      if (f.title) {
        pushField("track-0-title", "Song Title", targetTrack.title, f.title, () =>
          updateTrack(0, { title: f.title!.trim() }),
        );
      }
      if (sugTrackArtist) {
        pushField("track-0-artist", "Track Artist", targetTrack.artist, sugTrackArtist, () =>
          updateTrack(0, { artist: sugTrackArtist }),
        );
      }
      if (f.trackNumber) {
        pushField(
          "track-0-num",
          "Track #",
          targetTrack.trackNumber ? String(targetTrack.trackNumber) : "",
          String(f.trackNumber),
          () => updateTrack(0, { trackNumber: f.trackNumber! }),
        );
      }
      if (f.discNumber) {
        pushField(
          "track-0-disc",
          "Disc #",
          targetTrack.discNumber ? String(targetTrack.discNumber) : "",
          String(f.discNumber),
          () => updateTrack(0, { discNumber: f.discNumber! }),
        );
      }
    }

    openDiffPreview({
      sourceLabel: `${s.provider.toUpperCase()}: ${s.title} — ${s.subtitle}`,
      coverArtUrl: s.coverArtUrl,
      mbid: f.musicBrainzReleaseId ?? null,
      artistMbid: f.musicBrainzArtistId ?? null,
      entries,
    });
  };

  const handleSearchMusicBrainz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mbArtistQuery.trim() && !mbAlbumQuery.trim()) return;

    setSearchingMb(true);
    setError(null);
    setPendingDiff(null);
    try {
      const res = await searchMusicBrainz({
        artist: mbArtistQuery.trim() || undefined,
        album: mbAlbumQuery.trim() || undefined,
        trackCount: tracks.length > 1 ? tracks.length : undefined,
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

  const handleSelectAlbumCandidate = async (candidate: MusicBrainzReleaseCandidate) => {
    setLoadingMbid(candidate.mbid);
    setError(null);
    try {
      const detail = await fetchMusicBrainzRelease(candidate.mbid);
      const entries: PendingDiffEntry[] = [];

      const pushField = (
        key: string,
        label: string,
        cur: string,
        sug: string,
        apply: () => void,
      ) => {
        if (!sug.trim()) return;
        entries.push({
          key,
          label,
          currentValue: cur,
          suggestedValue: sug.trim(),
          isEmptyCurrent: !cur.trim() || cur === "Unknown Artist" || cur === "Various Artists",
          isDifferent: cur.trim() !== sug.trim(),
          apply,
        });
      };

      pushField("albumArtist", "Album Artist", artist, detail.artist, () => setArtist(detail.artist));
      pushField("album", "Album", album, detail.title, () => setAlbum(detail.title));
      if (detail.year) {
        pushField("year", "Year", yearText, String(detail.year), () =>
          setYearText(String(detail.year)),
        );
      }

      // Smart Title-First matching so single tracks from compilations (like "Here" #8)
      // match "Here" on Know-It-All instead of blindly overwriting with Track #8 ("Overdose")!
      const usedIndices = new Set<number>();
      tracks.forEach((row, idx) => {
        const normRowTitle = normalizeTitle(row.title);
        let matchedIdx = detail.tracks.findIndex(
          (t, ti) =>
            !usedIndices.has(ti) &&
            normRowTitle.length > 0 &&
            (normalizeTitle(t.title) === normRowTitle ||
              normalizeTitle(t.title).includes(normRowTitle) ||
              normRowTitle.includes(normalizeTitle(t.title))),
        );

        // Only fall back to track position when matching a multi-track album
        if (matchedIdx === -1 && tracks.length > 1) {
          matchedIdx = detail.tracks.findIndex(
            (t, ti) =>
              !usedIndices.has(ti) &&
              row.trackNumber !== null &&
              t.trackNumber === row.trackNumber &&
              t.discNumber === (row.discNumber ?? 1),
          );
          if (matchedIdx === -1 && idx < detail.tracks.length && !usedIndices.has(idx)) {
            matchedIdx = idx;
          }
        }

        if (matchedIdx >= 0) {
          usedIndices.add(matchedIdx);
          const mbTrack = detail.tracks[matchedIdx]!;
          const labelPrefix = tracks.length === 1 ? "Song" : `Track ${idx + 1}`;
          pushField(`${idx}-title`, `${labelPrefix} Title`, row.title, mbTrack.title, () =>
            updateTrack(idx, {
              title: mbTrack.title,
              recordingMbid: mbTrack.recordingMbid,
            }),
          );
          pushField(
            `${idx}-artist`,
            `${labelPrefix} Artist`,
            row.artist,
            mbTrack.artist || detail.artist,
            () => updateTrack(idx, { artist: mbTrack.artist || detail.artist }),
          );
          pushField(
            `${idx}-num`,
            `${labelPrefix} #`,
            row.trackNumber ? String(row.trackNumber) : "",
            String(mbTrack.trackNumber),
            () =>
              updateTrack(idx, {
                trackNumber: mbTrack.trackNumber,
                discNumber: mbTrack.discNumber,
              }),
          );
        }
      });

      openDiffPreview({
        sourceLabel: `MusicBrainz: ${detail.artist} — ${detail.title}${detail.year ? ` (${detail.year})` : ""}`,
        coverArtUrl: candidate.coverArtUrl,
        mbid: detail.mbid,
        artistMbid: detail.artistMbid,
        entries,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load MusicBrainz release details");
    } finally {
      setLoadingMbid(null);
    }
  };

  const applySelectedDiff = () => {
    if (!pendingDiff) return;
    let appliedCount = 0;
    for (const entry of pendingDiff.entries) {
      if (checkedKeys[entry.key]) {
        entry.apply();
        appliedCount += 1;
      }
    }
    if (pendingDiff.mbid) setSelectedMbid(pendingDiff.mbid);
    if (pendingDiff.artistMbid) setSelectedArtistMbid(pendingDiff.artistMbid);
    if (pendingDiff.coverArtUrl) setSelectedCoverUrl(pendingDiff.coverArtUrl);

    setAppliedNotice(
      `Applied ${appliedCount} selected ${appliedCount === 1 ? "field" : "fields"}. Review below and click "${mode === "import" ? "Approve & Import" : "Save Tags"}" to write to disk.`,
    );
    setPendingDiff(null);
  };

  const selectedDiffCount = useMemo(() => {
    if (!pendingDiff) return 0;
    return pendingDiff.entries.filter((e) => checkedKeys[e.key]).length;
  }, [pendingDiff, checkedKeys]);

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
        coverArtUrl: selectedCoverUrl,
        duplicateResolution: duplicates.length > 0 ? duplicateResolution : "policy",
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
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl focus:outline-none"
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

          {appliedNotice && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>{appliedNotice}</span>
            </div>
          )}

          {/* Duplicate Alert & Resolution Picker */}
          {duplicates.length > 0 && (
            <section className="space-y-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs">
              <div className="flex items-center gap-2 font-semibold text-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-400" />
                Already in Your Library ({duplicates.length}{" "}
                {duplicates.length === 1 ? "track" : "tracks"})
              </div>
              <div className="space-y-1 text-amber-100/90">
                {duplicates.map((d) => {
                  const src = tracks.find((t) => t.filePath === d.sourceFilePath);
                  return (
                    <p key={d.sourceFilePath}>
                      <strong>{d.existingTitle}</strong> ({d.existingArtist}) — existing:{" "}
                      <code className="rounded bg-zinc-950/60 px-1 py-0.5">
                        {formatCodec(d.existingCodec)}
                        {d.existingBitrate ? ` · ${formatBitrate(d.existingBitrate)}` : ""}
                      </code>{" "}
                      → incoming:{" "}
                      <code className="rounded bg-zinc-950/60 px-1 py-0.5">
                        {formatCodec(src?.codec ?? null)}
                        {src?.bitrate ? ` · ${formatBitrate(src.bitrate)}` : ""}
                      </code>
                      {d.isUpgrade && (
                        <span className="ml-1.5 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                          Higher quality upgrade
                        </span>
                      )}
                    </p>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <span className="font-medium text-amber-200">On approve:</span>
                <label className="flex cursor-pointer items-center gap-1.5 text-amber-100">
                  <input
                    type="radio"
                    name="dupRes"
                    checked={duplicateResolution === "replace"}
                    onChange={() => setDuplicateResolution("replace")}
                    className="accent-amber-500"
                  />
                  Replace existing (archive old copy)
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-amber-100">
                  <input
                    type="radio"
                    name="dupRes"
                    checked={duplicateResolution === "skip"}
                    onChange={() => setDuplicateResolution("skip")}
                    className="accent-amber-500"
                  />
                  Skip duplicate
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-amber-100">
                  <input
                    type="radio"
                    name="dupRes"
                    checked={duplicateResolution === "keep_both"}
                    onChange={() => setDuplicateResolution("keep_both")}
                    className="accent-amber-500"
                  />
                  Keep both copies
                </label>
              </div>
            </section>
          )}

          {/* Step 1: Fetch Metadata (Song or Album) + Current -> Suggested Diff */}
          <section className="space-y-3 rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold tracking-wider text-zinc-300 uppercase">
                  1. Fetch Metadata
                </h4>
                {mode === "import" && (
                  <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setLookupTab("song");
                        setPendingDiff(null);
                      }}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                        lookupTab === "song"
                          ? "bg-amber-500 text-zinc-950"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Music className="h-3 w-3" />
                      Match Song
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLookupTab("album");
                        setPendingDiff(null);
                      }}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                        lookupTab === "album"
                          ? "bg-amber-500 text-zinc-950"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Disc3 className="h-3 w-3" />
                      Match Album
                    </button>
                  </div>
                )}
              </div>
              <span className="text-[11px] text-zinc-500">
                Pick a match to inspect Current → Suggested changes before applying
              </span>
            </div>

            {lookupTab === "song" ? (
              <div className="space-y-3">
                <form
                  onSubmit={(e) => void handleSearchSong(e)}
                  className="flex flex-wrap items-center gap-2"
                >
                  <select
                    value={songProvider}
                    onChange={(e) => setSongProvider(e.target.value as "deezer" | "musicbrainz")}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                  >
                    <option value="deezer">Deezer</option>
                    <option value="musicbrainz">MusicBrainz</option>
                  </select>
                  <input
                    type="text"
                    value={songTitleQuery}
                    onChange={(e) => setSongTitleQuery(e.target.value)}
                    placeholder="Song title (e.g. Here)"
                    className="min-w-[160px] flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={songArtistQuery}
                    onChange={(e) => setSongArtistQuery(e.target.value)}
                    placeholder="Artist (e.g. Alessia Cara)"
                    className="min-w-[150px] flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={searchingSong}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-45"
                  >
                    {searchingSong ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5" />
                    )}
                    Search Song
                  </button>
                </form>

                {songSuggestions.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {songSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleSelectSongSuggestion(s)}
                        className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5 text-left transition hover:border-amber-500/60 hover:bg-zinc-900"
                      >
                        {s.coverArtUrl ? (
                          <img
                            src={s.coverArtUrl}
                            alt={s.title}
                            className="h-11 w-11 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-500">
                            <Music className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-zinc-100">{s.title}</p>
                          <p className="truncate text-[11px] text-zinc-400">{s.subtitle}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <form
                  onSubmit={(e) => void handleSearchMusicBrainz(e)}
                  className="flex flex-wrap gap-2"
                >
                  <input
                    type="text"
                    value={mbArtistQuery}
                    onChange={(e) => setMbArtistQuery(e.target.value)}
                    placeholder="Artist name…"
                    className="min-w-[160px] flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={mbAlbumQuery}
                    onChange={(e) => setMbAlbumQuery(e.target.value)}
                    placeholder="Album title…"
                    className="min-w-[180px] flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={searchingMb}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-45"
                  >
                    {searchingMb ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5" />
                    )}
                    Search Album
                  </button>
                </form>

                {candidates.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {candidates.map((c) => {
                      const active = selectedMbid === c.mbid;
                      const busy = loadingMbid === c.mbid;
                      return (
                        <button
                          key={c.mbid}
                          type="button"
                          disabled={loadingMbid !== null}
                          onClick={() => void handleSelectAlbumCandidate(c)}
                          className={`flex items-center gap-3 rounded-lg border p-2.5 text-left transition ${
                            active
                              ? "border-amber-500/70 bg-amber-500/10"
                              : "border-zinc-800 bg-zinc-900/70 hover:border-zinc-700 hover:bg-zinc-900"
                          }`}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                            ) : (
                              <Disc3 className="h-5 w-5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-zinc-100">{c.title}</p>
                            <p className="truncate text-[11px] text-zinc-400">
                              {c.artist}
                              {c.year ? ` · ${c.year}` : ""}
                            </p>
                            <p className="mt-0.5 text-[10px] text-zinc-500">
                              {c.trackCount} tracks
                              {c.country ? ` · ${c.country}` : ""}
                              {c.score ? ` · ${Math.round(c.score)}% match` : ""}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Current -> Suggested Selective Diff Panel */}
            {pendingDiff && (
              <div className="space-y-3 rounded-xl border border-amber-500/35 bg-zinc-900/90 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-amber-300">
                      Review Suggested Changes
                    </p>
                    <p className="text-[11px] text-zinc-400">{pendingDiff.sourceLabel}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        pendingDiff.entries.forEach((e) => {
                          next[e.key] = true;
                        });
                        setCheckedKeys(next);
                      }}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        pendingDiff.entries.forEach((e) => {
                          next[e.key] = e.isEmptyCurrent;
                        });
                        setCheckedKeys(next);
                      }}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700"
                    >
                      Fill Empty Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckedKeys({})}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-zinc-800/70 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/60">
                  {pendingDiff.entries.map((entry) => (
                    <label
                      key={entry.key}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs hover:bg-zinc-900/60"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(checkedKeys[entry.key])}
                        onChange={(e) =>
                          setCheckedKeys((prev) => ({
                            ...prev,
                            [entry.key]: e.target.checked,
                          }))
                        }
                        className="h-3.5 w-3.5 rounded accent-amber-500"
                      />
                      <span className="w-28 shrink-0 font-medium text-zinc-400">{entry.label}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-400 line-through decoration-red-400/60">
                        {entry.currentValue || "—"}
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-zinc-600" />
                      <span
                        className={`min-w-0 flex-1 truncate font-medium ${
                          entry.isDifferent ? "text-emerald-300" : "text-zinc-400"
                        }`}
                      >
                        {entry.suggestedValue}
                      </span>
                    </label>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingDiff(null)}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    Dismiss Preview
                  </button>
                  <button
                    type="button"
                    disabled={selectedDiffCount === 0}
                    onClick={applySelectedDiff}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-45"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Apply Selected ({selectedDiffCount})
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Step 2: Album-level Metadata */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold tracking-wider text-zinc-300 uppercase">
              2. Album Metadata
            </h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">Album Artist</span>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">Album Title</span>
                <input
                  type="text"
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">Year</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={yearText}
                  onChange={(e) => setYearText(e.target.value)}
                  placeholder="e.g. 2015"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">Genre (optional)</span>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="e.g. Pop"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                />
              </label>
            </div>
          </section>

          {/* Step 3: Per-track overrides */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold tracking-wider text-zinc-300 uppercase">
                3. {tracks.length === 1 ? "Song Tag" : `Tracks (${tracks.length})`}
              </h4>
              <span className="text-[11px] text-zinc-500">
                Tags will be written directly into each audio file on save
              </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
              <div className="grid grid-cols-[56px_56px_minmax(0,1.4fr)_minmax(0,1fr)] gap-2 border-b border-zinc-800 px-3 py-2 text-[10px] font-medium tracking-wider text-zinc-500 uppercase">
                <span>Disc</span>
                <span>Track</span>
                <span>Song Title</span>
                <span>Track Artist</span>
              </div>
              <div className="divide-y divide-zinc-800/60">
                {tracks.map((row, idx) => (
                  <div
                    key={row.filePath}
                    className="grid grid-cols-[56px_56px_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-2 px-3 py-2"
                  >
                    <input
                      type="number"
                      min={1}
                      value={row.discNumber ?? 1}
                      onChange={(e) =>
                        updateTrack(idx, {
                          discNumber: e.target.value ? Number.parseInt(e.target.value, 10) : 1,
                        })
                      }
                      aria-label={`Disc number for ${row.basename}`}
                      className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                    />
                    <input
                      type="number"
                      min={1}
                      value={row.trackNumber ?? idx + 1}
                      onChange={(e) =>
                        updateTrack(idx, {
                          trackNumber: e.target.value
                            ? Number.parseInt(e.target.value, 10)
                            : idx + 1,
                        })
                      }
                      aria-label={`Track number for ${row.basename}`}
                      className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                    />
                    <div className="min-w-0">
                      <input
                        type="text"
                        value={row.title}
                        onChange={(e) => updateTrack(idx, { title: e.target.value })}
                        className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                      />
                      <p className="mt-0.5 truncate text-[10px] text-zinc-500" title={row.basename}>
                        {row.basename}
                      </p>
                    </div>
                    <input
                      type="text"
                      value={row.artist}
                      onChange={(e) => updateTrack(idx, { artist: e.target.value })}
                      className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 focus:border-amber-500/60 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/60 px-6 py-4">
          <p className="text-xs text-zinc-500">
            {mode === "import"
              ? "Writes clean tags, organizes into Artist/Album, and backfills matching playlists."
              : "Rewrites embedded audio tags in place and re-indexes the album."}
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
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
                  ? "Approve & Import"
                  : "Save Tags"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
