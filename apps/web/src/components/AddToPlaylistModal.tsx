import { useEffect, useRef, useState } from "react";
import { Check, ListMusic, Loader2, Plus, X } from "lucide-react";
import type { PlaylistSummary, TrackSummary } from "@musicorbit/shared";
import { addTracksToPlaylist, createPlaylist, fetchPlaylists } from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

interface AddToPlaylistModalProps {
  track: TrackSummary;
  onClose: () => void;
  onChanged: () => void;
}

export function AddToPlaylistModal({ track, onClose, onChanged }: AddToPlaylistModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [addedId, setAddedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useModalAccessibility(dialogRef, onClose);

  useEffect(() => {
    void fetchPlaylists()
      .then(setPlaylists)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load playlists"),
      )
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async (playlistId: number) => {
    setBusyId(playlistId);
    setError(null);
    try {
      await addTracksToPlaylist(playlistId, [track.id]);
      setAddedId(playlistId);
      onChanged();
      window.setTimeout(onClose, 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add track");
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusyId("new");
    setError(null);
    try {
      const created = await createPlaylist(newName.trim());
      await addTracksToPlaylist(created.id, [track.id]);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create playlist");
    } finally {
      setBusyId(null);
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
        aria-label="Add to Playlist"
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-50">Add to Playlist</h3>
            <p className="mt-0.5 truncate text-xs text-zinc-400">
              {track.title} — {track.artistName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <p className="text-xs text-red-400">{error}</p>}

          {loading ? (
            <p className="py-4 text-center text-xs text-zinc-400">Loading playlists…</p>
          ) : playlists.length === 0 ? (
            <p className="py-2 text-xs text-zinc-500">
              No playlists yet. Create your first one below!
            </p>
          ) : (
            <div className="max-h-52 divide-y divide-zinc-800/60 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/50">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void handleAdd(pl.id)}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition hover:bg-zinc-800/60"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ListMusic className="h-4 w-4 shrink-0 text-amber-400" />
                    <span className="truncate font-medium text-zinc-100">{pl.name}</span>
                  </span>
                  <span className="ml-2 shrink-0 text-xs text-zinc-500">
                    {busyId === pl.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    ) : addedId === pl.id ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      `${pl.trackCount} tracks`
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={(e) => void handleCreateAndAdd(e)} className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New playlist name…"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newName.trim() || busyId !== null}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" />
              Create &amp; Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
