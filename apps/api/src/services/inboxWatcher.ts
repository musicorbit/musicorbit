import type { FastifyBaseLogger } from "fastify";
import type { InboxScanResult, InboxWatcherStatus } from "@musicorbit/shared";
import type { ActivityLogService } from "./activityLog.js";
import type { LibraryImporter } from "./importer.js";
import type { SettingsService } from "./settings.js";

export interface InboxWatcherDeps {
  importer: LibraryImporter;
  settingsService: SettingsService;
  activityLog?: ActivityLogService;
  logger?: FastifyBaseLogger;
}

/**
 * Lightweight background poller that watches DOWNLOADS_DIR when auto-watch is enabled.
 * Always skips recently modified / incomplete files so active slskd transfers are untouched.
 */
export class InboxWatcher {
  private readonly importer: LibraryImporter;
  private readonly settingsService: SettingsService;
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
    this.activityLog = deps.activityLog;
    this.logger = deps.logger;
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
    if (!pp.autoWatchEnabled) {
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
      `Auto-watch started (checking every ${pp.autoWatchIntervalSeconds}s)`,
      { downloadsDir: pp.downloadsDir },
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.activityLog?.info("watcher", "Auto-watch stopped");
    }
  }

  async tick(): Promise<InboxScanResult | null> {
    if (this.running) return null;
    this.running = true;
    this.lastError = null;
    try {
      const result = await this.importer.scanInbox({ requireStableFiles: true });
      this.lastResult = result;
      this.lastCheckAt = new Date().toISOString();
      if (result.autoImported > 0 || result.needsReview > 0 || result.failed > 0) {
        this.activityLog?.info(
          "watcher",
          `Auto-watch check: ${result.autoImported} imported, ${result.needsReview} queued for review, ${result.skipped} skipped`,
          { ...result },
        );
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.lastCheckAt = new Date().toISOString();
      this.activityLog?.error("watcher", `Auto-watch check failed: ${msg}`);
      return null;
    } finally {
      this.running = false;
    }
  }
}
