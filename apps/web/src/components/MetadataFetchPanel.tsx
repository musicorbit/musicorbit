import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Disc3,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type {
  EditableTrackTags,
  MetadataProvider,
  TrackMetadataSuggestion,
} from "@musicorbit/shared";
import { lookupTrackMetadata } from "../api/client";

const FIELD_LABELS: Record<keyof EditableTrackTags, string> = {
  title: "Title",
  artists: "Track Artist(s)",
  albumArtist: "Album Artist",
  album: "Album",
  trackNumber: "Track #",
  trackTotal: "Total Tracks",
  discNumber: "Disc #",
  discTotal: "Total Discs",
  year: "Year",
  genres: "Genre(s)",
  composers: "Composer(s)",
  bpm: "BPM",
  grouping: "Grouping",
  publisher: "Publisher / Label",
  comment: "Comment",
  lyrics: "Lyrics",
  musicBrainzTrackId: "Recording MBID",
  musicBrainzReleaseId: "Release MBID",
  musicBrainzArtistId: "Artist MBID",
  musicBrainzReleaseArtistId: "Album Artist MBID",
};

const PROVIDERS: Array<{ id: MetadataProvider; label: string; hint: string }> = [
  { id: "deezer", label: "Deezer", hint: "Fast catalog, BPM, label, genres & cover art" },
  { id: "musicbrainz", label: "MusicBrainz", hint: "Canonical releases, track totals & MBIDs" },
  { id: "lrclib", label: "LRCLIB", hint: "Open-source song lyrics" },
];

function formatValue(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val).trim();
  if (s.length > 120) return `${s.slice(0, 120)}…`;
  return s;
}

function isEmptyValue(val: string | number | null | undefined): boolean {
  return val === null || val === undefined || String(val).trim() === "";
}

interface MetadataFetchPanelProps {
  trackId: number;
  currentTags: EditableTrackTags;
  onApplyFields: (
    patch: Partial<EditableTrackTags>,
    selectedCoverUrl: string | null,
    appliedKeys: Array<keyof EditableTrackTags>,
  ) => void;
  onClose: () => void;
}

/**
 * BookOrbit-style metadata lookup & selective field-by-field diff panel.
 * Lets the user fetch suggestions from Deezer, MusicBrainz, or LRCLIB,
 * compare Current vs. Suggested values, and accept only the fields they want.
 */
