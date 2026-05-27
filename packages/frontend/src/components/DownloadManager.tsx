import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDownloads,
  pauseDownload,
  resumeDownload,
  retryDownload,
  cancelDownload,
} from "../api/client.ts";
import { useState, useEffect, useCallback } from "react";
import type { Download } from "../types/index.ts";
import { useMutationWithToast } from "../hooks/useMutationWithToast.ts";
import {
  Download as DownloadIcon,
  Play,
  Pause,
  X,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  HardDrive,
  Calendar,
  ExternalLink,
  Trash2,
} from "lucide-react";

const DOWNLOAD_HISTORY_KEY = "panelshelf-download-history";

interface DownloadHistoryEntry {
  url: string;
  detailUrl: string | null;
  title: string | null;
  provider: string;
  timestamp: number;
}

const STATUS_CONFIG = {
  pending: { icon: Clock, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  running: { icon: Loader2, color: "text-panel-400", bg: "bg-panel-500/10", border: "border-panel-500/20" },
  paused: { icon: Pause, color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/20" },
  completed: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  failed: { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
} as const;

function formatBytes(bytes: number | null): string {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec: number | null): string {
  if (!bytesPerSec) return "";
  return `${formatBytes(bytesPerSec)}/s`;
}

interface DownloadRowProps {
  download: Download;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}

function DownloadRow({ download, onPause, onResume, onRetry, onCancel }: DownloadRowProps) {
  const status = STATUS_CONFIG[download.status];
  const StatusIcon = status.icon;

  return (
    <div className={`card p-4 ${status.bg} ${status.border}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-4 h-4 ${status.color} ${download.status === "running" ? "animate-spin" : ""}`} />
            <span className="font-medium text-gray-200 truncate">
              {download.fileName || download.url.split("/").pop() || "Download"}
            </span>
            <span className={`badge ${status.bg} ${status.color}`}>
              {download.status.charAt(0).toUpperCase() + download.status.slice(1)}
            </span>
          </div>

          {/* Progress bar for running/paused */}
          {(download.status === "running" || download.status === "paused") && (
            <div className="mt-3 space-y-1">
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    download.status === "running" ? "bg-panel-500" : "bg-gray-600"
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, download.progress))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {formatBytes(download.downloadedBytes)} / {formatBytes(download.totalBytes)}
                </span>
                <span>{Math.round(download.progress)}%</span>
              </div>
            </div>
          )}

          {/* Info row */}
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              {formatBytes(download.totalBytes)}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(download.createdAt).toLocaleString()}
            </span>
            {download.retryCount > 0 && (
              <span>Retry {download.retryCount}/{download.maxRetries}</span>
            )}
          </div>

          {/* Error */}
          {download.errorLog && (
            <p className="mt-2 text-xs text-red-400 bg-red-500/5 rounded-lg px-2 py-1">
              {download.errorLog}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {download.status === "running" && (
            <button onClick={() => onPause(download.id)} className="btn-ghost btn-xs" title="Pause">
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
          {download.status === "paused" && (
            <button onClick={() => onResume(download.id)} className="btn-ghost btn-xs" title="Resume">
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {download.status === "failed" && (
            <button onClick={() => onRetry(download.id)} className="btn-ghost btn-xs" title="Retry">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {(download.status === "running" || download.status === "paused" || download.status === "pending") && (
            <button onClick={() => onCancel(download.id)} className="btn-ghost btn-xs text-red-400 hover:text-red-300" title="Cancel">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DownloadManager() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Download history — reads from localStorage (written by CatalogView)
  const [history, setHistory] = useState<DownloadHistoryEntry[]>(() => {
    try {
      const stored = localStorage.getItem(DOWNLOAD_HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Re-read when the page gains focus (user may have clicked downloads then navigated here)
  const refreshHistory = useCallback(() => {
    try {
      const stored = localStorage.getItem(DOWNLOAD_HISTORY_KEY);
      setHistory(stored ? JSON.parse(stored) : []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("focus", refreshHistory);
    return () => window.removeEventListener("focus", refreshHistory);
  }, [refreshHistory]);

  const clearHistoryEntry = useCallback((url: string) => {
    const next = history.filter((e) => e.url !== url);
    setHistory(next);
    localStorage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(next));
  }, [history]);

  const clearAllHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(DOWNLOAD_HISTORY_KEY);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["downloads", statusFilter],
    queryFn: () => fetchDownloads({ status: statusFilter || undefined }),
    refetchInterval: 2000, // Poll for updates
  });

  const pauseMutation = useMutationWithToast({
    mutationFn: pauseDownload,
    toast: {
      success: { message: "Download paused", type: "info" },
      error: (err: Error) => ({ message: "Failed to pause download", description: err.message }),
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const resumeMutation = useMutationWithToast({
    mutationFn: resumeDownload,
    toast: {
      success: { message: "Download resumed", type: "success" },
      error: (err: Error) => ({ message: "Failed to resume download", description: err.message }),
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const retryMutation = useMutationWithToast({
    mutationFn: retryDownload,
    toast: {
      success: { message: "Download queued for retry", type: "info" },
      error: (err: Error) => ({ message: "Failed to retry download", description: err.message }),
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const cancelMutation = useMutationWithToast({
    mutationFn: cancelDownload,
    toast: {
      success: { message: "Download cancelled", type: "warning" },
      error: (err: Error) => ({ message: "Failed to cancel download", description: err.message }),
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const downloads = data?.items || [];
  const statusCounts = {
    all: data?.total || 0,
    pending: downloads.filter((d) => d.status === "pending").length,
    running: downloads.filter((d) => d.status === "running").length,
    completed: downloads.filter((d) => d.status === "completed").length,
    failed: downloads.filter((d) => d.status === "failed").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Downloads</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your download queue</p>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800 overflow-x-auto">
        {[
          { key: "", label: "All", count: statusCounts.all },
          { key: "running", label: "Active", count: statusCounts.running },
          { key: "pending", label: "Pending", count: statusCounts.pending },
          { key: "completed", label: "Completed", count: statusCounts.completed },
          { key: "failed", label: "Failed", count: statusCounts.failed },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`tab ${statusFilter === tab.key ? "tab-active" : ""}`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-xs opacity-60">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Downloads list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-panel-500" />
        </div>
      ) : downloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <DownloadIcon className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">No active downloads</p>
          <p className="text-sm mt-1">
            Enqueue downloads from the catalog detail page
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {downloads.map((d) => (
            <DownloadRow
              key={d.id}
              download={d}
              onPause={(id) => pauseMutation.mutate(id)}
              onResume={(id) => resumeMutation.mutate(id)}
              onRetry={(id) => retryMutation.mutate(id)}
              onCancel={(id) => cancelMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Download history — items opened externally from the catalog */}
      {history.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-gray-500" />
              External Download History
              <span className="text-xs text-gray-600 font-normal">({history.length})</span>
            </h2>
            <button
              onClick={clearAllHistory}
              className="btn-ghost btn-xs text-gray-500 hover:text-red-400"
              title="Clear all history"
            >
              <Trash2 className="w-3 h-3" />
              Clear all
            </button>
          </div>

          <div className="space-y-2">
            {history.map((entry) => (
              <div
                key={entry.url}
                className="card p-3 bg-gray-900/50 border-gray-700/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="text-sm font-medium text-gray-200 truncate">
                        {entry.title || entry.url.split("/").pop() || entry.url}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="text-panel-400">{entry.provider}</span>
                      <span>{new Date(entry.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1.5 flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />
                      Opened in external browser &mdash; cannot track download progress
                    </p>
                    {entry.detailUrl && (
                      <a
                        href={entry.detailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-panel-600 hover:text-panel-400 mt-1 inline-block"
                      >
                        View original post &rarr;
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => clearHistoryEntry(entry.url)}
                    className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors shrink-0"
                    title="Remove from history"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
