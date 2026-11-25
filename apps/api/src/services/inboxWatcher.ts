import type { FastifyBaseLogger } from "fastify";
import type { InboxScanResult, InboxWatcherStatus } from "@musicorbit/shared";
import type { ActivityLogService } from "./activityLog.js";
import type { LibraryImporter } from "./importer.js";
import type { LibraryOrganizer } from "./libraryOrganizer.js";
import type { LyricsService } from "./lyrics.js";
import type { LibraryScanner } from "./scanner.js";
import type { SettingsService } from "./settings.js";

export interface InboxWatcherDeps {
  importer: LibraryImporter;
  settingsService: SettingsService;
  organizer?: LibraryOrganizer;
  lyricsService?: LyricsService;
  scanner?: LibraryScanner;
  activityLog?: ActivityLogService;
  logger?: FastifyBaseLogger;
}

/**
 * Lightweight background poller that:
 *  1) watches DOWNLOADS_DIR when auto-watch is enabled, and
 *  2) periodically scans & organizes newly dropped well-tagged files in MUSIC_DIR
 *     when opt-in autoOrganizeLibrary is enabled.
 * Always skips recently modified / incomplete files so active transfers are untouched.
 */
export class InboxWatcher {
  private readonly importer: LibraryImporter;
  private readonly settingsService: SettingsService;
  private readonly organizer?: LibraryOrganizer;
  private readonly lyricsService?: LyricsService;
  private readonly scanner?: LibraryScanner;
  private readonly activityLog?: ActivityLogService;
  private readonly logger?: FastifyBaseLogger;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastCheckAt: string | null = null;
  private lastError: string | null = null;
  private lastResult: InboxScanResult | null = null;
  private activeIntervalSeconds = 60;

  constructor(deps: InboxWatcherDeps) {
    this.importer = deps.importer;
    this.settingsService = deps.settingsService;
    this.organizer = deps.organizer;
    this.lyricsService = deps.lyricsService;
    this.scanner = deps.scanner;
    this.activityLog = deps.activityLog;
    this.logger = deps.logger;
  }

  private shouldRunTimer(): boolean {
    const pp = this.settingsService.getPostProcessingSettings();
    const org = this.settingsService.getLibraryOrganizationSettings();
    const orgActive = org.autoOrganizeLibrary && org.layoutPreset !== "keep_existing";
    return pp.autoWatchEnabled || orgActive;
  }

  getStatus(): InboxWatcherStatus {
    const pp = this.settingsService.getPostProcessingSettings();
    return {
      enabled: pp.autoWatchEnabled,
      running: this.running,
      intervalSeconds: pp.autoWatchIntervalSeconds,
      lastCheckAt: this.lastCheckAt,
      lastError: this.lastError,
      lastResult: this.lastResult,
    };
  }

  /**
   * Starts, updates, or stops the background timer to match current SQLite settings.
   */
  syncWithSettings(): void {
    const pp = this.settingsService.getPostProcessingSettings();
    const org = this.settingsService.getLibraryOrganizationSettings();
    if (!this.shouldRunTimer()) {
      this.stop();
      return;
    }

    if (this.timer && this.activeIntervalSeconds === pp.autoWatchIntervalSeconds) {
      return;
    }

    this.stop();
    this.activeIntervalSeconds = pp.autoWatchIntervalSeconds;
    this.timer = setInterval(() => {
      void this.tick();
    }, pp.autoWatchIntervalSeconds * 1000);
    // Do not keep Node process alive solely for this interval
    this.timer.unref?.();
    this.activityLog?.info(
      "watcher",
      `Background watcher started (checking every ${pp.autoWatchIntervalSeconds}s)`,
      {
        downloadsWatch: pp.autoWatchEnabled,
        autoOrganizeLibrary: org.autoOrganizeLibrary && org.layoutPreset !== "keep_existing",
        downloadsDir: pp.downloadsDir,
      },
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.activityLog?.info("watcher", "Background watcher stopped");
    }
  }

  async tick(): Promise<InboxScanResult | null> {
    if (this.running) return null;
    this.running = true;
    this.lastError = null;
    try {
      const pp = this.settingsService.getPostProcessingSettings();
      const org = this.settingsService.getLibraryOrganizationSettings();
      let result: InboxScanResult | null = null;

      if (pp.autoWatchEnabled) {
        result = await this.importer.scanInbox({ requireStableFiles: true });
        this.lastResult = result;
        if (result.autoImported > 0 || result.needsReview > 0 || result.failed > 0) {
          this.activityLog?.info(
            "watcher",
            `Auto-watch check: ${result.autoImported} imported, ${result.needsReview} queued for review, ${result.skipped} skipped`,
            { ...result },
          );
        }
      }

      if (org.autoOrganizeLibrary && org.layoutPreset !== "keep_existing" && this.organizer) {
        // Index any files dropped straight into MUSIC_DIR before organizing (quiet when nothing changed)
        let filesAdded = 0;
        if (this.scanner) {
          const scanStatus = await this.scanner.runScan({
            force: false,
            quietIfNoChanges: true,
            skipPostScanHooks: true,
          });
          filesAdded = scanStatus.filesAdded;
        }
        await this.organizer.apply({ requireStableFiles: true });
        // Fetch synced .lrc sidecars AFTER files land in their final organized paths
        if (filesAdded > 0 && pp.autoFetchLyrics && this.lyricsService) {
          this.lyricsService.startBatchFetch();
        }
      }

      this.lastCheckAt = new Date().toISOString();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.lastCheckAt = new Date().toISOString();
      this.activityLog?.error("watcher", `Watcher check failed: ${msg}`);
      return null;
    } finally {
      this.running = false;
    }
  }
}