export function MetadataFetchPanel({
  trackId,
  currentTags,
  onApplyFields,
  onClose,
}: MetadataFetchPanelProps) {
  const [provider, setProvider] = useState<MetadataProvider>("deezer");
  const [titleQuery, setTitleQuery] = useState(currentTags.title);
  const [artistQuery, setArtistQuery] = useState(
    currentTags.artists || currentTags.albumArtist,
  );
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<TrackMetadataSuggestion[] | null>(null);
  const [selected, setSelected] = useState<TrackMetadataSuggestion | null>(null);
  const [checkedFields, setCheckedFields] = useState<Record<string, boolean>>({});
  const [includeCover, setIncludeCover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const diffRows = useMemo(() => {
    if (!selected) return [];
    const entries = Object.entries(selected.fields) as Array<
      [keyof EditableTrackTags, EditableTrackTags[keyof EditableTrackTags]]
    >;
    return entries
      .filter(([, suggestedVal]) => !isEmptyValue(suggestedVal))
      .map(([key, suggestedVal]) => {
        const currentVal = currentTags[key];
        const same =
          String(currentVal ?? "").trim().toLowerCase() ===
          String(suggestedVal ?? "").trim().toLowerCase();
        return {
          key,
          label: FIELD_LABELS[key],
          currentVal,
          suggestedVal,
          currentEmpty: isEmptyValue(currentVal),
          same,
        };
      })
      .filter((row) => !row.same);
  }, [selected, currentTags]);

  const handleSearch = async () => {
    if (!titleQuery.trim() && !artistQuery.trim()) return;
    setSearching(true);
    setError(null);
    setSelected(null);
    try {
      const res = await lookupTrackMetadata(trackId, {
        provider,
        title: titleQuery,
        artist: artistQuery,
        album: currentTags.album,
      });
      setSuggestions(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setSearching(false);
    }
  };

  const handlePickSuggestion = (item: TrackMetadataSuggestion) => {
    setSelected(item);
    // Default-check every differing field so the user can quickly uncheck anything they want to keep
    const nextChecked: Record<string, boolean> = {};
    for (const [k, suggestedVal] of Object.entries(item.fields)) {
      if (isEmptyValue(suggestedVal)) continue;
      const curVal = currentTags[k as keyof EditableTrackTags];
      const same =
        String(curVal ?? "").trim().toLowerCase() ===
        String(suggestedVal ?? "").trim().toLowerCase();
      if (!same) {
        nextChecked[k] = true;
      }
    }
    setCheckedFields(nextChecked);
    setIncludeCover(false);
  };

  const selectAll = () => {
    const next: Record<string, boolean> = {};
    for (const row of diffRows) next[row.key] = true;
    setCheckedFields(next);
  };

  const selectEmptyOnly = () => {
    const next: Record<string, boolean> = {};
    for (const row of diffRows) {
      next[row.key] = row.currentEmpty;
    }
    setCheckedFields(next);
    setIncludeCover(false);
  };

  const selectNone = () => {
    setCheckedFields({});
    setIncludeCover(false);
  };

  const selectedCount =
    diffRows.filter((r) => checkedFields[r.key]).length + (includeCover && selected?.coverArtUrl ? 1 : 0);

  const handleApply = () => {
    if (!selected) return;
    const patch: Partial<EditableTrackTags> = {};
    const appliedKeys: Array<keyof EditableTrackTags> = [];

    for (const row of diffRows) {
      if (!checkedFields[row.key]) continue;
      (patch as Record<string, unknown>)[row.key] = row.suggestedVal;
      appliedKeys.push(row.key);
    }

    onApplyFields(
      patch,
      includeCover && selected.coverArtUrl ? selected.coverArtUrl : null,
      appliedKeys,
    );
    setSelected(null);
  };

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/30 bg-zinc-950/75 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-amber-300 uppercase">
            <Sparkles className="h-3.5 w-3.5" />
            Fetch Metadata &amp; Compare Fields
          </h4>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Pick a provider, choose a matching track, then check only the fields you want to accept.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close fetch panel"
          className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Provider selector */}
      <div className="flex flex-wrap gap-1.5">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setProvider(p.id);
              setSuggestions(null);
              setSelected(null);
              setError(null);
            }}
            title={p.hint}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              provider === p.id
                ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Search inputs */}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          type="text"
          value={artistQuery}
          onChange={(e) => setArtistQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSearch();
            }
          }}
          placeholder="Artist…"
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
        />
        <input
          type="text"
          value={titleQuery}
          onChange={(e) => setTitleQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSearch();
            }
          }}
          placeholder="Track title…"
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
        />
        <button
          type="button"
          disabled={searching || (!titleQuery.trim() && !artistQuery.trim())}
          onClick={() => void handleSearch()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
        >
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          {searching ? "Fetching…" : "Fetch"}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Candidate results list */}
      {suggestions && !selected && (
        <div className="space-y-2">
          {suggestions.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-500">
              No matches found on {provider}. Try simplifying the artist or track title, or switch
              providers.
            </p>
          ) : (
            <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handlePickSuggestion(item)}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5 text-left transition hover:border-amber-500/50 hover:bg-zinc-900"
                >
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-800 text-zinc-500">
                    <Disc3 className="h-4 w-4" />
                    {item.coverArtUrl && (
                      <img
                        src={item.coverArtUrl}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-zinc-100">{item.title}</p>
                    <p className="truncate text-[11px] text-zinc-400">{item.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selective Field-by-Field Diff View */}
      {selected && (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-zinc-100">
                Diff: {selected.title}
              </p>
              <p className="truncate text-[11px] text-zinc-400">{selected.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={selectAll}
                className="rounded px-2 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-800"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={selectEmptyOnly}
                className="rounded px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-500/10"
              >
                Fill Empty Only
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="rounded px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-zinc-800"
              >
                Clear
              </button>
            </div>
          </div>

          {diffRows.length === 0 && !selected.coverArtUrl ? (
            <p className="py-3 text-center text-xs text-emerald-300">
              All returned fields already match your current metadata!
            </p>
          ) : (
            <div className="max-h-56 divide-y divide-zinc-800/70 overflow-y-auto">
              {diffRows.map((row) => (
                <label
                  key={row.key}
                  className="flex cursor-pointer items-start gap-2.5 py-2 text-xs hover:bg-zinc-800/30"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(checkedFields[row.key])}
                    onChange={(e) =>
                      setCheckedFields((prev) => ({ ...prev, [row.key]: e.target.checked }))
                    }
                    className="mt-0.5 rounded border-zinc-700 accent-amber-500"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-zinc-300">{row.label}</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span
                        className={
                          row.currentEmpty
                            ? "italic text-zinc-500"
                            : "line-through text-zinc-500"
                        }
                      >
                        {row.currentEmpty ? "(empty)" : formatValue(row.currentVal)}
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-zinc-600" />
                      <span className="font-medium text-emerald-300">
                        {formatValue(row.suggestedVal)}
                      </span>
                    </div>
                  </div>
                </label>
              ))}

              {selected.coverArtUrl && (
                <label className="flex cursor-pointer items-center gap-3 py-2 text-xs hover:bg-zinc-800/30">
                  <input
                    type="checkbox"
                    checked={includeCover}
                    onChange={(e) => setIncludeCover(e.target.checked)}
                    className="rounded border-zinc-700 accent-amber-500"
                  />
                  <img
                    src={selected.coverArtUrl}
                    alt=""
                    className="h-9 w-9 rounded-md object-cover ring-1 ring-zinc-700"
                  />
                  <div>
                    <span className="font-medium text-zinc-200">Replace Embedded Cover Art</span>
                    <p className="text-[11px] text-zinc-500">
                      Downloads and embeds artwork from {selected.provider} when you save
                    </p>
                  </div>
                </label>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-zinc-800 pt-2.5">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Reject / Back to results
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-45"
            >
              <Check className="h-3.5 w-3.5" />
              Apply Selected ({selectedCount})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
