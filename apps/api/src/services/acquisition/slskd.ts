import crypto from "node:crypto";
import type {
  AcquisitionStatusResponse,
  DownloadTransferItem,
  DownloadsListResponse,
  EnqueueDownloadFile,
  SoulseekFileItem,
  SoulseekReleaseGroup,
  SoulseekSearchResultsResponse,
  SoulseekSearchSummary,
} from "@musicorbit/shared";

const AUDIO_EXTENSIONS = new Set(["flac", "mp3", "m4a", "aac", "ogg", "opus", "wav"]);
const LOSSLESS_EXTENSIONS = new Set(["flac", "wav"]);

export class SlskdError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "SlskdError";
    this.statusCode = statusCode;
  }
}

interface RawSlskdApplication {
  version?: { full?: string; current?: string } | string;
  server?: {
    state?: string;
    isConnected?: boolean;
    isLoggedIn?: boolean;
  };
}

interface RawSlskdSearch {
  id: string;
  searchText?: string;
  state?: string;
  isComplete?: boolean;
  responseCount?: number;
  fileCount?: number;
}

interface RawSlskdFile {
  filename: string;
  size?: number;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  length?: number;
  extension?: string;
  isLocked?: boolean;
}

export interface RawSlskdSearchResponse {
  username: string;
  hasFreeUploadSlot?: boolean;
  uploadSpeed?: number;
  queueLength?: number;
  files?: RawSlskdFile[];
  lockedFiles?: RawSlskdFile[];
}

interface RawSlskdTransferFile {
  id: string;
  username?: string;
  filename: string;
  size?: number;
  bytesTransferred?: number;
  percentComplete?: number;
  averageSpeed?: number;
  state?: string;
  requestedAt?: string;
  endedAt?: string;
}

interface RawSlskdTransferDirectory {
  directory: string;
  files?: RawSlskdTransferFile[];
}

interface RawSlskdUserTransfers {
  username: string;
  directories?: RawSlskdTransferDirectory[];
}

/**
 * Splits a Soulseek path (usually Windows backslashes like "@@music\\Artist\\Album\\01.flac",
 * occasionally forward slashes) into its directory path, short folder name, and filename.
 */
export function splitSoulseekPath(rawPath: string): {
  directoryPath: string;
  folderName: string;
  basename: string;
} {
  const parts = rawPath.split(/[\\/]+/).filter(Boolean);
  const basename = parts[parts.length - 1] ?? rawPath;
  const dirParts = parts.slice(0, -1);
  const directoryPath = dirParts.join("\\") || ".";
  const folderName = dirParts[dirParts.length - 1] ?? directoryPath;
  return { directoryPath, folderName, basename };
}

