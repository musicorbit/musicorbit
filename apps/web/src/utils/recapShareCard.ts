import type { RecapResponse } from "@musicorbit/shared";
import { getAlbumCoverUrl } from "../api/client";

export type ShareCardFormat = "story" | "square";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function formatMinutesLabel(minutes: number): string {
  if (minutes >= 60) {
    const hrs = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem > 0 ? `${hrs.toLocaleString()}h ${rem}m` : `${hrs.toLocaleString()}h`;
  }
  return `${minutes.toLocaleString()} min`;
}

/**
 * Generates a high-resolution social-ready PNG image of a MusicOrbit Monthly or Yearly Recap
 * completely client-side (zero external services).
 */
export async function renderRecapShareCardBlob(
  recap: RecapResponse,
  format: ShareCardFormat = "story",
  username?: string,
): Promise<Blob> {
  const isStory = format === "story";
  const width = 1080;
  const height = isStory ? 1920 : 1080;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  // 1. Deep cosmic obsidian background + warm amber radial nebulae
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#070812");
  bg.addColorStop(0.5, "#0d0f1d");
  bg.addColorStop(1, "#09090b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const glow1 = ctx.createRadialGradient(width * 0.85, height * 0.12, 10, width * 0.85, height * 0.12, 620);
  glow1.addColorStop(0, "rgba(245, 158, 11, 0.28)");
  glow1.addColorStop(0.5, "rgba(245, 158, 11, 0.08)");
  glow1.addColorStop(1, "rgba(245, 158, 11, 0)");
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, width, height);

  const glow2 = ctx.createRadialGradient(width * 0.12, height * 0.85, 10, width * 0.12, height * 0.85, 560);
  glow2.addColorStop(0, "rgba(168, 85, 247, 0.16)");
  glow2.addColorStop(1, "rgba(168, 85, 247, 0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, width, height);

  // Subtle deterministic starfield dots
  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 85; i++) {
    const sx = nextRand() * width;
    const sy = nextRand() * height;
    const sr = 0.8 + nextRand() * 1.8;
    const alpha = 0.15 + nextRand() * 0.45;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Load top album/track cover art if available
  const heroAlbumId = recap.topAlbum?.albumId ?? recap.topTrack?.albumId ?? null;
  const heroCoverHash = recap.topAlbum?.coverHash ?? recap.topTrack?.coverHash ?? null;
  const coverSrc = heroAlbumId
    ? (getAlbumCoverUrl(heroAlbumId, heroCoverHash) ?? `/api/albums/${heroAlbumId}/cover`)
    : null;
  const coverImg = coverSrc ? await loadImage(coverSrc) : null;

  const padX = 76;
  const contentW = width - padX * 2;
  let y = isStory ? 92 : 62;

  // 2. Brand Header
  ctx.fillStyle = "rgba(245, 158, 11, 0.16)";
  drawRoundedRect(ctx, padX, y, 280, 44, 22);
  ctx.fill();
  ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#fbbf24";
  ctx.font = "700 20px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("MUSICORBIT RECAP", padX + 26, y + 29);

  if (username) {
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "500 22px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    const userLabel = `@${username}`;
    const uw = ctx.measureText(userLabel).width;
    ctx.fillText(userLabel, width - padX - uw, y + 30);
  }

  y += isStory ? 114 : 92;

  // Period Title
  ctx.fillStyle = "#fafafa";
  ctx.font = `800 ${isStory ? 66 : 52}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(truncateText(ctx, recap.label, contentW), padX, y);

  y += isStory ? 44 : 34;
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "500 26px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  const subtitle = recap.persona
    ? `${recap.persona.title} · Self-hosted listening summary`
    : "Self-hosted listening summary";
  ctx.fillText(truncateText(ctx, subtitle, contentW), padX, y);

  y += isStory ? 56 : 36;

  // 3. Hero Cover + Primary Metrics Card
  const heroCardH = isStory ? 340 : 250;
  drawRoundedRect(ctx, padX, y, contentW, heroCardH, 32);
  ctx.fillStyle = "rgba(24, 24, 27, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(63, 63, 70, 0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const coverSize = isStory ? 264 : 194;
  const coverX = padX + 34;
  const coverY = y + Math.round((heroCardH - coverSize) / 2);

  if (coverImg) {
    ctx.save();
    drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, 22);
    ctx.clip();
    ctx.drawImage(coverImg, coverX, coverY, coverSize, coverSize);
    ctx.restore();
  } else {
    drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, 22);
    const placeholderGrad = ctx.createLinearGradient(coverX, coverY, coverX + coverSize, coverY + coverSize);
    placeholderGrad.addColorStop(0, "#f59e0b");
    placeholderGrad.addColorStop(1, "#78350f");
    ctx.fillStyle = placeholderGrad;
    ctx.fill();
    ctx.fillStyle = "#18181b";
    ctx.font = "800 84px Inter, sans-serif";
    ctx.fillText("♫", coverX + coverSize / 2 - 28, coverY + coverSize / 2 + 28);
  }

  const heroTextX = coverX + coverSize + 36;
  const heroTextW = padX + contentW - heroTextX - 30;
  let hy = coverY + (isStory ? 40 : 30);

  ctx.fillStyle = "#f59e0b";
  ctx.font = "700 20px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("TIME LISTENED", heroTextX, hy);

  hy += isStory ? 62 : 48;
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${isStory ? 60 : 48}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(formatMinutesLabel(recap.totalMinutes), heroTextX, hy);

  hy += isStory ? 42 : 34;
  ctx.fillStyle = "#d4d4d8";
  ctx.font = "600 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(
    `${recap.totalPlays.toLocaleString()} plays · ${recap.uniqueArtists.toLocaleString()} artists`,
    heroTextX,
    hy,
  );

  if (recap.topTrack) {
    hy += isStory ? 62 : 42;
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "700 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("#1 SONG", heroTextX, hy);

    hy += 32;
    ctx.fillStyle = "#fafafa";
    ctx.font = "700 26px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(truncateText(ctx, recap.topTrack.title, heroTextW), heroTextX, hy);

    hy += 28;
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "500 21px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(
      truncateText(ctx, `${recap.topTrack.artistName} (${recap.topTrack.playCount} plays)`, heroTextW),
      heroTextX,
      hy,
    );
  }

  y += heroCardH + (isStory ? 40 : 28);

  // 4. Two-Column Top Artists & Top Tracks Cards
  const colGap = 28;
  const colW = (contentW - colGap) / 2;
  const listCount = isStory ? 5 : 4;
  const listCardH = isStory ? 520 : 350;

  const drawRankedCard = (
    x: number,
    cardY: number,
    title: string,
    items: Array<{ primary: string; secondary: string }>,
  ) => {
    drawRoundedRect(ctx, x, cardY, colW, listCardH, 28);
    ctx.fillStyle = "rgba(24, 24, 27, 0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(63, 63, 70, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#fbbf24";
    ctx.font = "700 20px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(title, x + 32, cardY + 48);

    const rowStart = cardY + (isStory ? 102 : 90);
    const rowStep = isStory ? 82 : 64;

    items.slice(0, listCount).forEach((item, idx) => {
      const ry = rowStart + idx * rowStep;
      ctx.fillStyle = idx === 0 ? "#fbbf24" : "#71717a";
      ctx.font = "800 26px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(`${idx + 1}`, x + 32, ry);

      ctx.fillStyle = "#fafafa";
      ctx.font = "700 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(truncateText(ctx, item.primary, colW - 102), x + 72, ry);

      ctx.fillStyle = "#a1a1aa";
      ctx.font = "500 19px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(truncateText(ctx, item.secondary, colW - 102), x + 72, ry + 26);
    });
  };

  drawRankedCard(
    padX,
    y,
    "TOP ARTISTS",
    recap.topArtists.map((a) => ({
      primary: a.artistName,
      secondary: `${a.playCount} plays · ${formatMinutesLabel(a.totalMinutes)}`,
    })),
  );

  drawRankedCard(
    padX + colW + colGap,
    y,
    "TOP SONGS",
    recap.topTracks.map((t) => ({
      primary: t.title,
      secondary: `${t.artistName} · ${t.playCount} plays`,
    })),
  );

  y += listCardH + (isStory ? 40 : 28);

  // 5. Bottom Highlights Strip (Story gets full extra cards; Square gets sleek 3-stat strip)
  const statStripH = isStory ? 185 : 124;
  const statColW = (contentW - colGap * 2) / 3;
  const topClient = recap.clients[0];
  const topGenre = recap.topGenres[0];

  const miniStats = [
    {
      label: "LONGEST STREAK",
      value: `${recap.longestStreakDays} ${recap.longestStreakDays === 1 ? "day" : "days"}`,
      sub: `${recap.activeDays} active days`,
    },
    {
      label: "TOP GENRE",
      value: topGenre?.genre ?? "Eclectic",
      sub: topGenre ? `${topGenre.percentage}% of plays` : `${recap.uniqueAlbums} albums`,
    },
    {
      label: "TOP APP",
      value: topClient?.clientName ?? "MusicOrbit",
      sub: topClient ? `${topClient.percentage}% of listens` : "Self-hosted",
    },
  ];

  miniStats.forEach((st, idx) => {
    const sx = padX + idx * (statColW + colGap);
    drawRoundedRect(ctx, sx, y, statColW, statStripH, 24);
    ctx.fillStyle = "rgba(24, 24, 27, 0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(63, 63, 70, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#a1a1aa";
    ctx.font = "700 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(st.label, sx + 26, y + (isStory ? 48 : 38));

    ctx.fillStyle = "#fafafa";
    ctx.font = `800 ${isStory ? 32 : 26}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText(truncateText(ctx, st.value, statColW - 52), sx + 26, y + (isStory ? 102 : 76));

    ctx.fillStyle = "#fbbf24";
    ctx.font = "500 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(truncateText(ctx, st.sub, statColW - 52), sx + 26, y + (isStory ? 142 : 104));
  });

  if (isStory && recap.topAlbum) {
    y += statStripH + 40;
    const albumBannerH = 196;
    drawRoundedRect(ctx, padX, y, contentW, albumBannerH, 28);
    ctx.fillStyle = "rgba(245, 158, 11, 0.1)";
    ctx.fill();
    ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#fbbf24";
    ctx.font = "700 19px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("#1 ALBUM ON REPEAT", padX + 34, y + 52);

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 38px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(truncateText(ctx, recap.topAlbum.albumTitle, contentW - 68), padX + 34, y + 108);

    ctx.fillStyle = "#d4d4d8";
    ctx.font = "500 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(
      truncateText(
        ctx,
        `${recap.topAlbum.artistName} · ${recap.topAlbum.playCount} plays (${formatMinutesLabel(recap.topAlbum.totalMinutes)})`,
        contentW - 68,
      ),
      padX + 34,
      y + 152,
    );
  }

  // 6. Footer Watermark
  const footerY = height - (isStory ? 76 : 40);
  ctx.fillStyle = "#71717a";
  ctx.font = "600 22px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("Self-hosted with MusicOrbit", padX, footerY);

  ctx.fillStyle = "#f59e0b";
  ctx.font = "700 22px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  const urlText = "musicorbit.app";
  const urlW = ctx.measureText(urlText).width;
  ctx.fillText(urlText, width - padX - urlW, footerY);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode recap image."));
    }, "image/png");
  });
}

export function buildRecapShareText(recap: RecapResponse): string {
  const lines = [
    `My ${recap.label} on MusicOrbit:`,
    `• ${formatMinutesLabel(recap.totalMinutes)} listened (${recap.totalPlays.toLocaleString()} plays across ${recap.uniqueArtists.toLocaleString()} artists)`,
  ];
  if (recap.topArtist) {
    lines.push(`• #1 Artist: ${recap.topArtist.artistName} (${recap.topArtist.playCount} plays)`);
  }
  if (recap.topTrack) {
    lines.push(
      `• #1 Song: ${recap.topTrack.title} — ${recap.topTrack.artistName} (${recap.topTrack.playCount} plays)`,
    );
  }
  if (recap.topAlbum) {
    lines.push(`• #1 Album: ${recap.topAlbum.albumTitle}`);
  }
  lines.push("Self-hosted on MusicOrbit (musicorbit.app)");
  return lines.join("\n");
}
