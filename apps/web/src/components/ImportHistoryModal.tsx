import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { HistoryImportResponse } from "@musicorbit/shared";
import { clearImportedHistory, importListeningHistoryFile } from "../api/client";

interface ImportHistoryModalProps {
  onClose: () => void;
  onImported: () => void;
}

interface AggregatedResult {
  filesProcessed: number;
  detectedSources: string[];
  totalEntries: number;
  importedCount: number;
  matchedLocalTracks: number;
  skippedShortOrNonMusic: number;
  deduplicatedCount: number;
  earliestPlayedAt: string | null;
  latestPlayedAt: string | null;
}

const SUPPORTED_EXTENSIONS = [".json", ".jsonl", ".csv"];

export function ImportHistoryModal({ onClose, onImported }: ImportHistoryModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [minSeconds, setMinSeconds] = useState(30);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [result, setResult] = useState<AggregatedResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => {
      const lower = f.name.toLowerCase();
      return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    });
    if (files.length === 0) {
      setError("Please select one or more .json, .jsonl, or .csv listening history files.");
      return;
    }

    setImporting(true);
    setError(null);
    setNotice(null);
    setResult(null);

    const sourcesSet = new Set<string>();
    const summary: AggregatedResult = {
      filesProcessed: 0,
      detectedSources: [],
      totalEntries: 0,
      importedCount: 0,
      matchedLocalTracks: 0,
      skippedShortOrNonMusic: 0,
      deduplicatedCount: 0,
      earliestPlayedAt: null,
      latestPlayedAt: null,
    };

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        setProgressText(`Importing ${file.name} (${i + 1} of ${files.length})…`);
        const content = await file.text();
        const res: HistoryImportResponse = await importListeningHistoryFile(
          content,
          file.name,
          minSeconds,
        );
        if (res.format === "unknown" && res.importedCount === 0) {
          throw new Error(
            `Could not recognize the history format in "${file.name}". Supported exports: Spotify JSON, Apple Music CSV, Last.fm CSV/JSON, and ListenBrainz JSON/JSONL.`,
          );
        }

        summary.filesProcessed++;
        res.detectedSources.forEach((s) => sourcesSet.add(s));
        summary.totalEntries += res.totalEntries;
        summary.importedCount += res.importedCount;
        summary.matchedLocalTracks += res.matchedLocalTracks;
        summary.skippedShortOrNonMusic += res.skippedShortOrNonMusic;
        summary.deduplicatedCount += res.deduplicatedCount;
        if (
          res.earliestPlayedAt &&
          (!summary.earliestPlayedAt || res.earliestPlayedAt < summary.earliestPlayedAt)
        ) {
          summary.earliestPlayedAt = res.earliestPlayedAt;
        }
        if (
          res.latestPlayedAt &&
          (!summary.latestPlayedAt || res.latestPlayedAt > summary.latestPlayedAt)
        ) {
          summary.latestPlayedAt = res.latestPlayedAt;
        }
      }

      summary.detectedSources = Array.from(sourcesSet);
      setResult(summary);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import listening history.");
    } finally {
      setImporting(false);
      setProgressText(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClearImported = async () => {
    setClearing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await clearImportedHistory();
      setResult(null);
      setNotice(
        res.deletedCount > 0
          ? `Removed ${res.deletedCount.toLocaleString()} imported plays (your Web & OpenSubsonic plays were untouched).`
          : "No imported plays to remove.",
      );
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear imported history.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={() => !importing && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
              <FileUp className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-50">Import Listening History</h3>
              <p className="text-xs text-zinc-400">
                Auto-detects Spotify, Apple Music, Last.fm, and ListenBrainz exports
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {/* Supported Sources */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-3.5 text-xs text-zinc-300">
            <p className="font-semibold text-zinc-100">Supported history exports (auto-detected):</p>
            <ul className="mt-1.5 space-y-1 text-zinc-400">
              <li>
                <strong className="text-zinc-200">Spotify:</strong>{" "}
                <code className="text-amber-300">StreamingHistory_music_*.json</code> &amp;{" "}
                <code className="text-amber-300">Streaming_History_Audio_*.json</code>
              </li>
              <li>
                <strong className="text-zinc-200">Apple Music:</strong>{" "}
                <code className="text-amber-300">Apple Music Play Activity.csv</code>
              </li>
              <li>
                <strong className="text-zinc-200">Last.fm:</strong> scrobble{" "}
                <code className="text-amber-300">.csv</code> or{" "}
                <code className="text-amber-300">.json</code> exports
              </li>
              <li>
                <strong className="text-zinc-200">ListenBrainz:</strong>{" "}
                <code className="text-amber-300">.json</code> or{" "}
                <code className="text-amber-300">.jsonl</code> listen exports
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-zinc-500">
              Safe to re-upload anytime — duplicates, podcasts, and short skips are filtered
              automatically, and OpenSubsonic apps (Amperfy, Arpeggi, Symfonium) sync automatically
              via scrobbling.
            </p>
          </div>

          {/* Minimum Play Length Selector */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-zinc-400">Ignore skips shorter than:</span>
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
              {[15, 30, 60].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  disabled={importing}
                  onClick={() => setMinSeconds(sec)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    minSeconds === sec
                      ? "bg-amber-500 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!importing && e.dataTransfer.files.length > 0) {
                void processFiles(e.dataTransfer.files);
              }
            }}
            className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-8 text-center transition ${
              dragging
                ? "border-amber-400 bg-amber-500/10"
                : "border-zinc-700/80 bg-zinc-900/35 hover:border-zinc-600"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.jsonl,.csv,application/json,text/csv"
              multiple
              disabled={importing}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  void processFiles(e.target.files);
                }
              }}
              className="hidden"
            />
            {importing ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
                <p className="mt-3 text-sm font-medium text-zinc-200">
                  {progressText ?? "Importing plays…"}
                </p>
              </>
            ) : (
              <>
                <Upload className="h-7 w-7 text-amber-400" />
                <p className="mt-2.5 text-sm font-medium text-zinc-100">
                  Drop your .json, .jsonl, or .csv export files here
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Select multiple files at once — everything stays private on your server
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
                >
                  Choose Export Files
                </button>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>{notice}</span>
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-100">
              <div className="flex flex-wrap items-center gap-2 font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Imported {result.importedCount.toLocaleString()} plays from{" "}
                  {result.filesProcessed} {result.filesProcessed === 1 ? "file" : "files"}
                  {result.detectedSources.length > 0
                    ? ` (${result.detectedSources.join(", ")})`
                    : ""}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-zinc-300">
                <div>
                  Linked to local library:{" "}
                  <strong className="text-zinc-100">
                    {result.matchedLocalTracks.toLocaleString()}
                  </strong>
                </div>
                <div>
                  Duplicates skipped:{" "}
                  <strong className="text-zinc-100">
                    {result.deduplicatedCount.toLocaleString()}
                  </strong>
                </div>
                <div>
                  Skips / non-music ignored:{" "}
                  <strong className="text-zinc-100">
                    {result.skippedShortOrNonMusic.toLocaleString()}
                  </strong>
                </div>
                {result.earliestPlayedAt && result.latestPlayedAt && (
                  <div className="truncate">
                    Span:{" "}
                    <strong className="text-zinc-100">
                      {result.earliestPlayedAt.slice(0, 10)} → {result.latestPlayedAt.slice(0, 10)}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-900/50 px-5 py-3">
          <button
            type="button"
            disabled={importing || clearing}
            onClick={() => void handleClearImported()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
          >
            {clearing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Clear Imported Plays
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
