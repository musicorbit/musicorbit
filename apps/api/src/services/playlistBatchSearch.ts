import type {
  MissingTrackBatchItemState,
  MissingTrackBatchJobStatus,
  MissingTrackSearchCandidate,
  PlaylistMissingTrack,
  SoulseekReleaseGroup,
} from "@musicorbit/shared";
import type { SlskdClient } from "./acquisition/slskd.js";
import { normalizeForMatching } from "./playlistImport.js";

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 3;
const MAX_CANDIDATES_PER_TRACK = 6;

export interface PlaylistBatchSearchOptions {
  slskdClient: SlskdClient;
  /** Polite stagger between launching searches so slskd/Soulseek never sees a burst. */
  staggerMs?: number;
  /** Poll interval while waiting for slskd responses. */
  pollIntervalMs?: number;
  /** Max time to wait per track search before collecting best results so far. */
  searchWaitMs?: number;
}

interface ActiveBatchJob {
  status: MissingTrackBatchJobStatus;
  cancelled: boolean;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSearchQuery(title: string, artist: string): string {
  const cleanTitle = title
    .replace(/\s*[\(\[](feat\.?|ft\.?|featuring|remaster(?:ed)?[^)\]]*)[\)\]]/gi, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const primaryArtist =
    artist
      .split(/[;,]/)[0]
      ?.replace(/[^\p{L}\p{N}\s'-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim() ?? "";

  const query = `${primaryArtist} ${cleanTitle}`.trim();
  return query.slice(0, 120);
}

/**
 * Extracts and ranks individual song candidates from slskd release groups for a single missing track.
 * Prefers unlocked files whose filename matches the target track title, lossless FLAC, high-bitrate MP3,
 * free upload slots, and fast peers.
 */
export function rankTrackCandidates(
  groups: SoulseekReleaseGroup[],
  targetTitle: string,
  targetArtist: string,
): MissingTrackSearchCandidate[] {
  const normTitle = normalizeForMatching(targetTitle);
  const titleWords = normTitle.split(" ").filter((w) => w.length >= 2);
  const primaryArtist = normalizeForMatching(targetArtist.split(/[;,]/)[0] ?? targetArtist);

  const scored: Array<{ score: number; candidate: MissingTrackSearchCandidate }> = [];

  for (const group of groups) {
    const normFolder = normalizeForMatching(group.directoryPath);

    for (const file of group.files) {
      if (file.isLocked) continue;

      const baseNoExt = file.basename.replace(/\.[^.]+$/, "");
      const normFile = normalizeForMatching(baseNoExt);
      const normFull = `${normFolder} ${normFile}`;

      let score = 0;

      // Filename match against target title
      if (normTitle && normFile.includes(normTitle)) {
        score += 500;
      } else if (titleWords.length > 0) {
        const matchedWords = titleWords.filter((w) => normFile.includes(w)).length;
        const ratio = matchedWords / titleWords.length;
        if (ratio < 0.5) continue; // Skip unrelated tracks in the same album folder
        score += Math.round(ratio * 350);
      }

      // Bonus if artist appears in filename or directory path
      if (primaryArtist && normFull.includes(primaryArtist)) {
        score += 120;
      }

      const isLossless = file.extension === "flac" || file.extension === "wav";
      if (isLossless) {
        score += 320;
      } else if ((file.bitRate ?? 0) >= 300) {
        score += 180;
      } else if ((file.bitRate ?? 0) >= 192) {
        score += 90;
      }

      if (group.hasFreeUploadSlot) score += 160;
      score += Math.min(100, Math.floor(group.uploadSpeed / 30_000));
      score -= Math.min(80, group.queueLength * 3);

      scored.push({
        score,
        candidate: {
          username: group.username,
          filename: file.filename,
          basename: file.basename,
          directoryPath: group.directoryPath,
          folderName: group.folderName,
          size: file.size,
          extension: file.extension,
          bitRate: file.bitRate,
          isLossless,
          hasFreeUploadSlot: group.hasFreeUploadSlot,
          uploadSpeed: group.uploadSpeed,
          queueLength: group.queueLength,
        },
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Deduplicate by username + filename
  const seen = new Set<string>();
  const results: MissingTrackSearchCandidate[] = [];
  for (const item of scored) {
    const key = `${item.candidate.username}:${item.candidate.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item.candidate);
    if (results.length >= MAX_CANDIDATES_PER_TRACK) break;
  }

  return results;
}

/**
 * Coordinates polite, concurrency-limited Soulseek searches across a playlist's missing tracks,
 * exposing live per-song progress and cleaning up temporary slskd searches automatically.
 */
export class PlaylistBatchSearchService {
  private readonly slskdClient: SlskdClient;
  private readonly staggerMs: number;
  private readonly pollIntervalMs: number;
  private readonly searchWaitMs: number;
  private readonly jobs = new Map<number, ActiveBatchJob>();

  constructor(opts: PlaylistBatchSearchOptions) {
    this.slskdClient = opts.slskdClient;
    this.staggerMs = opts.staggerMs ?? 1500;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1200;
    this.searchWaitMs = opts.searchWaitMs ?? 10_000;
  }

  getStatus(playlistId: number): MissingTrackBatchJobStatus {
    const existing = this.jobs.get(playlistId);
    if (existing) {
      return existing.status;
    }
    return {
      playlistId,
      state: "idle",
      concurrencyLimit: DEFAULT_CONCURRENCY,
      total: 0,
      completed: 0,
      foundCount: 0,
      notFoundCount: 0,
      errorCount: 0,
      items: [],
    };
  }

  cancel(playlistId: number): MissingTrackBatchJobStatus {
    const existing = this.jobs.get(playlistId);
    if (!existing) return this.getStatus(playlistId);
    existing.cancelled = true;
    if (existing.status.state === "running") {
      existing.status.state = "cancelled";
    }
    return existing.status;
  }

  markTrackQueued(playlistId: number, missingTrackId: number): void {
    const existing = this.jobs.get(playlistId);
    if (!existing) return;
    const item = existing.status.items.find((i) => i.missingTrackId === missingTrackId);
    if (item) {
      item.state = "queued";
    }
  }

  removeTrackFromJob(playlistId: number, missingTrackId: number): void {
    const existing = this.jobs.get(playlistId);
    if (!existing) return;
    existing.status.items = existing.status.items.filter(
      (i) => i.missingTrackId !== missingTrackId,
    );
    this.recomputeCounts(existing.status);
  }

  startBatch(
    playlistId: number,
    missingTracks: PlaylistMissingTrack[],
    requestedConcurrency?: number,
  ): MissingTrackBatchJobStatus {
    const concurrencyLimit = Math.max(
      1,
      Math.min(MAX_CONCURRENCY, requestedConcurrency ?? DEFAULT_CONCURRENCY),
    );

    // Cancel any existing job on this playlist before starting a fresh one
    const prev = this.jobs.get(playlistId);
    if (prev && prev.status.state === "running") {
      prev.cancelled = true;
    }

    const items: MissingTrackBatchItemState[] = missingTracks.map((t) => ({
      missingTrackId: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      state: t.status === "queued" ? "queued" : "pending",
      candidates: [],
      error: null,
    }));

    const status: MissingTrackBatchJobStatus = {
      playlistId,
      state: items.some((i) => i.state === "pending") ? "running" : "completed",
      concurrencyLimit,
      total: items.length,
      completed: items.filter((i) => i.state === "queued").length,
      foundCount: 0,
      notFoundCount: 0,
      errorCount: 0,
      items,
    };

    const job: ActiveBatchJob = { status, cancelled: false };
    this.jobs.set(playlistId, job);

    if (status.state === "running") {
      void this.runPool(job);
    }

    return status;
  }

  private recomputeCounts(status: MissingTrackBatchJobStatus): void {
    status.total = status.items.length;
    status.foundCount = status.items.filter(
      (i) => i.state === "found" || (i.state === "queued" && i.candidates.length > 0),
    ).length;
    status.notFoundCount = status.items.filter((i) => i.state === "not_found").length;
    status.errorCount = status.items.filter((i) => i.state === "error").length;
    status.completed = status.items.filter(
      (i) => i.state !== "pending" && i.state !== "searching",
    ).length;
  }

  private async runPool(job: ActiveBatchJob): Promise<void> {
    const pendingIndices = job.status.items
      .map((item, idx) => (item.state === "pending" ? idx : -1))
      .filter((idx) => idx >= 0);

    let cursor = 0;
    let lastLaunchAt = 0;

    const worker = async (): Promise<void> => {
      while (!job.cancelled) {
        const nextPos = cursor;
        cursor += 1;
        const itemIdx = pendingIndices[nextPos];
        if (itemIdx === undefined) break;

        const item = job.status.items[itemIdx];
        if (!item) break;

        // Enforce polite minimum stagger between launching searches across workers
        if (this.staggerMs > 0) {
          const now = Date.now();
          const wait = lastLaunchAt + this.staggerMs - now;
          lastLaunchAt = Math.max(now, lastLaunchAt + this.staggerMs);
          if (wait > 0) {
            await sleep(wait);
          }
          if (job.cancelled) break;
        }

        await this.searchSingleItem(job, item);
        this.recomputeCounts(job.status);
      }
    };

    const workerCount = Math.min(job.status.concurrencyLimit, pendingIndices.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (job.cancelled) {
      job.status.state = "cancelled";
    } else {
      job.status.state = "completed";
    }
    this.recomputeCounts(job.status);
  }

  private async searchSingleItem(
    job: ActiveBatchJob,
    item: MissingTrackBatchItemState,
  ): Promise<void> {
    item.state = "searching";
    item.error = null;

    const query = buildSearchQuery(item.title, item.artist);
    if (!query) {
      item.state = "not_found";
      return;
    }

    let searchId: string | null = null;
    try {
      const started = await this.slskdClient.startSearch(query);
      searchId = started.id;

      const deadline = Date.now() + this.searchWaitMs;
      let latestCandidates: MissingTrackSearchCandidate[] = [];

      while (!job.cancelled) {
        await sleep(this.pollIntervalMs);
        if (job.cancelled) break;

        const results = await this.slskdClient.getSearchResults(searchId);
        latestCandidates = rankTrackCandidates(results.groups, item.title, item.artist);

        // Stop early once slskd marks complete OR we already have strong lossless free-slot matches
        const strongLosslessCount = latestCandidates.filter(
          (c) => c.isLossless && c.hasFreeUploadSlot,
        ).length;

        if (results.search.isComplete || strongLosslessCount >= 3 || Date.now() >= deadline) {
          break;
        }
      }

      if (job.cancelled) {
        item.state = "pending";
        return;
      }

      item.candidates = latestCandidates;
      item.state = latestCandidates.length > 0 ? "found" : "not_found";
    } catch (err) {
      item.error = err instanceof Error ? err.message : "Soulseek search failed";
      item.state = "error";
    } finally {
      if (searchId) {
        // Keep slskd's active search table clean so we don't leak search slots
        await this.slskdClient.deleteSearch(searchId).catch(() => {});
      }
    }
  }
}
