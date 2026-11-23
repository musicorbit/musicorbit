import type { FastifyBaseLogger } from "fastify";
import type { InboxScanResult, InboxWatcherStatus } from "@musicorbit/shared";
import type { LibraryImporter } from "./importer.js";
import type { SettingsService } from "./settings.js";

export interface InboxWatcherDeps {
  importer: LibraryImporter;
  settingsService: SettingsService;
  logger?: FastifyBaseLogger;
}

/**
 * Lightweight background poller that watches DOWNLOADS_DIR when auto-watch is enabled.
 * Always skips recently modified / incomplete files so active slskd transfers are untouched.
 */
export class InboxWatcher {
  private readonly importer: LibraryImporter;
  private readonly settingsService: SettingsService;
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
    this.logger?.info(
      { intervalSeconds: pp.autoWatchIntervalSeconds, downloadsDir: pp.downloadsDir },
      "Started background downloads watcher",
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.lastCheckAt = new Date().toISOString();
      this.logger?.warn({ err }, "Background downloads watcher tick failed");
      return null;
    } finally {
      this.running = false;
    }
  }
}
