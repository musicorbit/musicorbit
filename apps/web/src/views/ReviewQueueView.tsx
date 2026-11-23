import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderInput,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import type {
  ApplyTaggingRequest,
  ImportItemSummary,
  ImportsListResponse,
  InboxScanResult,
} from "@musicorbit/shared";
import { applyImport, dismissImport, fetchImports, scanInbox } from "../api/client";
import { RetagAlbumModal } from "../components/RetagAlbumModal";
import { formatBitrate, formatCodec } from "../utils/format";

interface ReviewQueueViewProps {
  onLibraryChanged: () => void;
}

export function ReviewQueueView({ onLibraryChanged }: ReviewQueueViewProps) {
  const [data, setData] = useState<ImportsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<InboxScanResult | null>(null);
  const [filter, setFilter] = useState<"needs_review" | "all">("needs_review");
  const [activeItem, setActiveItem] = useState<ImportItemSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadImports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchImports(filter === "needs_review" ? "needs_review" : undefined);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Review Queue");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadImports();
  }, [loadImports]);

  const handleScanInbox = async () => {
    setScanning(true);
    setError(null);
    try {
      const summary = await scanInbox();
      setLastScan(summary);
      await loadImports();
      if (summary.autoImported > 0) {
        onLibraryChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inbox scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleApply = async (itemId: number, payload: ApplyTaggingRequest) => {
    await applyImport(itemId, payload);
    await loadImports();
    onLibraryChanged();
  };

  const handleDismiss = async (itemId: number) => {
    setError(null);
    try {
      await dismissImport(itemId);
      await loadImports();
      onLibraryChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss item");
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Import &amp; Review Queue
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Automatically matches new downloads on MusicBrainz, tags them, and files them as{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">
              Artist / Album
            </code>
            . Uncertain matches wait here for your confirmation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={scanning}
            onClick={() => void handleScanInbox()}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
          >
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderInput className="h-4 w-4" />
            )}
            {scanning ? "Scanning Inbox…" : "Scan Inbox"}
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadImports()}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-45"
            title="Refresh Review Queue"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Downloads inbox path banner */}
      {data && !data.downloadsDir.exists && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm text-zinc-300">
          <p className="font-medium text-zinc-100">Downloads inbox folder not created yet</p>
          <p className="mt-1 text-xs text-zinc-400">
            Create{" "}
            <code className="rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-200">
              {data.downloadsDir.path}
            </code>{" "}
            (or point{" "}
            <code className="rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-200">DOWNLOADS_DIR</code>{" "}
            in <code className="rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-200">.env</code> at your
            slskd downloads directory) and click <strong>Scan Inbox</strong>. You can also fix tags
            on any already-imported album from its Album page using <strong>Fix Tags</strong>.
          </p>
        </div>
      )}

      {lastScan && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            Inbox scan finished: <strong>{lastScan.discoveredFolders}</strong> folders found ·{" "}
            <strong>{lastScan.autoImported}</strong> auto-imported ·{" "}
            <strong>{lastScan.needsReview}</strong> waiting for review
            {lastScan.skipped > 0 ? ` · ${lastScan.skipped} unchanged` : ""}
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <button
          type="button"
          onClick={() => setFilter("needs_review")}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            filter === "needs_review"
              ? "bg-zinc-800 text-zinc-50"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          Needs Review
          {data && data.needsReviewCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
              {data.needsReviewCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            filter === "all"
              ? "bg-zinc-800 text-zinc-50"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          All History
        </button>
      </div>

      {/* Items List */}
      {loading && !data ? (
        <p className="text-sm text-zinc-400">Loading review queue…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-14 text-center">
          <Sparkles className="h-7 w-7 text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-200">
            {filter === "needs_review" ? "Review queue is clear" : "No import history yet"}
          </p>
          <p className="mt-1 max-w-md text-xs text-zinc-500">
            Drop an album folder into your downloads inbox and click <strong>Scan Inbox</strong>,
            or open any album in your library and click <strong>Fix Tags</strong> to match it
            against MusicBrainz.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isSingle = item.files.length === 1;
            const singleFile = isSingle ? item.files[0] : null;
            const headline = singleFile
              ? `${singleFile.currentTitle}${singleFile.currentArtist ? ` — ${singleFile.currentArtist}` : ""}`
              : item.folderName;
            const dupList = item.duplicates ?? [];

            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/45 p-4"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-zinc-100">{headline}</p>
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
                      {isSingle ? "Single Track" : `${item.trackCount} tracks`}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        item.status === "needs_review"
                          ? "bg-amber-500/15 text-amber-300"
                          : item.status === "imported"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : item.status === "failed"
                              ? "bg-red-500/15 text-red-300"
                              : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {item.status.replace("_", " ")}
                    </span>
                    {singleFile?.codec && (
                      <span className="rounded bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400 ring-1 ring-zinc-800">
                        {formatCodec(singleFile.codec)}
                        {singleFile.bitrate ? ` · ${formatBitrate(singleFile.bitrate)}` : ""}
                      </span>
                    )}
                    {item.confidence > 0 && (
                      <span className="text-[11px] text-zinc-500">
                        Best match: {Math.round(item.confidence)}%
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-zinc-400">
                    {isSingle ? (
                      <>
                        File: <span className="text-zinc-300">{singleFile?.basename}</span>
                        {item.detectedAlbum ? (
                          <>
                            {" "}
                            · Album tag: <span className="text-zinc-300">{item.detectedAlbum}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        Detected: <span className="text-zinc-200">{item.detectedArtist}</span> —{" "}
                        <span className="text-zinc-200">{item.detectedAlbum}</span>
                        {item.files.length > 0 && (
                          <span className="text-zinc-500">
                            {" "}
                            ({item.files
                              .slice(0, 3)
                              .map((f) => f.currentTitle)
                              .join(", ")}
                            {item.files.length > 3 ? `, +${item.files.length - 3} more` : ""})
                          </span>
                        )}
                      </>
                    )}
                  </p>

                  {dupList.length > 0 && (
                    <p className="text-xs text-amber-300">
                      Duplicate in library:{" "}
                      {dupList
                        .slice(0, 2)
                        .map(
                          (d) =>
                            `${d.existingTitle} (${formatCodec(d.existingCodec)}${
                              d.existingBitrate ? ` ${formatBitrate(d.existingBitrate)}` : ""
                            }${d.isUpgrade ? " → Upgrade available" : ""})`,
                        )
                        .join(", ")}
                    </p>
                  )}

                  {item.matchedAlbum && !isSingle && (
                    <p className="text-xs text-zinc-500">
                      MusicBrainz suggestion:{" "}
                      <span className="text-zinc-300">
                        {item.matchedArtist} — {item.matchedAlbum}
                        {item.matchedYear ? ` (${item.matchedYear})` : ""}
                      </span>
                    </p>
                  )}

                  {item.errorMessage && (
                    <p className="text-xs text-red-400">{item.errorMessage}</p>
                  )}
                </div>

                {item.status === "needs_review" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveItem(item)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Review &amp; Tag
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDismiss(item.id)}
                      title="Dismiss without deleting files"
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeItem && (
        <RetagAlbumModal
          mode="import"
          heading={
            activeItem.files.length === 1
              ? `Review Song — ${activeItem.files[0]?.currentTitle ?? activeItem.folderName}`
              : `Review & Tag Album — ${activeItem.folderName}`
          }
          subheading={activeItem.sourceDir}
          initialArtist={
            activeItem.files.length === 1 && activeItem.files[0]?.currentArtist
              ? activeItem.files[0].currentArtist
              : (activeItem.matchedArtist ?? activeItem.detectedArtist)
          }
          initialAlbum={
            activeItem.files.length === 1
              ? activeItem.detectedAlbum
              : (activeItem.matchedAlbum ?? activeItem.detectedAlbum)
          }
          initialYear={activeItem.matchedYear ?? activeItem.detectedYear}
          initialCandidates={activeItem.candidates}
          duplicates={activeItem.duplicates ?? []}
          initialTracks={activeItem.files.map((f, idx) => ({
            filePath: f.filePath,
            basename: f.basename,
            title: f.currentTitle,
            artist: f.currentArtist || activeItem.detectedArtist,
            trackNumber: f.trackNumber ?? idx + 1,
            discNumber: f.discNumber ?? 1,
            codec: f.codec ?? null,
            bitrate: f.bitrate ?? null,
          }))}
          onClose={() => setActiveItem(null)}
          onSubmit={(payload) => handleApply(activeItem.id, payload)}
        />
      )}
    </div>
  );
}
