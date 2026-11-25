import { useEffect, useState } from "react";
import { ArrowLeft, Camera } from "lucide-react";
import type { ArtistDetailResponse } from "@musicorbit/shared";
import { fetchArtistDetail } from "../api/client";
import { ArtistAvatar } from "../components/ArtistAvatar";
import { EditArtistImageModal } from "../components/EditArtistImageModal";
import { AlbumsView } from "./AlbumsView";
import { TracksView } from "./TracksView";

interface ArtistDetailViewProps {
  artistId: number;
  onBack: () => void;
  onSelectAlbum: (albumId: number) => void;
  onSelectArtist: (artistId: number) => void;
  onGoToScanner: () => void;
  onArtistImageChanged: () => void;
  onPlaylistsChanged?: () => void;
}

export function ArtistDetailView({
  artistId,
  onBack,
  onSelectAlbum,
  onSelectArtist,
  onGoToScanner,
  onArtistImageChanged,
  onPlaylistsChanged,
}: ArtistDetailViewProps) {
  const [detail, setDetail] = useState<ArtistDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchArtistDetail(artistId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load artist");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artistId]);

  if (loading) {
    return <p className="text-sm text-zinc-400">Loading artist…</p>;
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="text-sm text-red-400">{error ?? "Artist not found"}</p>
      </div>
    );
  }

  const { artist, albums, tracks } = detail;

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Artists
      </button>

      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => setEditModalOpen(true)}
          title="Change artist picture"
          aria-label={`Change picture for ${artist.name}`}
          className="group relative shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-amber-500/70"
        >
          <ArtistAvatar
            artistId={artist.id}
            name={artist.name}
            imageHash={artist.imageHash}
            fallbackAlbumId={artist.fallbackAlbumId}
            className="h-24 w-24 shadow-lg"
            textClassName="text-3xl"
          />
          <span className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-zinc-950/65 text-zinc-100 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100">
            <Camera className="h-5 w-5" />
            <span className="mt-1 text-[10px] font-medium">Edit</span>
          </span>
        </button>
        <div>
          <p className="text-xs font-medium tracking-wider text-amber-400 uppercase">Artist</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-50">
            {artist.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
            <span>
              {artist.albumCount > 0 && (
                <>
                  {artist.albumCount} {artist.albumCount === 1 ? "album" : "albums"} ·{" "}
                </>
              )}
              {artist.trackCount} {artist.trackCount === 1 ? "track" : "tracks"}
            </span>
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-0.5 text-xs text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Camera className="h-3 w-3" />
              Edit picture
            </button>
          </div>
        </div>
      </div>

      {editModalOpen && (
        <EditArtistImageModal
          artistId={artist.id}
          artistName={artist.name}
          currentImageHash={artist.imageHash}
          onClose={() => setEditModalOpen(false)}
          onUpdated={(newImageHash) => {
            setDetail((prev) =>
              prev ? { ...prev, artist: { ...prev.artist, imageHash: newImageHash } } : prev,
            );
            onArtistImageChanged();
          }}
        />
      )}

      {albums.length > 0 && (
        <div>
          <h3 className="mb-4 text-sm font-medium tracking-wider text-zinc-400 uppercase">
            Albums
          </h3>
          <AlbumsView
            albums={albums}
            loading={false}
            searchQuery=""
            onSelectAlbum={onSelectAlbum}
            onSelectArtist={onSelectArtist}
            onGoToScanner={onGoToScanner}
          />
        </div>
      )}

      {tracks.length > 0 && (
        <div>
          <h3 className="mb-4 text-sm font-medium tracking-wider text-zinc-400 uppercase">
            {albums.length > 0 ? "Tracks" : "Appears On"}
          </h3>
          <TracksView
            tracks={tracks}
            loading={false}
            searchQuery=""
            onSelectAlbum={onSelectAlbum}
            onSelectArtist={onSelectArtist}
            onGoToScanner={onGoToScanner}
            onTrackMetadataSaved={() => {
              onArtistImageChanged();
              void fetchArtistDetail(artistId).then(setDetail).catch(() => onBack());
            }}
            onPlaylistsChanged={onPlaylistsChanged}
          />
        </div>
      )}
    </div>
  );
}
