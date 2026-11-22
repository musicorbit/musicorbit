import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ListMusic, Play, Plus, Upload } from "lucide-react";
import type { ImportM3u8Response, PlaylistSummary } from "@musicorbit/shared";
import { createPlaylist, fetchPlaylistDetail, importM3u8Playlist } from "../api/client";
import { AlbumCover } from "../components/AlbumCover";
import { usePlayer } from "../context/PlayerContext";
import { formatTotalDuration } from "../utils/format";

interface PlaylistsViewProps {
  playlists: PlaylistSummary[];
  loading: boolean;
  onSelectPlaylist: (playlistId: number) => void;
  onPlaylistsChanged: () => void;
}

export function PlaylistsView({
  playlists,
  loading,
  onSelectPlaylist,
  onPlaylistsChanged,
}: PlaylistsViewProps) {
  const { playQueue } = usePlayer();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [importNotice, setImportNotice] = useState<ImportM3u8Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createPlaylist(newName.trim(), newDesc.trim());
      setNewName("");
      setNewDesc("");
      setCreating(false);
      onPlaylistsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create playlist");
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setImportNotice(null);
    try {
      const text = await file.text();
      const baseName = file.name.replace(/\.(m3u8|m3u)$/i, "").trim() || "Imported Playlist";
      const res = await importM3u8Playlist(baseName, text);
      setImportNotice(res);
      onPlaylistsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import .m3u8 playlist");
    }
  };

  const handleQuickPlay = async (e: React.MouseEvent, playlistId: number) => {
    e.stopPropagation();
    try {
      const detail = await fetchPlaylistDetail(playlistId);
      if (detail.tracks.length > 0) {
        playQueue(detail.tracks, 0);
      }
    } catch {
      // Non-fatal
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Playlists</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Create playlists or import/export standard{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">.m3u8</code>{" "}
            files compatible with Navidrome and Symfonium.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".m3u8,.m3u,audio/x-mpegurl"
            onChange={(e) => {
              void handleImportFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            <Upload className="h-4 w-4" />
            Import .m3u8
          </button>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            <Plus className="h-4 w-4" />
            New Playlist
          </button>
        </div>
      </div>

      {creating && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Playlist name (e.g. Favorites of the moment)"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional description…"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !newName.trim()}
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-45"
            >
              {saving ? "Creating…" : "Create Playlist"}
            </button>
          </div>
        </form>
      )}

      {importNotice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <div>
            <p className="font-medium">
              Imported &ldquo;{importNotice.playlist.name}&rdquo; — matched{" "}
              {importNotice.matchedCount}{" "}
              {importNotice.matchedCount === 1 ? "track" : "tracks"}
              {importNotice.unmatchedEntries.length > 0
                ? ` (${importNotice.unmatchedEntries.length} unmatched)`
                : ""}
              .
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {loading && playlists.length === 0 ? (
        <p className="text-sm text-zinc-400">Loading playlists…</p>
      ) : playlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800">
            <ListMusic className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-medium text-zinc-200">No playlists yet</h3>
          <p className="mt-1 max-w-md text-xs text-zinc-500">
            Create a playlist above, import an existing <code>.m3u8</code> file, or click the{" "}
            <strong>Add to playlist</strong> icon on any song in your library.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              onClick={() => onSelectPlaylist(pl.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectPlaylist(pl.id);
                }
              }}
              className="group flex flex-col rounded-xl border border-transparent bg-zinc-900/40 p-3 transition hover:border-zinc-800 hover:bg-zinc-900/80"
            >
              <div className="relative overflow-hidden rounded-lg">
                {pl.coverAlbumId ? (
                  <AlbumCover
                    albumId={pl.coverAlbumId}
                    alt={pl.name}
                    className="aspect-square w-full rounded-lg"
                    iconClassName="h-12 w-12"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-600 ring-1 ring-inset ring-zinc-700/50">
                    <ListMusic className="h-12 w-12" />
                  </div>
                )}

                {pl.trackCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => void handleQuickPlay(e, pl.id)}
                    aria-label={`Play ${pl.name}`}
                    className="absolute right-2.5 bottom-2.5 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-amber-500 text-zinc-950 opacity-0 shadow-lg transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105 hover:bg-amber-400"
                  >
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                  </button>
                )}
              </div>

              <div className="mt-3 min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-amber-300">
                  {pl.name}
                </p>
                {pl.description && (
                  <p className="mt-0.5 truncate text-xs text-zinc-400">{pl.description}</p>
                )}
                <p className="mt-1 text-[11px] text-zinc-500">
                  {pl.trackCount} {pl.trackCount === 1 ? "track" : "tracks"} ·{" "}
                  {formatTotalDuration(pl.totalDurationSeconds)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