function detectExtension(filename: string, rawExt?: string): string {
  if (rawExt) {
    return rawExt.replace(/^\./, "").toLowerCase();
  }
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * Transforms raw slskd peer responses into clean album/folder Release Groups,
 * filtering to supported audio files and ranking FLAC / free-slot peers first.
 */
export function groupSearchResponses(
  responses: RawSlskdSearchResponse[],
): SoulseekReleaseGroup[] {
  const groups: SoulseekReleaseGroup[] = [];

  for (const peer of responses) {
    const unlocked = (peer.files ?? []).map((f) => ({ ...f, isLocked: Boolean(f.isLocked) }));
    const locked = (peer.lockedFiles ?? []).map((f) => ({ ...f, isLocked: true }));
    const allFiles = [...unlocked, ...locked];

    const byDir = new Map<string, { folderName: string; files: SoulseekFileItem[] }>();

    for (const rawFile of allFiles) {
      const ext = detectExtension(rawFile.filename, rawFile.extension);
      if (!AUDIO_EXTENSIONS.has(ext)) continue;

      const { directoryPath, folderName, basename } = splitSoulseekPath(rawFile.filename);
      let bucket = byDir.get(directoryPath);
      if (!bucket) {
        bucket = { folderName, files: [] };
        byDir.set(directoryPath, bucket);
      }

      bucket.files.push({
        filename: rawFile.filename,
        basename,
        size: rawFile.size ?? 0,
        extension: ext,
        bitRate: rawFile.bitRate ?? null,
        sampleRate: rawFile.sampleRate ?? null,
        bitDepth: rawFile.bitDepth ?? null,
        lengthSeconds: rawFile.length ?? null,
        isLocked: Boolean(rawFile.isLocked),
      });
    }

    for (const [directoryPath, bucket] of byDir.entries()) {
      bucket.files.sort((a, b) => a.basename.localeCompare(b.basename));

      const extensions = Array.from(new Set(bucket.files.map((f) => f.extension)));
      const format =
        extensions.length === 1 ? (extensions[0]?.toUpperCase() ?? "AUDIO") : "MIXED";
      const isLossless =
        bucket.files.length > 0 && bucket.files.every((f) => LOSSLESS_EXTENSIONS.has(f.extension));

      const bitrates = bucket.files
        .map((f) => f.bitRate)
        .filter((b): b is number => typeof b === "number" && b > 0);
      const avgBitrate =
        bitrates.length > 0
          ? Math.round(bitrates.reduce((sum, b) => sum + b, 0) / bitrates.length)
          : null;

      const totalSizeBytes = bucket.files.reduce((sum, f) => sum + f.size, 0);
      const hasLockedFiles = bucket.files.some((f) => f.isLocked);
      const id = crypto
        .createHash("sha1")
        .update(`${peer.username}:${directoryPath}`)
        .digest("hex")
        .slice(0, 14);

      groups.push({
        id,
        username: peer.username,
        directoryPath,
        folderName: bucket.folderName,
        format,
        isLossless,
        avgBitrate,
        trackCount: bucket.files.length,
        totalSizeBytes,
        hasFreeUploadSlot: Boolean(peer.hasFreeUploadSlot),
        uploadSpeed: peer.uploadSpeed ?? 0,
        queueLength: peer.queueLength ?? 0,
        hasLockedFiles,
        files: bucket.files,
      });
    }
  }

  // Ranking heuristic: unlocked > lossless (FLAC/WAV) > free upload slot > faster peer > lower queue
  groups.sort((a, b) => {
    const score = (g: SoulseekReleaseGroup) => {
      let s = 0;
      if (!g.hasLockedFiles) s += 1000;
      if (g.isLossless) s += 400;
      if (g.hasFreeUploadSlot) s += 200;
      s += Math.min(150, Math.floor(g.uploadSpeed / 25_000));
      s -= Math.min(120, g.queueLength * 4);
      // Slight preference for multi-track album folders over isolated single files when searching albums
      if (g.trackCount >= 3 && g.trackCount <= 40) s += 30;
      return s;
    };
    return score(b) - score(a);
  });

  return groups;
}

function classifyTransferState(state: string): {
  isActive: boolean;
  isCompleted: boolean;
  isFailed: boolean;
} {
  const lower = state.toLowerCase();
  const isCompleted = lower.includes("succeeded") || lower === "completed";
  const isFailed =
    lower.includes("errored") ||
    lower.includes("rejected") ||
    lower.includes("timedout") ||
    lower.includes("cancelled") ||
    lower.includes("aborted");
  const isActive = !isCompleted && !isFailed;
  return { isActive, isCompleted, isFailed };
}

export interface SlskdClientDeps {
  baseUrl: string | null;
  apiKey: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Clean REST client for slskd (/api/v0).
 * Designed to be 100% optional: if SLSKD_URL is omitted, MusicOrbit runs normally
 * as a local library/player and surfaces a clear "not configured" status.
 */
export class SlskdClient {
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: SlskdClientDeps) {
    this.baseUrl = deps.baseUrl ? deps.baseUrl.replace(/\/+$/, "") : null;
    this.apiKey = deps.apiKey;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  private requireBaseUrl(): string {
    if (!this.baseUrl) {
      throw new SlskdError(
        "slskd is not configured. Set SLSKD_URL and SLSKD_API_KEY in .env to enable Soulseek search.",
        503,
      );
    }
    return this.baseUrl;
  }

  private async request<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    timeoutMs = 10_000,
  ): Promise<T> {
    const baseUrl = this.requireBaseUrl();
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${baseUrl}${apiPath}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      throw new SlskdError(`Could not reach slskd at ${baseUrl}: ${msg}`, 502);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const status = res.status === 401 || res.status === 403 ? 502 : res.status;
      throw new SlskdError(
        `slskd returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        status,
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async getStatus(): Promise<AcquisitionStatusResponse> {
    if (!this.baseUrl) {
      return {
        provider: "slskd",
        configured: false,
        connected: false,
        loggedIn: false,
        url: null,
        version: null,
        error: null,
      };
    }

    try {
      const app = await this.request<RawSlskdApplication>("GET", "/api/v0/application", undefined, 4000);
      const version =
        typeof app.version === "string"
          ? app.version
          : (app.version?.full ?? app.version?.current ?? null);
      return {
        provider: "slskd",
        configured: true,
        connected: Boolean(app.server?.isConnected ?? true),
        loggedIn: Boolean(app.server?.isLoggedIn ?? app.server?.isConnected ?? true),
        url: this.baseUrl,
        version,
        error: null,
      };
    } catch (err) {
      return {
        provider: "slskd",
        configured: true,
        connected: false,
        loggedIn: false,
        url: this.baseUrl,
        version: null,
        error: err instanceof Error ? err.message : "Could not connect to slskd",
      };
    }
  }

  async startSearch(query: string): Promise<SoulseekSearchSummary> {
    const raw = await this.request<RawSlskdSearch>("POST", "/api/v0/searches", {
      searchText: query,
      filterResponses: true,
      searchTimeout: 15_000,
    });
    return {
      id: raw.id,
      query: raw.searchText ?? query,
      state: raw.state ?? "InProgress",
      isComplete: Boolean(raw.isComplete),
      responseCount: raw.responseCount ?? 0,
      fileCount: raw.fileCount ?? 0,
    };
  }

  async getSearchResults(searchId: string): Promise<SoulseekSearchResultsResponse> {
    const encodedId = encodeURIComponent(searchId);
    const [rawSearch, rawResponses] = await Promise.all([
      this.request<RawSlskdSearch>("GET", `/api/v0/searches/${encodedId}`),
      this.request<RawSlskdSearchResponse[]>("GET", `/api/v0/searches/${encodedId}/responses`),
    ]);

    const search: SoulseekSearchSummary = {
      id: rawSearch.id ?? searchId,
      query: rawSearch.searchText ?? "",
      state: rawSearch.state ?? "Completed",
      isComplete:
        Boolean(rawSearch.isComplete) ||
        (rawSearch.state?.toLowerCase().includes("completed") ?? false),
      responseCount: rawSearch.responseCount ?? rawResponses.length,
      fileCount: rawSearch.fileCount ?? 0,
    };

    const groups = groupSearchResponses(Array.isArray(rawResponses) ? rawResponses : []);
    return { search, groups };
  }

  async deleteSearch(searchId: string): Promise<void> {
    await this.request<void>("DELETE", `/api/v0/searches/${encodeURIComponent(searchId)}`);
  }

  async enqueueDownloads(username: string, files: EnqueueDownloadFile[]): Promise<void> {
    await this.request<unknown>(
      "POST",
      `/api/v0/transfers/downloads/${encodeURIComponent(username)}`,
      files.map((f) => ({ filename: f.filename, size: f.size })),
    );
  }

  async listDownloads(): Promise<DownloadsListResponse> {
    const rawUsers = await this.request<RawSlskdUserTransfers[]>(
      "GET",
      "/api/v0/transfers/downloads",
    );

    const transfers: DownloadTransferItem[] = [];
    for (const userEntry of Array.isArray(rawUsers) ? rawUsers : []) {
      for (const dirEntry of userEntry.directories ?? []) {
        for (const file of dirEntry.files ?? []) {
          const state = file.state ?? "Queued";
          const flags = classifyTransferState(state);
          const { folderName, basename } = splitSoulseekPath(file.filename);
          const size = file.size ?? 0;
          const bytesTransferred = file.bytesTransferred ?? 0;
          const percentComplete =
            typeof file.percentComplete === "number"
              ? Math.round(file.percentComplete * 10) / 10
              : size > 0
                ? Math.round((bytesTransferred / size) * 1000) / 10
                : 0;

          transfers.push({
            id: file.id,
            username: file.username ?? userEntry.username,
            directory: dirEntry.directory,
            folderName,
            filename: file.filename,
            basename,
            size,
            bytesTransferred,
            percentComplete,
            averageSpeed: file.averageSpeed ?? 0,
            state,
            ...flags,
            requestedAt: file.requestedAt ?? null,
            endedAt: file.endedAt ?? null,
          });
        }
      }
    }

    // Active downloads first, then newest requestedAt
    transfers.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (b.requestedAt ?? "").localeCompare(a.requestedAt ?? "");
    });

    return {
      activeCount: transfers.filter((t) => t.isActive).length,
      completedCount: transfers.filter((t) => t.isCompleted).length,
      failedCount: transfers.filter((t) => t.isFailed).length,
      transfers,
    };
  }

  async removeDownload(username: string, transferId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/api/v0/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(transferId)}?remove=true`,
    );
  }

  async clearCompletedDownloads(): Promise<void> {
    await this.request<void>("DELETE", "/api/v0/transfers/downloads/all/completed");
  }
}
