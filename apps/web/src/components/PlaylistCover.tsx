import { useEffect, useState } from "react";
import { ListMusic } from "lucide-react";
import { getPlaylistCoverUrl } from "../api/client";
import { AlbumCover } from "./AlbumCover";

interface PlaylistCoverProps {
  playlistId: number;
  coverHash?: string | null;
  coverAlbumId?: number | null;
  alt: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Renders a playlist's custom cover image when set, falling back cleanly
 * to the first track's album cover or a styled placeholder icon.
 */
export function PlaylistCover({
  playlistId,
  coverHash,
  coverAlbumId,
  alt,
  className = "aspect-square w-full rounded-lg",
  iconClassName = "h-12 w-12",
}: PlaylistCoverProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [playlistId, coverHash]);

  if (coverHash && !imgFailed) {
    return (
      <img
        src={getPlaylistCoverUrl(playlistId, coverHash)}
        alt={alt}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className={`object-cover ${className}`}
      />
    );
  }

  if (coverAlbumId) {
    return (
      <AlbumCover
        albumId={coverAlbumId}
        alt={alt}
        className={className}
        iconClassName={iconClassName}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-600 ring-1 ring-inset ring-zinc-700/50 ${className}`}
    >
      <ListMusic className={iconClassName} />
    </div>
  );
}
