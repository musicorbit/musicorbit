import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Folder,
  FolderOpen,
  Loader2,
  X,
} from "lucide-react";
import type { BrowseDirectoriesResponse } from "@musicorbit/shared";
import { browseServerDirectories, updateMusicDirectory } from "../api/client";

interface DirectoryPickerModalProps {
  initialPath: string;
  onClose: () => void;
  onSaved: (newPath: string, scannedNow: boolean) => void;
}

export function DirectoryPickerModal({
  initialPath,
  onClose,
  onSaved,
}: DirectoryPickerModalProps) {
  const [data, setData] = useState<BrowseDirectoriesResponse | null>(null);
  const [pathInput, setPathInput] = useState(initialPath);
  const [scanNow, setScanNow] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleConfirm = async () => {
    const chosen = pathInput.trim();
    if (!chosen) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMusicDirectory(chosen, scanNow);
      onSaved(updated.musicDir, scanNow);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save music directory");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-50">Select Music Directory</h3>
              <p className="text-xs text-zinc-400">
                Browse folders on this server or enter a path directly. Saved automatically across
                restarts.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close folder picker"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-5">
          {/* Quick Shortcuts */}
          {data && data.quickPaths.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {data.quickPaths.map((qp) => (
                <button
                  key={qp.path}
                  type="button"
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

          {/* Direct path input + Up button */}
          <form onSubmit={handleGoToInput} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!data?.parentPath || loading}
              onClick={() => data?.parentPath && void loadPath(data.parentPath)}
              title="Go up one folder"
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-35"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              Up
            </button>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/path/to/your/music"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-45"
            >
              Open
            </button>
          </form>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Subdirectories list */}
          <div className="min-h-[220px] flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-xs text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                Loading folders…
              </div>
            ) : !data?.exists ? (
              <div className="px-4 py-10 text-center text-xs text-amber-300">
                Folder not found or unreadable. Check the path above or pick a shortcut.
              </div>
            ) : data.directories.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-zinc-500">
                No subfolders inside this directory. You can still select this folder if your audio
                files are directly inside it.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/60">
                {data.directories.map((dir) => (
                  <button
                    key={dir.path}
                    type="button"
                    onClick={() => void loadPath(dir.path)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs text-zinc-200 transition hover:bg-zinc-800/60"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-amber-400/80" />
                    <span className="truncate font-medium">{dir.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/50 px-5 py-3.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={scanNow}
              onChange={(e) => setScanNow(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-amber-500"
            />
            Scan this folder immediately after saving
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !pathInput.trim()}
              onClick={() => void handleConfirm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Use This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
