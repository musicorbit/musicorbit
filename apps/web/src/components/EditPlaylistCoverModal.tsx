import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import type { AlbumSummary, PlaylistSummary, TrackSummary } from "@musicorbit/shared";
import {
  deletePlaylistCover,
  fetchAlbums,
  setPlaylistCoverFromAlbum,
  uploadPlaylistCover,
} from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";
import { AlbumCover } from "./AlbumCover";
import { PlaylistCover } from "./PlaylistCover";

interface EditPlaylistCoverModalProps {
  playlist: PlaylistSummary;
  playlistTracks: TrackSummary[];
  onClose: () => void;
  onUpdated: (updated: PlaylistSummary) => void;
}

export function EditPlaylistCoverModal({
  playlist,
  playlistTracks,
  onClose,
  onUpdated,
}: EditPlaylistCoverModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useModalAccessibility(dialogRef, onClose);

  useEffect(() => {
    void fetchAlbums()
      .then((all) => setAlbums(all.filter((a) => Boolean(a.coverHash))))
      .catch(() => {})
      .finally(() => setLoadingAlbums(false));
  }, []);

  // Show covers from tracks inside this playlist first, followed by other library albums
  const { playlistAlbums, otherAlbums } = useMemo(() => {
    const inPlaylistIds = new Set(playlistTracks.map((t) => t.albumId));
    const inPl: AlbumSummary[] = [];
    const rest: AlbumSummary[] = [];
    for (const album of albums) {
      if (inPlaylistIds.has(album.id)) inPl.push(album);
      else rest.push(album);
    }
    return { playlistAlbums: inPl, otherAlbums: rest };
  }, [albums, playlistTracks]);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      const updated = await uploadPlaylistCover(playlist.id, file);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload image");
    } finally {
      setBusy(null);
    }
  };

  const handlePickAlbum = async (albumId: number) => {
    setBusy(`album-${albumId}`);
    setError(null);
    try {
      const updated = await setPlaylistCoverFromAlbum(playlist.id, albumId);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply album artwork");
    } finally {
      setBusy(null);
    }
  };

  const handleReset = async () => {
    setBusy("reset");
    setError(null);
    try {
      const updated = await deletePlaylistCover(playlist.id);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset cover");
    } finally {
      setBusy(null);
    }
  };

  const renderAlbumGrid = (items: AlbumSummary[]) => (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {items.map((album) => {
        const isCurrent = Boolean(playlist.coverHash && album.coverHash === playlist.coverHash);
        const isSaving = busy === `album-${album.id}`;
        return (
          <button
            key={album.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void handlePickAlbum(album.id)}
            title={`${album.title} — ${album.artistName}`}
            className={`group relative flex flex-col overflow-hidden rounded-xl border p-1.5 text-left transition ${
              isCurrent
                ? "border-amber-500 bg-amber-500/10"
                : "border-zinc-800 bg-zinc-950/60 hover:border-amber-500/60 hover:bg-zinc-900"
            }`}
          >
            <div className="relative overflow-hidden rounded-lg">
              <AlbumCover
                albumId={album.id}
                coverHash={album.coverHash}
                alt={album.title}
                className="aspect-square w-full rounded-lg"
                iconClassName="h-8 w-8"
              />
              {isSaving && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                </div>
              )}
              {isCurrent && !isSaving && (
                <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-zinc-950 shadow">
                  <Check className="h-3 w-3 stroke-[3]" />
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-[11px] font-medium text-zinc-200">{album.title}</p>
            <p className="truncate text-[10px] text-zinc-500">{album.artistName}</p>
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Playlist Cover Image"
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ImageIcon className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-50">Playlist Cover Image</h3>
              <p className="text-xs text-zinc-400">
                Upload a custom image or choose artwork from your library for &ldquo;
                {playlist.name}&rdquo;.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cover picker"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Current preview + Upload / Reset actions */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <PlaylistCover
              playlistId={playlist.id}
              coverHash={playlist.coverHash}
              coverAlbumId={playlist.coverAlbumId}
              alt={playlist.name}
              className="h-20 w-20 shrink-0 rounded-xl"
              iconClassName="h-8 w-8"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs text-zinc-400">
                {playlist.coverHash
                  ? "Using a custom cover image."
                  : "Using automatic cover from the first track's album."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => {
                    void handleUpload(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  data-autofocus
                  disabled={busy !== null}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
                >
                  {busy === "upload" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Upload Image
                </button>

                {playlist.coverHash && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleReset()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-45"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset to Default
                  </button>
                )}
              </div>
              <p className="text-[11px] text-zinc-500">JPG, PNG, WebP, or GIF up to 5 MB.</p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Pick from library artwork */}
          {loadingAlbums ? (
            <p className="py-4 text-center text-xs text-zinc-400">Loading library artwork…</p>
          ) : albums.length === 0 ? (
            <p className="py-2 text-xs text-zinc-500">
              No album artwork found in your library yet — upload a custom image above.
            </p>
          ) : (
            <div className="space-y-4">
              {playlistAlbums.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium tracking-wider text-zinc-400 uppercase">
                    From This Playlist
                  </h4>
                  {renderAlbumGrid(playlistAlbums)}
                </div>
              )}

              {otherAlbums.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium tracking-wider text-zinc-400 uppercase">
                    From Your Library
                  </h4>
                  {renderAlbumGrid(otherAlbums)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
