import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const GITHUB_URL = "https://github.com/musicorbit/musicorbit";

export default defineConfig({
  site: "https://musicorbit.app",
  integrations: [
    starlight({
      title: "MusicOrbit",
      description:
        "Self-hosted, open-source music library, lossless browser player, synced lyrics, and metadata hub.",
      favicon: "/favicon.svg",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "MusicOrbit",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: GITHUB_URL,
        },
      ],
      editLink: {
        baseUrl: `${GITHUB_URL}/edit/main/docs/`,
      },
      customCss: ["./src/styles/custom.css"],
      components: {
        PageTitle: "./src/components/PageTitle.astro",
        SocialIcons: "./src/components/SocialIcons.astro",
      },
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:title",
            content: "MusicOrbit — Your self-hosted listening space",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:description",
            content:
              "Open-source self-hosted music library, lossless browser player, synced sing-along lyrics, metadata editor, and multi-user music hub.",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            content: "#070812",
          },
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "What is MusicOrbit?", slug: "what-is-musicorbit" },
            { label: "Installation", slug: "installation" },
            { label: "First-Run Setup", slug: "first-run-setup" },
          ],
        },
        {
          label: "Building Your Library",
          items: [
            { label: "Uploading & Bulk Import", slug: "adding-music" },
            { label: "Library Organization", slug: "library-organization" },
            { label: "Import Pipeline & Review Queue", slug: "import-pipeline" },
            { label: "Audio Formats & Transcoding", slug: "audio-formats" },
          ],
        },
        {
          label: "Listening & Features",
          items: [
            { label: "Browser Player & Queue", slug: "player-and-queue" },
            { label: "Synced Sing-Along Lyrics", slug: "sing-along-lyrics" },
            { label: "Metadata, Covers & Portraits", slug: "metadata-and-artwork" },
            { label: "Playlists, CSV & .m3u8 Sync", slug: "playlists-and-sync" },
            { label: "Deleting Songs & Albums", slug: "deleting-media" },
          ],
        },
        {
          label: "Integrations",
          items: [
            { label: "Mobile Apps (OpenSubsonic)", slug: "navidrome-symfonium" },
            { label: "Soulseek (slskd)", slug: "soulseek-slskd" },
          ],
        },
        {
          label: "Admin & Operations",
          items: [
            { label: "Users & Isolated Libraries", slug: "users-and-permissions" },
            { label: "Environment Variables", slug: "configuration" },
            { label: "Activity Logs & Diagnostics", slug: "activity-logs" },
            { label: "Password Recovery & Backups", slug: "password-recovery" },
            { label: "Reverse Proxy & HTTPS", slug: "reverse-proxy" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Architecture & Tech Stack", slug: "architecture" },
            { label: "Privacy Policy", slug: "privacy-policy" },
            { label: "Legal Notice & AGPL-3.0", slug: "legal-and-license" },
          ],
        },
      ],
    }),
  ],
});
