import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderUp,
  Loader2,
  Music,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { FinalizeUploadBatchResponse } from "@musicorbit/shared";
import {
  cancelUploadBatch,
  finalizeUploadBatch,
  startUploadBatch,
  uploadFileToBatch,
} from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";
import { formatBytes } from "../utils/format";

const AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav"]);
const EXTRA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".lrc"]);
const ALLOWED_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...EXTRA_EXTENSIONS]);

interface QueuedUploadFile {
  id: string;
  file: File;
  relativePath: string;
  isAudio: boolean;
  ext: string;
}

interface UploadMusicModalProps {
  onClose: () => void;
  onUploaded: () => void;
  onOpenReviewQueue?: () => void;
}

interface WebkitEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (file: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: WebkitEntryLike[]) => void, err?: (e: unknown) => void) => void;
  };
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

async function readAllDirectoryEntries(entry: WebkitEntryLike): Promise<WebkitEntryLike[]> {
  if (!entry.createReader) return [];
  const reader = entry.createReader();
  const collected: WebkitEntryLike[] = [];
  while (true) {
    const batch = await new Promise<WebkitEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    collected.push(...batch);
  }
  return collected;
}

async function traverseDroppedEntry(
  entry: WebkitEntryLike,
  prefix = "",
): Promise<Array<{ file: File; relativePath: string }>> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file!(resolve, reject);
    });
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return [{ file, relativePath: rel }];
  }
  if (entry.isDirectory) {
    const children = await readAllDirectoryEntries(entry);
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const out: Array<{ file: File; relativePath: string }> = [];
    for (const child of children) {
      const nested = await traverseDroppedEntry(child, nextPrefix);
      out.push(...nested);
    }
    return out;
  }
  return [];
}

