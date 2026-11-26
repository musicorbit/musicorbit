import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  Disc3,
  KeyRound,
  ListMusic,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

export interface OnboardingTourProps {
  username: string;
  isAdmin: boolean;
  authEnabled: boolean;
  canUseSoulseek: boolean;
  onEnsureAlbumsView: () => void;
  onComplete: () => void;
}

interface TourStep {
  id: string;
  target: string | null;
  placement: "center" | "right" | "bottom" | "top";
  title: string;
  description: string;
  tip?: string;
  icon: typeof Disc3;
  ensureAlbums?: boolean;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PAD = 6;
const POPOVER_WIDTH = 360;
const POPOVER_EST_HEIGHT = 250;
const VIEWPORT_MARGIN = 16;

export function OnboardingTour({
  username,
  isAdmin,
  authEnabled,
  canUseSoulseek,
  onEnsureAlbumsView,
  onComplete,
}: OnboardingTourProps) {
  const steps = useMemo<TourStep[]>(() => {
    const list: TourStep[] = [
      {
        id: "welcome",
        target: null,
        placement: "center",
        icon: Disc3,
        title: `Welcome to MusicOrbit${username && username !== "local" ? `, ${username}` : ""}!`,
        description:
          "You have your own private music library, playlists, and synced sing-along lyrics. Take a 30-second tour to see how to upload music and configure your setup.",
        tip: "You can replay this tour anytime using the ? button at the bottom of the sidebar.",
        ensureAlbums: true,
      },
      {
        id: "upload",
        target: "upload-btn",
        placement: "bottom",
        icon: Upload,
        title: "Upload Songs or Whole Albums",
        description:
          "Drag and drop single tracks or an entire album folder right from your browser. MusicOrbit automatically tags, organizes, fetches synced lyrics, and indexes them into your private library.",
        tip: "Supports FLAC, MP3, M4A / ALAC (losslessly playable in Chrome/Firefox), OGG, Opus, and WAV.",
        ensureAlbums: true,
      },
      {
        id: "library",
        target: "nav-albums",
        placement: "right",
        icon: Disc3,
        title: "Browse, Play & Sing Along",
        description:
          "Switch between Albums, Artists, and Tracks anytime. Click any track to start playing, then tap the microphone icon in the bottom player bar for synced sing-along lyrics.",
      },
      {
        id: "playlists",
        target: "nav-playlists",
        placement: "right",
        icon: ListMusic,
        title: "Playlists & Spotify / M3U8 Imports",
        description:
          "Create playlists or import .csv (Exportify) and .m3u8 files. Songs you don't own yet are tracked automatically and added the moment they enter your library.",
      },
    ];

    if (canUseSoulseek) {
      list.push({
        id: "soulseek",
        target: "nav-search",
        placement: "right",
        icon: Search,
        title: "Soulseek Search & Downloads",
        description:
          "Search Soulseek for lossless FLAC releases or missing playlist tracks. Completed downloads are tagged and routed straight into your personal library folder.",
      });
    }

    list.push(
      {
        id: "review",
        target: "nav-review",
        placement: "right",
        icon: Sparkles,
        title: "Import & Review Queue",
        description:
          "If an uploaded or downloaded track has ambiguous tags, it waits safely here so you can confirm the right MusicBrainz match before it moves into your library.",
      },
      {
        id: "settings",
        target: "nav-system",
        placement: "right",
        icon: Activity,
        title: isAdmin ? "System, Scanner & Folder Layout" : "Library Settings & Synced Lyrics",
        description: isAdmin
          ? "Pick your folder layout preset (Artist/Album/Track, Flat, etc.), configure automated downloads post-processing, enable .m3u8 playlist sync for Navidrome/Symfonium, and bulk-fetch synced lyrics."
          : "Choose your preferred folder layout (Artist/Album/Track, Flat, etc.), scan your library, enable .m3u8 playlist sync, and bulk-fetch missing synced lyrics.",
      },
    );

    if (isAdmin && authEnabled) {
      list.push({
        id: "users",
        target: "nav-users",
        placement: "right",
        icon: ShieldCheck,
        title: "Users & Isolated Libraries",
        description:
          "Create accounts for family or friends — each user gets their own separate library folder on disk, and you choose who gets Soulseek download access.",
      });
    }

    list.push({
      id: "logs",
      target: "nav-logs",
      placement: "right",
      icon: ScrollText,
      title: "Activity Logs & Diagnostics",
      description:
        "Monitor your uploads, library scans, post-processing imports, and lyric fetches live — or export a .log file whenever you want to troubleshoot.",
    });

    if (authEnabled) {
      list.push({
        id: "account",
        target: "user-card",
        placement: "top",
        icon: KeyRound,
        title: "Account & Password",
        description:
          "Manage your session right here: click the key icon anytime to update your password, the ? button to replay this tour, or the arrow icon to sign out.",
      });
    }

    return list;
  }, [username, isAdmin, authEnabled, canUseSoulseek]);

  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [viewport, setViewport] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  });

  const popoverRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(popoverRef, onComplete);

  const currentStep = steps[stepIndex] ?? steps[0]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  // Ensure the Albums view is active on steps that highlight top-bar buttons like Upload
  useEffect(() => {
    if (currentStep.ensureAlbums) {
      onEnsureAlbumsView();
    }
  }, [currentStep.ensureAlbums, onEnsureAlbumsView]);

  const measureTarget = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    if (!currentStep.target) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${currentStep.target}"]`);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setTargetRect(null);
      return;
    }
    setTargetRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, [currentStep.target]);

  useEffect(() => {
    // Measure immediately and once more after any route switch frame renders
    measureTarget();
    const raf = window.requestAnimationFrame(measureTarget);
    const timer = window.setTimeout(measureTarget, 120);

    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
    };
  }, [measureTarget]);

  // Arrow key navigation inside tour
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (isLast) onComplete();
        else setStepIndex((i) => Math.min(steps.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLast, onComplete, steps.length]);

  // Compute clamped popover coordinates cleanly relative to the spotlight rect
  const popoverStyle = useMemo<React.CSSProperties>(() => {
    const cardWidth = Math.min(POPOVER_WIDTH, viewport.width - VIEWPORT_MARGIN * 2);

    if (!targetRect || currentStep.placement === "center" || viewport.width < 1024) {
      return {
        width: cardWidth,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const gap = 18;
    let top = VIEWPORT_MARGIN;
    let left = VIEWPORT_MARGIN;

    if (currentStep.placement === "right") {
      left = targetRect.left + targetRect.width + gap;
      top = targetRect.top + targetRect.height / 2 - POPOVER_EST_HEIGHT / 2;
    } else if (currentStep.placement === "bottom") {
      top = targetRect.top + targetRect.height + gap;
      left = targetRect.left + targetRect.width / 2 - cardWidth / 2;
    } else if (currentStep.placement === "top") {
      top = targetRect.top - POPOVER_EST_HEIGHT - gap;
      left = targetRect.left + targetRect.width + gap;
      // Place slightly above bottom-left user card, aligned to its right side
      if (left + cardWidth <= viewport.width - VIEWPORT_MARGIN) {
        top = Math.min(
          viewport.height - POPOVER_EST_HEIGHT - VIEWPORT_MARGIN,
          Math.max(VIEWPORT_MARGIN, targetRect.top - 120),
        );
      } else {
        left = targetRect.left;
      }
    }

    const clampedLeft = Math.max(
      VIEWPORT_MARGIN,
      Math.min(viewport.width - cardWidth - VIEWPORT_MARGIN, left),
    );
    const clampedTop = Math.max(
      VIEWPORT_MARGIN,
      Math.min(viewport.height - POPOVER_EST_HEIGHT - VIEWPORT_MARGIN, top),
    );

    return {
      width: cardWidth,
      top: clampedTop,
      left: clampedLeft,
    };
  }, [targetRect, currentStep.placement, viewport.width, viewport.height]);

  const Icon = currentStep.icon;

  return (
    <div className="fixed inset-0 z-50">
      {/* Clickable dim backdrop (when no spotlight target, render full dark scrim; when spotlighting, the cutout's box-shadow renders the scrim!) */}
      {targetRect ? (
        <>
          {/* Transparent click blocker over the rest of the app so clicks don't accidentally trigger background buttons */}
          <div className="fixed inset-0" aria-hidden="true" />
          {/* Smoothly transitioning spotlight cutout ring */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-xl ring-2 ring-amber-400/90 transition-all duration-300 ease-out"
            style={{
              top: targetRect.top - SPOTLIGHT_PAD,
              left: targetRect.left - SPOTLIGHT_PAD,
              width: targetRect.width + SPOTLIGHT_PAD * 2,
              height: targetRect.height + SPOTLIGHT_PAD * 2,
              boxShadow: "0 0 0 9999px rgba(9, 9, 11, 0.78), 0 0 28px rgba(245, 158, 11, 0.35)",
            }}
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-zinc-950/80 backdrop-blur-[2px] transition-opacity duration-300"
        />
      )}

      {/* Floating Tour Popover Card */}
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-tour-title"
        tabIndex={-1}
        style={popoverStyle}
        className="fixed z-10 rounded-2xl border border-amber-500/35 bg-zinc-900 p-5 shadow-2xl shadow-black/70 transition-all duration-300 ease-out focus:outline-none"
      >
        {/* Top Row: Step counter + Close/Skip */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-semibold tracking-wider text-amber-300 uppercase">
              Quick Tour · {stepIndex + 1} / {steps.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onComplete}
            aria-label="Skip tour"
            title="Skip tour (Esc)"
            className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Title & Body */}
        <h3 id="onboarding-tour-title" className="text-base font-semibold text-zinc-50">
          {currentStep.title}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{currentStep.description}</p>

        {currentStep.tip && (
          <p className="mt-2.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
            {currentStep.tip}
          </p>
        )}

        {/* Progress Dots */}
        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
          {steps.map((s, idx) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                idx === stepIndex
                  ? "w-5 bg-amber-400"
                  : idx < stepIndex
                    ? "w-1.5 bg-amber-500/50"
                    : "w-1.5 bg-zinc-700"
              }`}
            />
          ))}
        </div>

        {/* Footer Controls */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-3.5">
          <button
            type="button"
            onClick={onComplete}
            className="text-xs font-medium text-zinc-400 transition hover:text-zinc-200"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            )}

            <button
              data-autofocus
              type="button"
              onClick={() => {
                if (isLast) {
                  onComplete();
                } else {
                  setStepIndex((i) => Math.min(steps.length - 1, i + 1));
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
            >
              {isLast ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Finish
                </>
              ) : (
                <>
                  {isFirst ? "Start Tour" : "Next"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
