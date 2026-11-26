import fs from "node:fs";
import path from "node:path";

export interface ShowcaseSlide {
  slug: string;
  title: string;
  caption: string;
  src: string;
  isPlaceholder: boolean;
}

const SLIDE_DEFINITIONS = [
  {
    slug: "01-library-albums",
    title: "Albums Library",
    caption: "Fast album grid with cover art, search, and persistent lossless player bar",
  },
  {
    slug: "02-album-detail",
    title: "Album Details & Tracklist",
    caption: "Full tracklist, bitrate & format badges, missing-track check, and quick actions",
  },
  {
    slug: "03-sing-along-lyrics",
    title: "Synced Sing-Along Lyrics",
    caption: "Full-screen karaoke view with smooth timed LRC highlighting via LRCLIB",
  },
  {
    slug: "04-metadata-editor",
    title: "Metadata & Diff Picker",
    caption: "Edit tags on disk or cherry-pick suggestions from Deezer, MusicBrainz, and LRCLIB",
  },
  {
    slug: "05-playlists",
    title: "Playlists & .m3u8 Sync",
    caption: "Custom playlist covers, Spotify CSV import, and automatic .m3u8 sync on disk",
  },
  {
    slug: "06-upload-organize",
    title: "Upload & Library Organizer",
    caption: "Drag-and-drop browser uploads, folder presets, and safe dry-run previews",
  },
  {
    slug: "07-users-admin",
    title: "Multi-User & Isolation",
    caption: "Per-user private music folders, role controls, and account management",
  },
  {
    slug: "08-activity-logs",
    title: "Activity Logs & Diagnostics",
    caption: "Real-time scan, upload, transcode, and import diagnostics with JSON export",
  },
] as const;

const SCREENSHOTS_DIR = path.resolve(process.cwd(), "public/screenshots");
const PREFERRED_EXTS = [".webp", ".png", ".jpg", ".jpeg", ".svg"] as const;

export function getShowcaseSlides(): ShowcaseSlide[] {
  return SLIDE_DEFINITIONS.map((def) => {
    let chosenExt: string = ".svg";
    for (const ext of PREFERRED_EXTS) {
      if (fs.existsSync(path.join(SCREENSHOTS_DIR, `${def.slug}${ext}`))) {
        chosenExt = ext;
        break;
      }
    }
    return {
      slug: def.slug,
      title: def.title,
      caption: def.caption,
      src: `/screenshots/${def.slug}${chosenExt}`,
      isPlaceholder: chosenExt === ".svg",
    };
  });
}
