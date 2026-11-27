import type { UpdateCheckResponse } from "@musicorbit/shared";

export interface UpdateCheckerOptions {
  currentVersion: string;
  enabled: boolean;
  repo?: string;
  cacheTtlMs?: number;
  errorCooldownMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const DEFAULT_REPO = "musicorbit/musicorbit";
const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const DEFAULT_ERROR_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_TIMEOUT_MS = 5000;

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

export function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = normalizeVersion(raw).split("+")[0] ?? "";
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(cleaned);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * Returns true if `candidate` is strictly newer than `current` according to SemVer.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  if (!a || !b) return false;

  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;

  // Same major.minor.patch: stable release > prerelease
  if (a.prerelease === null && b.prerelease !== null) return true;
  if (a.prerelease !== null && b.prerelease === null) return false;
  if (a.prerelease !== null && b.prerelease !== null && a.prerelease !== b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true }) > 0;
  }

  return false;
}

function sanitizeReleaseUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && parsed.hostname === "github.com") {
      return parsed.toString();
    }
  } catch {
    // Invalid URL
  }
  return null;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  html_url?: unknown;
  name?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/**
 * Privacy-friendly, server-side cached GitHub Releases update checker.
 * Sends zero user data, zero instance IDs, and can be disabled via CHECK_UPDATES=false.
 */
export class UpdateChecker {
  private readonly currentVersion: string;
  private readonly enabled: boolean;
  private readonly repo: string;
  private readonly cacheTtlMs: number;
  private readonly errorCooldownMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  private cachedResult: UpdateCheckResponse | null = null;
  private cacheExpiresAt = 0;
  private inFlight: Promise<UpdateCheckResponse> | null = null;

  constructor(options: UpdateCheckerOptions) {
    this.currentVersion = normalizeVersion(options.currentVersion);
    this.enabled = options.enabled;
    this.repo = options.repo ?? DEFAULT_REPO;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.errorCooldownMs = options.errorCooldownMs ?? DEFAULT_ERROR_COOLDOWN_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  async check(options?: { force?: boolean }): Promise<UpdateCheckResponse> {
    if (!this.enabled) {
      return {
        enabled: false,
        currentVersion: this.currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseName: null,
        publishedAt: null,
        checkedAt: null,
        error: null,
      };
    }

    const force = options?.force === true;
    const nowMs = this.now();
    if (!force && this.cachedResult && nowMs < this.cacheExpiresAt) {
      return this.cachedResult;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.performCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performCheck(): Promise<UpdateCheckResponse> {
    const checkedAt = new Date(this.now()).toISOString();
    const url = `https://api.github.com/repos/${this.repo}/releases/latest`;

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "MusicOrbit",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      // 404 simply means the repository has no published releases yet — treat cleanly as up to date.
      if (response.status === 404) {
        const result: UpdateCheckResponse = {
          enabled: true,
          currentVersion: this.currentVersion,
          latestVersion: null,
          updateAvailable: false,
          releaseUrl: null,
          releaseName: null,
          publishedAt: null,
          checkedAt,
          error: null,
        };
        this.cachedResult = result;
        this.cacheExpiresAt = this.now() + this.cacheTtlMs;
        return result;
      }

      if (!response.ok) {
        throw new Error(`GitHub API responded with HTTP ${response.status}`);
      }

      const data = (await response.json()) as GitHubReleasePayload;
      if (data.draft === true || data.prerelease === true) {
        const result: UpdateCheckResponse = {
          enabled: true,
          currentVersion: this.currentVersion,
          latestVersion: null,
          updateAvailable: false,
          releaseUrl: null,
          releaseName: null,
          publishedAt: null,
          checkedAt,
          error: null,
        };
        this.cachedResult = result;
        this.cacheExpiresAt = this.now() + this.cacheTtlMs;
        return result;
      }

      const rawTag = typeof data.tag_name === "string" ? data.tag_name : "";
      const latestVersion = parseSemver(rawTag) ? normalizeVersion(rawTag) : null;
      const updateAvailable = latestVersion
        ? isNewerVersion(latestVersion, this.currentVersion)
        : false;
      const releaseUrl = sanitizeReleaseUrl(data.html_url);
      const releaseName =
        typeof data.name === "string" && data.name.trim().length > 0 ? data.name.trim() : null;
      const publishedAt =
        typeof data.published_at === "string" && data.published_at.trim().length > 0
          ? data.published_at
          : null;

      const result: UpdateCheckResponse = {
        enabled: true,
        currentVersion: this.currentVersion,
        latestVersion,
        updateAvailable,
        releaseUrl,
        releaseName,
        publishedAt,
        checkedAt,
        error: null,
      };
      this.cachedResult = result;
      this.cacheExpiresAt = this.now() + this.cacheTtlMs;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not check for updates";
      const result: UpdateCheckResponse = {
        enabled: true,
        currentVersion: this.currentVersion,
        latestVersion: this.cachedResult?.latestVersion ?? null,
        updateAvailable: this.cachedResult?.updateAvailable ?? false,
        releaseUrl: this.cachedResult?.releaseUrl ?? null,
        releaseName: this.cachedResult?.releaseName ?? null,
        publishedAt: this.cachedResult?.publishedAt ?? null,
        checkedAt,
        error: message,
      };
      this.cachedResult = result;
      this.cacheExpiresAt = this.now() + this.errorCooldownMs;
      return result;
    }
  }
}
