import { useEffect, useState } from "react";
import { Disc3 } from "lucide-react";
import { getAlbumCoverUrl } from "../api/client";

interface AlbumCoverProps {
  albumId: number;
  coverHash?: string | null;
  alt: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Renders cached album artwork from /api/albums/:id/cover, falling back cleanly
 * to a vinyl disc placeholder when no artwork is embedded or present in the folder.
 */
export function AlbumCover({
  albumId,
  coverHash,
  alt,
  className = "aspect-square w-full rounded-lg",
  iconClassName = "h-10 w-10",
}: AlbumCoverProps) {
  const [failed, setFailed] = useState(false);
  // If coverHash is explicitly provided, skip the request when null; if omitted (e.g. from TrackSummary), attempt loading.
  const src =
    coverHash === undefined
      ? `/api/albums/${albumId}/cover`
      : getAlbumCoverUrl(albumId, coverHash);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-600 ring-1 ring-inset ring-zinc-700/50 ${className}`}
      >
        <Disc3 className={iconClassName} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover bg-zinc-900 ring-1 ring-inset ring-zinc-800 ${className}`}
    />
  );
}
