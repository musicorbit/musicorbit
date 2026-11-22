import { useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import type { ImportM3u8Response, PlaylistImportFormat } from "@musicorbit/shared";
import { importPlaylistFile } from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

interface ImportPlaylistModalProps {
  onClose: () => void;
  onImported: (result: ImportM3u8Response) => void;
}

export function ImportPlaylistModal({ onClose, onImported }: ImportPlaylistModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [playlistName, setPlaylistName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [format, setFormat] = useState<PlaylistImportFormat | null>(null);
  const [content, setContent] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useModalAccessibility(dialogRef, onClose);

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;
    setError(null);
    const lower = file.name.toLowerCase();
    const detected: PlaylistImportFormat = lower.endsWith(".csv") ? "csv" : "m3u8";
    const text = await file.text();
    const cleanedName = file.name.replace(/\.(m3u8|m3u|csv)$/i, "").replace(/_/g, " ").trim();

    setFileName(file.name);
    setFormat(detected);
    setContent(text);
    if (!playlistName.trim()) {
      setPlaylistName(cleanedName || "Imported Playlist");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !playlistName.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importPlaylistFile(
        playlistName.trim(),
        content,
        format ?? undefined,
      );
      onImported(res);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import playlist");
    } finally {
      setImporting(false);
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
        aria-label="Import Playlist"
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Upload className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-50">Import Playlist</h3>
              <p className="text-xs text-zinc-400">
                Upload a <code className="text-zinc-300">.csv</code> or{" "}
                <code className="text-zinc-300">.m3u8</code> playlist file.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import modal"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-5">
          {/* Spotify / Exportify tip */}
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3.5 text-xs text-emerald-100">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="space-y-1">
              <p className="font-medium text-emerald-200">Importing from Spotify?</p>
              <p className="leading-relaxed text-emerald-100/85">
                Use{" "}
                <a
                  href="https://exportify.net"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-emerald-300 underline decoration-emerald-400/50 underline-offset-2 hover:text-emerald-200"
                >
                  exportify.net
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                to download any Spotify playlist (including private playlists &amp; Liked Songs) as
                a <code>.csv</code> file, then upload it here. Songs not in your library yet will be
                listed so you can search &amp; download them on Soulseek.
              </p>
            </div>
          </div>

          {/* File drop / select zone */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".m3u8,.m3u,.csv,text/csv,audio/x-mpegurl"
              onChange={(e) => {
                void handleFileSelected(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
              className="hidden"
            />

            <button
              type="button"
              data-autofocus
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-zinc-950/60 px-4 py-7 text-center transition hover:border-amber-500/60 hover:bg-zinc-950"
            >
              {fileName ? (
                <>
                  {format === "csv" ? (
                    <FileSpreadsheet className="h-8 w-8 text-emerald-400" />
                  ) : (
                    <FileText className="h-8 w-8 text-amber-400" />
                  )}
                  <p className="mt-2 text-sm font-medium text-zinc-100">{fileName}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Detected format:{" "}
                    <span className="font-semibold text-amber-300 uppercase">{format}</span> · Click
                    to pick a different file
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-7 w-7 text-zinc-400" />
                  <p className="mt-2 text-sm font-medium text-zinc-200">
                    Choose a <code>.csv</code> or <code>.m3u8</code> file
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Supports Exportify CSV, Soundiiz CSV, and standard #EXTM3U (.m3u8)
                  </p>
                </>
              )}
            </button>
          </div>

          {/* Playlist name */}
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-300">Playlist Name</span>
            <input
              type="text"
              required
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              placeholder="e.g. Road Trip Favorites"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={importing || !content.trim() || !playlistName.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {importing ? "Importing…" : "Import Playlist"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
