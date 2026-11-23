import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  ScrollText,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  ActivityLogCategory,
  ActivityLogEntry,
  ActivityLogLevel,
  ActivityLogsResponse,
} from "@musicorbit/shared";
import {
  clearActivityLogs,
  fetchActivityLogs,
  getActivityLogsExportUrl,
} from "../api/client";

const CATEGORY_OPTIONS: Array<{ id: "" | ActivityLogCategory; label: string }> = [
  { id: "", label: "All" },
  { id: "importer", label: "Post-Processing" },
  { id: "scanner", label: "Scanner" },
  { id: "watcher", label: "Watcher" },
  { id: "playlist", label: "Playlists" },
  { id: "acquisition", label: "Soulseek" },
  { id: "metadata", label: "Metadata" },
  { id: "system", label: "System" },
];

const LEVEL_OPTIONS: Array<{ id: "" | ActivityLogLevel; label: string }> = [
  { id: "", label: "All Levels" },
  { id: "success", label: "Success" },
  { id: "info", label: "Info" },
  { id: "warn", label: "Warnings" },
  { id: "error", label: "Errors" },
];

function levelBadgeClass(level: ActivityLogLevel): string {
  switch (level) {
    case "success":
      return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30";
    case "warn":
      return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30";
    case "error":
      return "bg-red-500/15 text-red-300 ring-1 ring-red-500/30";
    default:
      return "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30";
  }
}

function levelShortLabel(level: ActivityLogLevel): string {
  switch (level) {
    case "success":
      return "OK";
    case "warn":
      return "WARN";
    case "error":
      return "ERR";
    default:
      return "INFO";
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function LogsView() {
  const [data, setData] = useState<ActivityLogsResponse | null>(null);
  const [category, setCategory] = useState<"" | ActivityLogCategory>("");
  const [level, setLevel] = useState<"" | ActivityLogLevel>("");
  const [query, setQuery] = useState("");
  const [liveTail, setLiveTail] = useState(true);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetchActivityLogs({
          category: category || undefined,
          level: level || undefined,
          q: query.trim() || undefined,
          limit: 250,
        });
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load activity logs");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [category, level, query],
  );

  // Fetch when filters change (debounced for search input)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLogs(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  // Live auto-refresh every 3s while toggled on
  useEffect(() => {
    if (!liveTail) return;
    const timer = window.setInterval(() => {
      void loadLogs(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [liveTail, loadLogs]);

  const handleClear = async () => {
    setClearing(true);
    setError(null);
    try {
      await clearActivityLogs();
      setExpandedIds({});
      await loadLogs(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear logs");
    } finally {
      setClearing(false);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const entries: ActivityLogEntry[] = data?.entries ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Activity Logs</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Live visibility into library scans, post-processing moves &amp; upgrades, auto-watch
            checks, playlist backfills, and errors.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLiveTail((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              liveTail
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                liveTail ? "animate-pulse bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            {liveTail ? "Live (3s)" : "Paused"}
          </button>

          <button
            type="button"
            onClick={() => void loadLogs(false)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <a
            href={getActivityLogsExportUrl()}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            Export .log
          </a>

          <button
            type="button"
            disabled={clearing || entries.length === 0}
            onClick={() => void handleClear()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3 rounded-xl border border-zinc-800/90 bg-zinc-900/45 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search log messages, file paths, or track names…"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-8 pl-9 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear log filter"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {LEVEL_OPTIONS.map((opt) => (
              <button
                key={opt.id || "all"}
                type="button"
                onClick={() => setLevel(opt.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  level === opt.id
                    ? "bg-amber-500 text-zinc-950"
                    : "bg-zinc-950 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/70 pt-3">
          <div className="flex flex-wrap items-center gap-1">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.id || "all-cat"}
                type="button"
                onClick={() => setCategory(opt.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  category === opt.id
                    ? "bg-zinc-800 text-zinc-50 ring-1 ring-zinc-700"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {data && (
            <span className="text-[11px] text-zinc-500">
              Showing {entries.length} of {data.total} {data.total === 1 ? "event" : "events"}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Log Feed */}
      {loading && !data ? (
        <p className="text-sm text-zinc-400">Loading activity logs…</p>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
          <ScrollText className="h-7 w-7 text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-200">No matching activity logs yet</p>
          <p className="mt-1 max-w-md text-xs text-zinc-500">
            Run a library scan, drop a track into your downloads folder, or import a playlist to see
            live events appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/70 font-mono text-xs">
          {entries.map((entry) => {
            const hasDetails = Boolean(entry.details && Object.keys(entry.details).length > 0);
            const isExpanded = Boolean(expandedIds[entry.id]);

            return (
              <div key={entry.id} className="transition hover:bg-zinc-900/50">
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span
                    className="w-28 shrink-0 pt-0.5 text-[11px] text-zinc-500"
                    title={entry.createdAt}
                  >
                    {formatDateShort(entry.createdAt)} {formatTimestamp(entry.createdAt)}
                  </span>

                  <span
                    className={`w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold ${levelBadgeClass(entry.level)}`}
                  >
                    {levelShortLabel(entry.level)}
                  </span>

                  <span className="w-24 shrink-0 truncate rounded bg-zinc-900 px-1.5 py-0.5 text-center text-[10px] text-zinc-400 ring-1 ring-zinc-800">
                    {entry.category}
                  </span>

                  <p className="min-w-0 flex-1 font-sans text-xs leading-relaxed text-zinc-200">
                    {entry.message}
                  </p>

                  {hasDetails && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.id)}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? "Hide log details" : "Show log details"}
                      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      Details
                    </button>
                  )}
                </div>

                {hasDetails && isExpanded && (
                  <div className="border-t border-zinc-800/50 bg-zinc-900/60 px-4 py-2.5 pl-12 text-[11px] text-zinc-400">
                    <dl className="grid gap-1 sm:grid-cols-[160px_minmax(0,1fr)]">
                      {Object.entries(entry.details!).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="font-semibold text-zinc-500">{k}</dt>
                          <dd className="break-all text-zinc-300">
                            {typeof v === "string" ? v : JSON.stringify(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
