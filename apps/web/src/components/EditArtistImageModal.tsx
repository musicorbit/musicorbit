import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, Search, Trash2, Upload, X } from "lucide-react";
import type { ArtistImageCandidate } from "@musicorbit/shared";
import {
  deleteArtistImage,
  fetchArtistImageCandidates,
  selectArtistImageFromUrl,
  uploadArtistImage,
} from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

interface EditArtistImageModalProps {
  artistId: number;
  artistName: string;
  currentImageHash: string | null;
  onClose: () => void;
  onUpdated: (newImageHash: string | null) => void;
}

function formatFans(fans: number): string {
  if (fans >= 1_000_000) return `${(fans / 1_000_000).toFixed(1)}M fans`;
  if (fans >= 1_000) return `${(fans / 1_000).toFixed(1)}K fans`;
  return `${fans} fans`;
}

export function EditArtistImageModal({
  artistId,
  artistName,
  currentImageHash,
  onClose,
  onUpdated,
}: EditArtistImageModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<"deezer" | "upload">("deezer");
  const [query, setQuery] = useState(artistName);
  const [candidates, setCandidates] = useState<ArtistImageCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  useModalAccessibility(dialogRef, onClose);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const runSearch = useCallback(
    async (searchText: string) => {
      setSearching(true);
      setError(null);
      try {
        const res = await fetchArtistImageCandidates(artistId, searchText);
        setCandidates(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load Deezer candidates");
      } finally {
        setSearching(false);
      }
    },
    [artistId],
  );

  // Auto-search with the artist's name on open
  useEffect(() => {
    void runSearch(artistName);
  }, [artistName, runSearch]);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Clean up object URL when file changes or modal unmounts
  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const handleSelectCandidate = async (candidate: ArtistImageCandidate) => {
    setSavingId(candidate.id);
    setError(null);
    try {
      const updated = await selectArtistImageFromUrl(artistId, candidate.imageUrl);
      onUpdated(updated.imageHash);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save selected portrait");
    } finally {
      setSavingId(null);
    }
  };

  const handleFileChange = (file: File | null) => {
    setError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Please select a JPEG, PNG, WebP, or GIF image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be 5 MB or smaller.");
      return;
    }
    setSelectedFile(file);
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await uploadArtistImage(artistId, selectedFile);
      onUpdated(updated.imageHash);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const updated = await deleteArtistImage(artistId);
      onUpdated(updated.imageHash);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove portrait");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Change Artist Picture"
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-50">Change Artist Picture</h3>
            <p className="text-xs text-zinc-400">{artistName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-800 bg-zinc-950/40 px-5 py-2">
          <button
            type="button"
            onClick={() => {
              setTab("deezer");
              setError(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === "deezer"
                ? "bg-zinc-800 text-zinc-50"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Pick from Deezer
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("upload");
              setError(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === "upload"
                ? "bg-zinc-800 text-zinc-50"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Upload Photo
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {tab === "deezer" ? (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSearch(query);
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search artist name on Deezer…"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-3 pl-9 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="rounded-lg bg-zinc-800 px-3.5 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-45"
                >
                  Search
                </button>
              </form>

              {searching ? (
                <div className="flex items-center justify-center py-12 text-sm text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-400" />
                  Searching Deezer…
                </div>
              ) : candidates.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">
                  No portraits found. Try another spelling or upload a photo instead.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {candidates.map((candidate) => {
                    const busy = savingId === candidate.id;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        disabled={savingId !== null}
                        onClick={() => void handleSelectCandidate(candidate)}
                        className="group flex flex-col items-center rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 text-center transition hover:border-amber-500/50 hover:bg-zinc-800/60 disabled:opacity-50"
                      >
                        <div className="relative h-24 w-24 overflow-hidden rounded-full ring-1 ring-zinc-700">
                          <img
                            src={candidate.previewUrl}
                            alt={candidate.name}
                            className="h-full w-full object-cover"
                          />
                          {busy && (
                            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70">
                              <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                            </div>
                          )}
                        </div>
                        <p className="mt-2.5 w-full truncate text-xs font-medium text-zinc-100 group-hover:text-amber-300 group-focus-visible:text-amber-300">
                          {candidate.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          {formatFans(candidate.fans)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-zinc-950/50 px-6 py-8 text-center transition hover:border-amber-500/60 hover:bg-zinc-950"
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Selected preview"
                    className="h-28 w-28 rounded-full object-cover ring-2 ring-amber-500/50"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-400 ring-1 ring-zinc-800">
                    <Upload className="h-5 w-5" />
                  </div>
                )}
                <p className="mt-3 text-sm font-medium text-zinc-200">
                  {selectedFile ? selectedFile.name : "Choose an image file"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">JPEG, PNG, WebP, or GIF up to 5 MB</p>
              </button>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!selectedFile || uploading}
                  onClick={() => void handleUploadSubmit()}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {uploading ? "Uploading…" : "Save Picture"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/40 px-5 py-3">
          {currentImageHash ? (
            <button
              type="button"
              disabled={removing}
              onClick={() => void handleRemove()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-45"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {removing ? "Removing…" : "Remove picture"}
            </button>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
