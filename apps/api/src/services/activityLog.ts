import type { FastifyBaseLogger } from "fastify";
import type {
  ActivityLogCategory,
  ActivityLogEntry,
  ActivityLogLevel,
  ActivityLogsResponse,
} from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";

const MAX_RETAINED_LOGS = 2000;

export interface ActivityLogServiceDeps {
  dbContext: DbContext;
  logger?: FastifyBaseLogger;
}

export interface ListLogsOptions {
  level?: ActivityLogLevel;
  category?: ActivityLogCategory;
  search?: string;
  limit?: number;
  userId?: number;
}

interface RawLogRow {
  id: number;
  level: string;
  category: string;
  message: string;
  detailsJson: string | null;
  createdAt: number;
}

/**
 * Structured activity log persisted in SQLite (auto-pruned to the newest 2,000 rows)
 * so users have live, filterable visibility into scans, post-processing moves/upgrades,
 * watcher ticks, playlist backfills, and errors right in the UI.
 */
export class ActivityLogService {
  private readonly dbContext: DbContext;
  private readonly logger?: FastifyBaseLogger;
  private writeCounter = 0;

  constructor(deps: ActivityLogServiceDeps) {
    this.dbContext = deps.dbContext;
    this.logger = deps.logger;
  }

  log(
    level: ActivityLogLevel,
    category: ActivityLogCategory,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const now = Date.now();
    const detailsJson = details && Object.keys(details).length > 0 ? JSON.stringify(details) : null;

    try {
      this.dbContext.sqlite
        .prepare(
          `
          INSERT INTO activity_logs (level, category, message, details_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
        )
        .run(level, category, message, detailsJson, now);

      this.writeCounter += 1;
      if (this.writeCounter % 50 === 0) {
        this.pruneOldLogs();
      }
    } catch {
      // Never let logging failures break core operations
    }

    if (this.logger) {
      const payload = { category, ...(details ?? {}) };
      if (level === "error") this.logger.error(payload, message);
      else if (level === "warn") this.logger.warn(payload, message);
      else this.logger.info(payload, message);
    }
  }

  info(category: ActivityLogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("info", category, message, details);
  }

  success(category: ActivityLogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("success", category, message, details);
  }

  warn(category: ActivityLogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("warn", category, message, details);
  }

  error(category: ActivityLogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("error", category, message, details);
  }

  list(options?: ListLogsOptions): ActivityLogsResponse {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options?.level) {
      clauses.push("level = ?");
      params.push(options.level);
    }
    if (options?.category) {
      clauses.push("category = ?");
      params.push(options.category);
    }
    if (options?.search?.trim()) {
      clauses.push("(LOWER(message) LIKE ? OR LOWER(COALESCE(details_json, '')) LIKE ?)");
      const like = `%${options.search.trim().toLowerCase()}%`;
      params.push(like, like);
    }
    if (options?.userId !== undefined) {
      clauses.push("json_extract(details_json, '$.userId') = ?");
      params.push(options.userId);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(500, options?.limit ?? 200));

    const totalRow = this.dbContext.sqlite
      .prepare(`SELECT COUNT(*) AS cnt FROM activity_logs ${whereSql}`)
      .get(...params) as { cnt: number };

    const rows = this.dbContext.sqlite
      .prepare(
        `
        SELECT
          id,
          level,
          category,
          message,
          details_json AS detailsJson,
          created_at AS createdAt
        FROM activity_logs
        ${whereSql}
        ORDER BY id DESC
        LIMIT ?
      `,
      )
      .all(...params, limit) as RawLogRow[];

    const entries: ActivityLogEntry[] = rows.map((r) => {
      let details: Record<string, unknown> | null = null;
      if (r.detailsJson) {
        try {
          details = JSON.parse(r.detailsJson) as Record<string, unknown>;
        } catch {
          details = null;
        }
      }
      return {
        id: r.id,
        level: r.level as ActivityLogLevel,
        category: r.category as ActivityLogCategory,
        message: r.message,
        details,
        createdAt: new Date(r.createdAt).toISOString(),
      };
    });

    return {
      total: totalRow?.cnt ?? entries.length,
      entries,
    };
  }

  exportPlainText(limit = 1000, userId?: number): string {
    const { entries } = this.list({ limit, userId });
    // Chronological order for downloaded .log files
    const lines = [...entries].reverse().map((e) => {
      const detailStr = e.details ? ` | ${JSON.stringify(e.details)}` : "";
      return `[${e.createdAt}] [${e.level.toUpperCase().padEnd(7)}] [${e.category}] ${e.message}${detailStr}`;
    });
    return `${lines.join("\n")}\n`;
  }

  clear(): number {
    const res = this.dbContext.sqlite.prepare("DELETE FROM activity_logs").run();
    return res.changes;
  }

  private pruneOldLogs(): void {
    this.dbContext.sqlite
      .prepare(
        `
        DELETE FROM activity_logs
        WHERE id NOT IN (
          SELECT id FROM activity_logs ORDER BY id DESC LIMIT ?
        )
      `,
      )
      .run(MAX_RETAINED_LOGS);
  }
}
