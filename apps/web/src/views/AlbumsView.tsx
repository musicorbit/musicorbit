import { Disc3, Play } from "lucide-react";
import type { AlbumSummary } from "@musicorbit/shared";
import { fetchAlbumDetail } from "../api/client";
import { AlbumCover } from "../components/AlbumCover";
import { usePlayer } from "../context/PlayerContext";

interface AlbumsViewProps {
  albums: AlbumSummary[];
  loading: boolean;
  searchQuery: string;
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
  onGoToScanner: () => void;
}

export function AlbumsView({
  albums,
  loading,
  searchQuery,
  onSelectAlbum,
  onSelectArtist,
  onGoToScanner,
}: AlbumsViewProps) {
  const { playQueue } = usePlayer();

  const handleQuickPlay = async (e: React.MouseEvent, albumId: number) => {
    e.stopPropagation();
    try {
      const detail = await fetchAlbumDetail(albumId);
      if (detail.tracks.length > 0) {
        playQueue(detail.tracks, 0);
      }
    } catch {
      // Ignore transient errors on quick play
    }
  };

  if (loading && albums.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse space-y-2.5">
            <div className="aspect-square rounded-xl bg-zinc-900" />
            <div className="h-4 w-3/4 rounded bg-zinc-900" />
            <div className="h-3 w-1/2 rounded bg-zinc-900" />
          </div>
        ))}
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800">
          <Disc3 className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-medium text-zinc-200">
          {searchQuery ? `No albums matching "${searchQuery}"` : "Your library is empty"}
        </h3>
        <p className="mt-1 max-w-md text-sm text-zinc-500">
          {searchQuery
            ? "Try a different search term or clear the filter."
            : "Add audio files to your music directory and run a library scan to see your albums here."}
        </p>
        {!searchQuery && (
          <button
            type="button"
            onClick={onGoToScanner}
            className="mt-5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-amber-400"
          >
            Go to Library Scanner
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {albums.map((album) => (
        <div
          key={album.id}
          onClick={() => onSelectAlbum(album.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectAlbum(album.id);
            }
          }}
          className="group flex flex-col rounded-xl border border-transparent bg-zinc-900/35 p-3 transition hover:border-zinc-800 hover:bg-zinc-900/80"
        >
          <div className="relative overflow-hidden rounded-lg">
            <AlbumCover
              albumId={album.id}
              coverHash={album.coverHash}
              alt={album.title}
              className="aspect-square w-full rounded-lg transition duration-300 group-hover:scale-[1.02] group-focus-within:scale-[1.02]"
              iconClassName="h-12 w-12"
            />
            <button
              type="button"
              onClick={(e) => void handleQuickPlay(e, album.id)}
              aria-label={`Play ${album.title}`}
              className="absolute right-2.5 bottom-2.5 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-amber-500 text-zinc-950 opacity-0 shadow-lg transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 hover:scale-105 hover:bg-amber-400"
            >
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </button>
          </div>

          <div className="mt-3 min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-amber-300 group-focus-within:text-amber-300">
              {album.title}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectArtist(album.artistId);
                }}
                className="truncate hover:text-zinc-200 hover:underline"
              >
                {album.artistName}
              </button>
              {album.year != null && album.year > 0 && (
                <span className="shrink-0 text-zinc-500">· {album.year}</span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              {album.trackCount} {album.trackCount === 1 ? "track" : "tracks"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
