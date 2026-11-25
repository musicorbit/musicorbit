import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  Folder,
  FolderInput,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type {
  BrowseDirectoriesResponse,
  BulkImportFolderResponse,
  ImportFileAction,
} from "@musicorbit/shared";
import { browseServerDirectories, bulkImportExternalFolder } from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

interface BulkImportFolderModalProps {
  initialPath: string;
  onClose: () => void;
  onImported: () => void;
  onOpenReviewQueue?: () => void;
}

export function BulkImportFolderModal({
  initialPath,
  onClose,
  onImported,
  onOpenReviewQueue,
}: BulkImportFolderModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<BrowseDirectoriesResponse | null>(null);
  const [pathInput, setPathInput] = useState(initialPath);
  const [fileAction, setFileAction] = useState<ImportFileAction>("copy");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportFolderResponse | null>(null);

  useModalAccessibility(dialogRef, onClose);

  const loadPath = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await browseServerDirectories(target);
      setData(res);
      setPathInput(res.currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not browse directories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPath(initialPath);
  }, [initialPath, loadPath]);

  const handleGoToInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) return;
    void loadPath(pathInput.trim());
  };

  const handleRunImport = async () => {
    const chosen = pathInput.trim();
    if (!chosen) return;
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const res = await bulkImportExternalFolder(chosen, fileAction);
      setResult(res);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk folder import failed");
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
        aria-label="Import Existing Music Folder"
        tabIndex={-1}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FolderInput className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-50">Import Existing Music Folder</h3>
              <p className="text-xs text-zinc-400">
                Tag and format an external folder of songs into your Music Directory using your
                chosen folder layout.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk import modal"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
          {/* Quick Shortcuts */}
          {data && data.quickPaths.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {data.quickPaths.map((qp) => (
                <button
                  key={qp.path}
                  type="button"
                  disabled={importing}
                  onClick={() => void loadPath(qp.path)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition ${
                    data.currentPath === qp.path
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                      : "border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800"
                  }`}
                >
                  {qp.label}
                </button>
              ))}
            </div>
          )}

          {/* Path navigation */}
          <form onSubmit={handleGoToInput} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!data?.parentPath || loading || importing}
              onClick={() => data?.parentPath && void loadPath(data.parentPath)}
              title="Up one folder"
              aria-label="Up one folder"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={pathInput}
              disabled={importing}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/path/to/your/existing/music"
              aria-label="Source folder path"
              className="h-9 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || importing}
              className="h-9 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-45"
            >
              Open
            </button>
          </form>

          {/* Subfolder browser */}
          <div className="min-h-[160px] max-h-[220px] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                Loading folders…
              </div>
            ) : data && data.directories.length > 0 ? (
              <div className="divide-y divide-zinc-800/50">
                {data.directories.map((dir) => (
                  <button
                    key={dir.path}
                    type="button"
                    disabled={importing}
                    onClick={() => void loadPath(dir.path)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs text-zinc-200 transition hover:bg-zinc-800/70"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-amber-400/80" />
                    <span className="truncate">{dir.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-xs text-zinc-500">
                No subfolders inside this directory (audio files here will still be imported).
              </p>
            )}
          </div>

          {/* Copy vs Move selector */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs transition ${
                fileAction === "copy"
                  ? "border-amber-500/50 bg-amber-500/10 text-zinc-100"
                  : "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="bulkFileAction"
                value="copy"
                checked={fileAction === "copy"}
                disabled={importing}
                onChange={() => setFileAction("copy")}
                className="mt-0.5 accent-amber-500"
              />
              <span>
                <strong className="block font-medium">Copy files (recommended)</strong>
                <span className="text-zinc-400">
                  Keeps your original source folder untouched as a backup.
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs transition ${
                fileAction === "move"
                  ? "border-amber-500/50 bg-amber-500/10 text-zinc-100"
                  : "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="bulkFileAction"
                value="move"
                checked={fileAction === "move"}
                disabled={importing}
                onChange={() => setFileAction("move")}
                className="mt-0.5 accent-amber-500"
              />
              <span>
                <strong className="block font-medium">Move files</strong>
                <span className="text-zinc-400">
                  Relocates imported songs into Music Directory and cleans empty subfolders.
                </span>
              </span>
            </label>
          </div>

          <p className="text-[11px] text-zinc-500">
            Confident matches are tagged and formatted into your Music Directory automatically.
            Uncertain albums or untagged tracks go safely to the Review Queue.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-100">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <div>
                  <p className="font-medium">
                    Scanned {result.discoveredFolders}{" "}
                    {result.discoveredFolders === 1 ? "item" : "items"} from{" "}
                    <code className="rounded bg-zinc-950/60 px-1 py-0.5">{result.sourceDir}</code>
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

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            {result ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={importing || !pathInput.trim()}
            onClick={() => void handleRunImport()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
          >
            {importing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <FolderInput className="h-3.5 w-3.5" />
                {fileAction === "copy" ? "Copy & Import Folder" : "Move & Import Folder"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
