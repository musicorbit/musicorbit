import { Users } from "lucide-react";
import type { ArtistSummary } from "@musicorbit/shared";
import { ArtistAvatar } from "../components/ArtistAvatar";

interface ArtistsViewProps {
  artists: ArtistSummary[];
  loading: boolean;
  searchQuery: string;
  onSelectArtist: (artistId: number) => void;
  onGoToScanner: () => void;
}

export function ArtistsView({
  artists,
  loading,
  searchQuery,
  onSelectArtist,
  onGoToScanner,
}: ArtistsViewProps) {
  if (loading && artists.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-900" />
        ))}
      </div>
    );
  }

  if (artists.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800">
          <Users className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-medium text-zinc-200">
          {searchQuery ? `No artists matching "${searchQuery}"` : "No artists indexed yet"}
        </h3>
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {artists.map((artist) => (
        <button
          key={artist.id}
          type="button"
          onClick={() => onSelectArtist(artist.id)}
          className="group flex items-center gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-900"
        >
          <ArtistAvatar
            artistId={artist.id}
            name={artist.name}
            imageHash={artist.imageHash}
            fallbackAlbumId={artist.fallbackAlbumId}
            className="h-14 w-14"
            textClassName="text-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-amber-300">
              {artist.name}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {artist.albumCount} {artist.albumCount === 1 ? "album" : "albums"} ·{" "}
              {artist.trackCount} {artist.trackCount === 1 ? "track" : "tracks"}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
