import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyBaseLogger } from "fastify";

const execFileAsync = promisify(execFile);

const TRANSCODE_EXTENSIONS = new Set([".aiff", ".aif", ".wma"]);

/**
 * Returns true for audio codecs/formats that Chrome, Firefox, and Edge cannot
 * natively decode in HTML5 <audio> (most notably Apple Lossless / ALAC inside .m4a).
 */
export function needsBrowserTranscode(codec: string | null | undefined, filePath: string): boolean {
  const lowerCodec = (codec ?? "").trim().toLowerCase();
  if (lowerCodec.includes("alac") || lowerCodec.includes("apple lossless")) {
    return true;
  }
  const ext = path.extname(filePath).toLowerCase();
  return TRANSCODE_EXTENSIONS.has(ext);
}

export interface AudioTranscoderDeps {
  cacheDir: string;
  logger?: FastifyBaseLogger;
}

/**
 * Transparently converts browser-unsupported lossless tracks (such as ALAC .m4a)
 * into cached lossless FLAC files on first playback so Chrome/Firefox/Edge play
 * them with full bit-exact quality and HTTP 206 byte-range seeking, without ever
 * modifying the user's original audio files.
 *
 * Uses ffmpeg when available (Linux/Docker/macOS) and falls back to macOS's
 * built-in /usr/bin/afconvert automatically.
 */
export class AudioTranscoder {
  private readonly cacheDir: string;
  private readonly logger?: FastifyBaseLogger;
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(deps: AudioTranscoderDeps) {
    this.cacheDir = path.resolve(deps.cacheDir);
    this.logger = deps.logger;
  }

  async ensureBrowserPlayableFlac(sourcePath: string): Promise<string> {
    const resolvedSource = path.resolve(sourcePath);
    const stat = await fsp.stat(resolvedSource);
    const cacheKey = crypto
      .createHash("sha256")
      .update(`${resolvedSource}:${stat.size}:${Math.floor(stat.mtimeMs)}`)
      .digest("hex")
      .slice(0, 24);

    const targetPath = path.join(this.cacheDir, `${cacheKey}.flac`);
    if (fs.existsSync(targetPath)) {
      return targetPath;
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const work = this.transcodeToFlac(resolvedSource, targetPath).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, work);
    return work;
  }

  private async transcodeToFlac(sourcePath: string, targetPath: string): Promise<string> {
    await fsp.mkdir(this.cacheDir, { recursive: true });
    const tempPath = `${targetPath}.${process.pid}-${Date.now()}.tmp.flac`;

    try {
      const converted = await this.tryFfmpeg(sourcePath, tempPath)
        .then(() => true)
        .catch(async (ffmpegErr: unknown) => {
          const code = (ffmpegErr as NodeJS.ErrnoException)?.code;
          if (process.platform === "darwin" && fs.existsSync("/usr/bin/afconvert")) {
            await this.tryAfconvert(sourcePath, tempPath);
            return true;
          }
          if (code === "ENOENT") {
            throw new Error(
              "ffmpeg is not installed on this server to transcode ALAC/unsupported audio for browser playback.",
            );
          }
          throw ffmpegErr;
        });

      if (!converted || !fs.existsSync(tempPath)) {
        throw new Error("Audio transcoding produced no output file.");
      }

      await fsp.rename(tempPath, targetPath);
      this.logger?.info(
        { source: path.basename(sourcePath), cached: path.basename(targetPath) },
        "Transcoded lossless track to cached FLAC for browser playback",
      );
      return targetPath;
    } catch (err) {
      await fsp.unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  private async tryFfmpeg(sourcePath: string, tempPath: string): Promise<void> {
    await execFileAsync(
      "ffmpeg",
      ["-v", "error", "-y", "-i", sourcePath, "-vn", "-c:a", "flac", tempPath],
      { timeout: 120_000 },
    );
  }

  private async tryAfconvert(sourcePath: string, tempPath: string): Promise<void> {
    await execFileAsync(
      "/usr/bin/afconvert",
      ["-f", "flac", "-d", "flac", sourcePath, tempPath],
      { timeout: 120_000 },
    );
  }
}
