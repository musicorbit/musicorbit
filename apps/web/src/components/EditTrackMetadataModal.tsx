import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { EditableTrackTags, TrackMetadataResponse } from "@musicorbit/shared";
import {
  deleteTrackCover,
  embedTrackCoverFromUrl,
  fetchTrackMetadata,
  updateTrackMetadata,
  uploadTrackCover,
} from "../api/client";
import { formatBitrate, formatBytes, formatCodec, formatDuration } from "../utils/format";
import { AlbumCover } from "./AlbumCover";
import { MetadataFetchPanel } from "./MetadataFetchPanel";

interface EditTrackMetadataModalProps {
  trackId: number;
  onClose: () => void;
  onSaved: () => void;
}

function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function EditTrackMetadataModal({
  trackId,
  onClose,
  onSaved,
}: EditTrackMetadataModalProps) {
  const [meta, setMeta] = useState<TrackMetadataResponse | null>(null);
  const [form, setForm] = useState<EditableTrackTags | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);
  const [showMbIds, setShowMbIds] = useState(false);
  const [fetchOpen, setFetchOpen] = useState(false);
  const [pendingCoverUrl, setPendingCoverUrl] = useState<string | null>(null);
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchTrackMetadata(trackId)
      .then((res) => {
        if (cancelled) return;
        setMeta(res);
        setForm(res.tags);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load track metadata");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const setField = <K extends keyof EditableTrackTags>(key: K, value: EditableTrackTags[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.title.trim()) {
      setError("Track title is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let updated = await updateTrackMetadata(trackId, form);
      if (pendingCoverUrl) {
        updated = await embedTrackCoverFromUrl(trackId, pendingCoverUrl);
        setPendingCoverUrl(null);
      }
      setMeta(updated);
      setForm(updated.tags);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save metadata");
    } finally {
      setSaving(false);
    }
  };

  const handleCoverUpload = async (file: File | null) => {
    if (!file) return;
    setCoverBusy(true);
    setError(null);
    try {
      const updated = await uploadTrackCover(trackId, file);
      setMeta(updated);
      setCoverVersion((v) => v + 1);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not embed cover art");
    } finally {
      setCoverBusy(false);
    }
  };

  const handleCoverRemove = async () => {
    setCoverBusy(true);
    setError(null);
    try {
      const updated = await deleteTrackCover(trackId);
      setMeta(updated);
      setCoverVersion((v) => v + 1);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove embedded cover art");
    } finally {
      setCoverBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-50">
              <SlidersHorizontal className="h-4 w-4 text-amber-400" />
              Edit Track Metadata
            </h3>
            {meta && (
              <p className="mt-0.5 truncate text-xs text-zinc-400" title={meta.filePath}>
                {meta.basename}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {form && (
              <button
                type="button"
                onClick={() => setFetchOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  fetchOpen
                    ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                    : "border border-zinc-700 bg-zinc-800/80 text-zinc-100 hover:bg-zinc-800"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                Fetch Metadata
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close metadata editor"
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-zinc-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-400" />
            Reading embedded audio tags…
          </div>
        ) : !meta || !form ? (
          <div className="p-6 text-sm text-red-300">{error ?? "Could not load track metadata."}</div>
        ) : (
          <form onSubmit={(e) => void handleSave(e)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
              )}

              {appliedNotice && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
                  <span>{appliedNotice}</span>
                  <button
                    type="button"
                    onClick={() => setAppliedNotice(null)}
                    className="text-emerald-300/70 hover:text-emerald-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {fetchOpen && (
                <MetadataFetchPanel
                  trackId={trackId}
                  currentTags={form}
                  onClose={() => setFetchOpen(false)}
                  onApplyFields={(patch, selectedCoverUrl, appliedKeys) => {
                    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
                    if (selectedCoverUrl) {
                      setPendingCoverUrl(selectedCoverUrl);
                    }
                    const parts: string[] = [];
                    if (appliedKeys.length > 0) {
                      parts.push(
                        `Applied ${appliedKeys.length} ${appliedKeys.length === 1 ? "field" : "fields"}`,
                      );
                    }
                    if (selectedCoverUrl) {
                      parts.push("queued new cover art");
                    }
                    if (parts.length > 0) {
                      setAppliedNotice(
                        `${parts.join(" and ")} — review below and click Save Metadata to write to the file.`,
                      );
                    }
                    setFetchOpen(false);
                  }}
                />
              )}

              {/* Cover Art & Technical File Summary */}
              <div className="flex flex-col gap-4 rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <AlbumCover
                    key={coverVersion}
                    albumId={meta.albumId}
                    coverHash={meta.hasEmbeddedCover ? `v${coverVersion}` : null}
                    alt={form.album || form.title}
                    className="h-20 w-20 shrink-0 rounded-xl"
                    iconClassName="h-8 w-8"
                  />
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-zinc-200">Embedded Cover Art</p>
                    <p className="text-[11px] text-zinc-500">
                      {meta.hasEmbeddedCover
                        ? `${meta.embeddedCoverMime ?? "image"}${
                            meta.embeddedCoverSizeBytes
                              ? ` · ${formatBytes(meta.embeddedCoverSizeBytes)}`
                              : ""
                          }`
                        : "No embedded artwork"}
                    </p>
                    <div className="flex items-center gap-2 pt-0.5">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={(e) => void handleCoverUpload(e.target.files?.[0] ?? null)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={coverBusy}
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
                      >
                        <Upload className="h-3 w-3" />
                        {meta.hasEmbeddedCover ? "Replace" : "Embed Cover"}
                      </button>
                      {meta.hasEmbeddedCover && (
                        <button
                          type="button"
                          disabled={coverBusy}
                          onClick={() => void handleCoverRemove()}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-45"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Read-only Technical Info */}
                <div className="flex-1 border-t border-zinc-800/80 pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                  <p className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
                    Audio Stream Info
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-300">
                    <span className="rounded bg-zinc-900 px-2 py-0.5 ring-1 ring-zinc-800">
                      {formatCodec(meta.technical.codec)}
                    </span>
                    {meta.technical.bitrate && (
                      <span className="rounded bg-zinc-900 px-2 py-0.5 ring-1 ring-zinc-800">
                        {formatBitrate(meta.technical.bitrate)}
                      </span>
                    )}
                    {meta.technical.sampleRate && (
                      <span className="rounded bg-zinc-900 px-2 py-0.5 ring-1 ring-zinc-800">
                        {(meta.technical.sampleRate / 1000).toFixed(1)} kHz
                      </span>
                    )}
                    {meta.technical.bitsPerSample && (
                      <span className="rounded bg-zinc-900 px-2 py-0.5 ring-1 ring-zinc-800">
                        {meta.technical.bitsPerSample}-bit
                      </span>
                    )}
                    {meta.technical.durationSeconds && (
                      <span className="rounded bg-zinc-900 px-2 py-0.5 ring-1 ring-zinc-800">
                        {formatDuration(meta.technical.durationSeconds)}
                      </span>
                    )}
                    <span className="rounded bg-zinc-900 px-2 py-0.5 ring-1 ring-zinc-800">
                      {formatBytes(meta.fileSize)}
                    </span>
                  </div>
                  {meta.technical.tagTypes.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-zinc-500">
                      Tags: {meta.technical.tagTypes.join(", ")}
                    </p>
                  )}
                </div>
              </div>

              {/* Core Metadata */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                  Core Metadata
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 sm:col-span-2">
                    <span className="text-xs text-zinc-400">Title</span>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setField("title", e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Track Artist(s)</span>
                    <input
                      type="text"
                      value={form.artists}
                      onChange={(e) => setField("artists", e.target.value)}
                      placeholder="e.g. Adele"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Album Artist</span>
                    <input
                      type="text"
                      value={form.albumArtist}
                      onChange={(e) => setField("albumArtist", e.target.value)}
                      placeholder="Groups albums in your library"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Album</span>
                    <input
                      type="text"
                      value={form.album}
                      onChange={(e) => setField("album", e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Genre(s)</span>
                    <input
                      type="text"
                      value={form.genres}
                      onChange={(e) => setField("genres", e.target.value)}
                      placeholder="Pop, Soul"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Track #</span>
                    <input
                      type="number"
                      min={1}
                      value={form.trackNumber ?? ""}
                      onChange={(e) => setField("trackNumber", parseOptionalInt(e.target.value))}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Total Tracks</span>
                    <input
                      type="number"
                      min={1}
                      value={form.trackTotal ?? ""}
                      onChange={(e) => setField("trackTotal", parseOptionalInt(e.target.value))}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Disc #</span>
                    <input
                      type="number"
                      min={1}
                      value={form.discNumber ?? ""}
                      onChange={(e) => setField("discNumber", parseOptionalInt(e.target.value))}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Total Discs</span>
                    <input
                      type="number"
                      min={1}
                      value={form.discTotal ?? ""}
                      onChange={(e) => setField("discTotal", parseOptionalInt(e.target.value))}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Year</span>
                    <input
                      type="number"
                      min={1800}
                      max={2200}
                      value={form.year ?? ""}
                      onChange={(e) => setField("year", parseOptionalInt(e.target.value))}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                </div>
              </section>

              {/* Extended Metadata */}
              <section className="space-y-3 border-t border-zinc-800/80 pt-5">
                <h4 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                  Extended Metadata
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Composer(s)</span>
                    <input
                      type="text"
                      value={form.composers}
                      onChange={(e) => setField("composers", e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Publisher / Record Label</span>
                    <input
                      type="text"
                      value={form.publisher}
                      onChange={(e) => setField("publisher", e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">Grouping</span>
                    <input
                      type="text"
                      value={form.grouping}
                      onChange={(e) => setField("grouping", e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-400">BPM</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={form.bpm ?? ""}
                      onChange={(e) => setField("bpm", parseOptionalInt(e.target.value))}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1 sm:col-span-2">
                    <span className="text-xs text-zinc-400">Comment</span>
                    <input
                      type="text"
                      value={form.comment}
                      onChange={(e) => setField("comment", e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1 sm:col-span-2">
                    <span className="text-xs text-zinc-400">Lyrics</span>
                    <textarea
                      rows={3}
                      value={form.lyrics}
                      onChange={(e) => setField("lyrics", e.target.value)}
                      placeholder="Optional embedded lyrics…"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                </div>
              </section>

              {/* MusicBrainz Identifiers */}
              <section className="border-t border-zinc-800/80 pt-4">
                <button
                  type="button"
                  onClick={() => setShowMbIds((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-zinc-400 uppercase hover:text-zinc-200"
                >
                  {showMbIds ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  MusicBrainz Identifiers
                </button>

                {showMbIds && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-xs text-zinc-400">Recording / Track MBID</span>
                      <input
                        type="text"
                        value={form.musicBrainzTrackId}
                        onChange={(e) => setField("musicBrainzTrackId", e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-zinc-400">Release / Album MBID</span>
                      <input
                        type="text"
                        value={form.musicBrainzReleaseId}
                        onChange={(e) => setField("musicBrainzReleaseId", e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-zinc-400">Artist MBID</span>
                      <input
                        type="text"
                        value={form.musicBrainzArtistId}
                        onChange={(e) => setField("musicBrainzArtistId", e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-zinc-400">Album Artist MBID</span>
                      <input
                        type="text"
                        value={form.musicBrainzReleaseArtistId}
                        onChange={(e) => setField("musicBrainzReleaseArtistId", e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                      />
                    </label>
                  </div>
                )}
              </section>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/50 px-6 py-4">
              <p className="truncate text-xs text-zinc-500">
                Writes tags directly into the audio file and re-indexes SQLite.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {saving ? "Saving…" : "Save Metadata"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