export function UploadMusicModal({
  onClose,
  onUploaded,
  onOpenReviewQueue,
}: UploadMusicModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeBatchIdRef = useRef<string | null>(null);

  const [queued, setQueued] = useState<QueuedUploadFile[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [groupAsAlbum, setGroupAsAlbum] = useState(false);
  const [albumFolderName, setAlbumFolderName] = useState("");

  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "done">("idle");
  const [currentFileIdx, setCurrentFileIdx] = useState(0);
  const [currentFileName, setCurrentFileName] = useState("");
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinalizeUploadBatchResponse | null>(null);

  const isBusy = phase === "uploading" || phase === "processing";
  useModalAccessibility(dialogRef, () => {
    if (!isBusy) onClose();
  });

  const audioFilesCount = useMemo(() => queued.filter((q) => q.isAudio).length, [queued]);
  const totalBytes = useMemo(() => queued.reduce((sum, q) => sum + q.file.size, 0), [queued]);
  const hasLooseMultipleAudio = useMemo(() => {
    const looseAudio = queued.filter((q) => q.isAudio && !q.relativePath.includes("/"));
    return looseAudio.length >= 2;
  }, [queued]);

  const appendCandidates = (entries: Array<{ file: File; relativePath: string }>) => {
    let ignored = 0;
    const nextItems: QueuedUploadFile[] = [];

    for (const { file, relativePath } of entries) {
      const ext = getExtension(file.name);
      if (!ALLOWED_EXTENSIONS.has(ext) || file.name.startsWith(".")) {
        ignored += 1;
        continue;
      }
      nextItems.push({
        id: `${relativePath}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        relativePath,
        isAudio: AUDIO_EXTENSIONS.has(ext),
        ext: ext.slice(1).toUpperCase(),
      });
    }

    if (ignored > 0) {
      setIgnoredCount((prev) => prev + ignored);
    }

    if (nextItems.length > 0) {
      setQueued((prev) => {
        const seen = new Set(prev.map((p) => `${p.relativePath}:${p.file.size}`));
        const deduped = nextItems.filter((n) => !seen.has(`${n.relativePath}:${n.file.size}`));
        return [...prev, ...deduped];
      });
      setError(null);
      setResult(null);
      setPhase("idle");
    }
  };

  const handleFileInputChange = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const entries = Array.from(files).map((file) => {
      const webkitPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return {
        file,
        relativePath: webkitPath && webkitPath.trim() ? webkitPath : file.name,
      };
    });
    appendCandidates(entries);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (isBusy) return;

    const dtItems = e.dataTransfer.items;
    if (dtItems && dtItems.length > 0) {
      const entries: Array<{ file: File; relativePath: string }> = [];
      for (const item of Array.from(dtItems)) {
        const webkitEntry = (
          item as DataTransferItem & { webkitGetAsEntry?: () => WebkitEntryLike | null }
        ).webkitGetAsEntry?.();
        if (webkitEntry) {
          const walked = await traverseDroppedEntry(webkitEntry);
          entries.push(...walked);
        } else {
          const f = item.getAsFile();
          if (f) entries.push({ file: f, relativePath: f.name });
        }
      }
      appendCandidates(entries);
      return;
    }

    handleFileInputChange(e.dataTransfer.files);
  };

  const handleCancelUpload = () => {
    abortRef.current?.abort();
    const bid = activeBatchIdRef.current;
    if (bid) {
      void cancelUploadBatch(bid);
      activeBatchIdRef.current = null;
    }
    setPhase("idle");
    setError("Upload cancelled.");
  };

  const handleStartUpload = async () => {
    if (audioFilesCount === 0) {
      setError("Please add at least one supported audio file (FLAC, MP3, M4A, AAC, OGG, Opus, WAV).");
      return;
    }

    setError(null);
    setResult(null);
    setPhase("uploading");
    setUploadedBytes(0);
    setCurrentFileIdx(0);

    const controller = new AbortController();
    abortRef.current = controller;

    let batchId: string | null = null;
    try {
      const session = await startUploadBatch();
      batchId = session.batchId;
      activeBatchIdRef.current = batchId;

      const folderPrefix =
        hasLooseMultipleAudio && groupAsAlbum
          ? albumFolderName.trim() || "Uploaded Album"
          : null;

      let completedBytes = 0;

      for (let i = 0; i < queued.length; i++) {
        const item = queued[i]!;
        setCurrentFileIdx(i + 1);
        setCurrentFileName(item.file.name);

        const targetRelPath =
          folderPrefix && !item.relativePath.includes("/")
            ? `${folderPrefix}/${item.relativePath}`
            : item.relativePath;

        await uploadFileToBatch(
          batchId,
          item.file,
          targetRelPath,
          (loaded) => {
            setUploadedBytes(completedBytes + loaded);
          },
          controller.signal,
        );
        completedBytes += item.file.size;
        setUploadedBytes(completedBytes);
      }

      setPhase("processing");
      const finalized = await finalizeUploadBatch(batchId);
      activeBatchIdRef.current = null;
      setResult(finalized);
      setPhase("done");
      setQueued([]);
      setIgnoredCount(0);
      onUploaded();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (batchId) {
        void cancelUploadBatch(batchId);
        activeBatchIdRef.current = null;
      }
      setError(err instanceof Error ? err.message : "Upload failed");
      setPhase("idle");
    } finally {
      abortRef.current = null;
    }
  };

  const uploadPct =
    totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Upload Music to MusicOrbit"
        tabIndex={-1}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Upload className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-50">Upload Songs or Album</h3>
              <p className="text-xs text-zinc-400">
                Stream songs straight from your browser — MusicOrbit tags, formats into your
                library layout, fetches synced lyrics, and updates playlists automatically.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            aria-label="Close upload modal"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.jpg,.jpeg,.png,.webp,.lrc,audio/*"
            onChange={(e) => {
              handleFileInputChange(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory is standard in Chromium/Safari/Firefox for folder uploads
            webkitdirectory=""
            directory=""
            onChange={(e) => {
              handleFileInputChange(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />

          {/* Drag & Drop Zone */}
          {!isBusy && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => void handleDrop(e)}
              className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
                dragOver
                  ? "border-amber-400 bg-amber-500/10"
                  : "border-zinc-700/80 bg-zinc-950/50 hover:border-zinc-600"
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
                <FolderUp className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Drag &amp; drop songs or an entire album folder here
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Supports FLAC, MP3, M4A, AAC, OGG, Opus, WAV (+ optional cover art &amp;{" "}
                  <code>.lrc</code> lyrics)
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
                >
                  <Music className="h-3.5 w-3.5" />
                  Select Songs
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                >
                  <FolderUp className="h-3.5 w-3.5 text-amber-400" />
                  Select Album Folder
                </button>
              </div>
            </div>
          )}

          {/* Optional grouping for multiple loose songs */}
          {hasLooseMultipleAudio && !isBusy && (
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 text-xs">
              <label className="flex cursor-pointer items-start gap-2.5 text-zinc-200">
                <input
                  type="checkbox"
                  checked={groupAsAlbum}
                  onChange={(e) => setGroupAsAlbum(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-amber-500"
                />
                <span>
                  <strong className="block font-medium">
                    Group these loose songs as one album
                  </strong>
                  <span className="text-zinc-500">
                    Leave unchecked to match each song independently (best for mixed singles). Check
                    if these files belong to the same album.
                  </span>
                </span>
              </label>

              {groupAsAlbum && (
                <input
                  type="text"
                  value={albumFolderName}
                  onChange={(e) => setAlbumFolderName(e.target.value)}
                  placeholder="Optional album hint, e.g. Dua Lipa - Future Nostalgia (2020)"
                  aria-label="Album hint name"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                />
              )}
            </div>
          )}

          {/* Queued file list */}
          {queued.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>
                  <strong className="text-zinc-200">{audioFilesCount}</strong>{" "}
                  {audioFilesCount === 1 ? "audio file" : "audio files"}
                  {queued.length > audioFilesCount
                    ? ` + ${queued.length - audioFilesCount} extra`
                    : ""}{" "}
                  · {formatBytes(totalBytes)}
                  {ignoredCount > 0 ? ` (${ignoredCount} unsupported ignored)` : ""}
                </span>
                {!isBusy && (
                  <button
                    type="button"
                    onClick={() => {
                      setQueued([]);
                      setIgnoredCount(0);
                    }}
                    className="text-zinc-400 hover:text-red-300"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="max-h-52 divide-y divide-zinc-800/70 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60 text-xs">
                {queued.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[11px] text-zinc-200">
                        {item.relativePath}
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 ring-1 ring-zinc-800">
                      {item.ext}
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-[11px] text-zinc-500">
                      {formatBytes(item.file.size)}
                    </span>
                    {!isBusy && (
                      <button
                        type="button"
                        onClick={() => setQueued((prev) => prev.filter((q) => q.id !== item.id))}
                        aria-label={`Remove ${item.file.name}`}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Upload / Processing Progress */}
          {isBusy && (
            <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-zinc-200">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" />
                  <span className="truncate">
                    {phase === "uploading"
                      ? `Uploading ${currentFileIdx} of ${queued.length}: ${currentFileName}`
                      : "Matching metadata, organizing files & fetching lyrics…"}
                  </span>
                </span>
                {phase === "uploading" && (
                  <span className="shrink-0 font-mono text-amber-300">{uploadPct}%</span>
                )}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full transition-all duration-200 ${
                    phase === "processing" ? "w-full animate-pulse bg-emerald-400" : "bg-amber-400"
                  }`}
                  style={phase === "uploading" ? { width: `${uploadPct}%` } : undefined}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Completion Summary */}
          {result && (
            <div className="space-y-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-100">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <div>
                  <p className="font-semibold">
                    Uploaded {result.uploadedFiles}{" "}
                    {result.uploadedFiles === 1 ? "file" : "files"} successfully!
                  </p>
                  <p className="mt-1 text-emerald-200/85">
                    Auto-imported: <strong>{result.autoImported}</strong> · Sent to Review Queue:{" "}
                    <strong>{result.needsReview}</strong> · Skipped:{" "}
                    <strong>{result.skipped}</strong> · Failed: <strong>{result.failed}</strong>
                  </p>
                </div>
              </div>
              {result.needsReview > 0 && onOpenReviewQueue && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenReviewQueue();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Open Review Queue ({result.needsReview})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3.5">
          {phase === "uploading" ? (
            <button
              type="button"
              onClick={handleCancelUpload}
              className="rounded-lg border border-red-500/40 bg-red-500/15 px-3.5 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/25"
            >
              Cancel Upload
            </button>
          ) : (
            <button
              type="button"
              disabled={phase === "processing"}
              onClick={onClose}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-45"
            >
              {result ? "Done" : "Cancel"}
            </button>
          )}

          {!isBusy && queued.length > 0 && (
            <button
              type="button"
              disabled={audioFilesCount === 0}
              onClick={() => void handleStartUpload()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload &amp; Import ({audioFilesCount})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
