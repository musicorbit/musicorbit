import { useEffect, useState } from "react";

interface ArtistAvatarProps {
  artistId: number;
  name: string;
  imageHash?: string | null;
  fallbackAlbumId?: number | null;
  className?: string;
  textClassName?: string;
}

/**
 * Displays an artist's circular portrait with a 3-stage fallback chain:
 *   1. Cached/fetched artist portrait (/api/artists/:id/image)
 *   2. Artist's album artwork (/api/albums/:fallbackAlbumId/cover)
 *   3. Stylized initial monogram
 */
export function ArtistAvatar({
  artistId,
  name,
  imageHash,
  fallbackAlbumId,
  className = "h-12 w-12",
  textClassName = "text-base",
}: ArtistAvatarProps) {
  const [stage, setStage] = useState<"artist" | "album" | "monogram">("artist");

  useEffect(() => {
    setStage("artist");
  }, [artistId, imageHash, fallbackAlbumId]);

  const initial = name.trim().charAt(0).toUpperCase() || "?";

  if (stage === "artist") {
    const src = imageHash
      ? `/api/artists/${artistId}/image?v=${encodeURIComponent(imageHash)}`
      : `/api/artists/${artistId}/image`;

    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setStage(fallbackAlbumId ? "album" : "monogram")}
        className={`shrink-0 rounded-full bg-zinc-900 object-cover ring-1 ring-zinc-700/70 ${className}`}
      />
    );
  }

  if (stage === "album" && fallbackAlbumId) {
    return (
      <img
        src={`/api/albums/${fallbackAlbumId}/cover`}
        alt={name}
        loading="lazy"
        onError={() => setStage("monogram")}
        className={`shrink-0 rounded-full bg-zinc-900 object-cover ring-1 ring-zinc-700/70 ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-amber-500/15 font-semibold text-amber-400 ring-1 ring-amber-500/25 ${className} ${textClassName}`}
    >
      {initial}
    </div>
  );
}
