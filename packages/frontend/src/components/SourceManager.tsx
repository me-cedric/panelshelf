import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProviders,
  toggleProvider,
  clearProviderCache,
  clearCache,
  fetchSettings,
  updateSettings,
} from "../api/client.ts";
import { useMutationWithToast } from "../hooks/useMutationWithToast.ts";
import {
  Globe,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Database,
  Eraser,
  MousePointer2,
  List,
  AlertCircle,
  FolderOpen,
  Save,
} from "lucide-react";
import { PROVIDER_ICONS, PROVIDER_DESCRIPTIONS } from "../constants/providers.ts";
import { useToast } from "./Toast.tsx";

const ROOT_MARGIN_KEY = "panelshelf-root-margin";
const PAGE_SIZE_KEY = "panelshelf-page-size";

export default function SourceManager() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: () => fetchProviders().then((r) => r.providers),
  });

  const toggleMutation = useMutationWithToast({
    mutationFn: toggleProvider,
    toast: {
      success: (data, providerId) => {
        const providers = queryClient.getQueryData<Array<any>>(["providers"]);
        const p = providers?.find((pr) => pr.id === providerId);
        return {
          message: data.provider.enabled
            ? `"${p?.name || providerId}" enabled`
            : `"${p?.name || providerId}" disabled`,
          description: data.provider.enabled
            ? "Source will be polled for new items on refresh"
            : "Source will no longer be polled for new items",
        };
      },
      error: (err: Error) => ({
        message: "Failed to toggle provider",
        description: err.message,
      }),
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  const clearCacheMutation = useMutationWithToast({
    mutationFn: clearCache,
    toast: {
      success: "All provider caches cleared",
      error: (err: Error) => ({
        message: "Failed to clear cache",
        description: err.message,
      }),
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      queryClient.invalidateQueries({ queryKey: ["live-search"] });
    },
  });

  const clearProviderCacheMutation = useMutationWithToast({
    mutationFn: clearProviderCache,
    toast: {
      success: (_data, providerId) => {
        const providers = queryClient.getQueryData<Array<any>>(["providers"]);
        const p = providers?.find((pr) => pr.id === providerId);
        return { message: `Cache cleared for "${p?.name || providerId}"` };
      },
      error: (err: Error) => ({
        message: "Failed to clear cache",
        description: err.message,
      }),
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      queryClient.invalidateQueries({ queryKey: ["live-search"] });
    },
  });

  const handleClearProviderCache = (providerId: string) => {
    clearProviderCacheMutation.mutate(providerId);
  };

  const providers = data || [];

  // ── Download Directory ──
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchSettings().then(r => r.settings),
  });
  const [downloadDir, setDownloadDir] = useState("");
  const [downloadDirDirty, setDownloadDirDirty] = useState(false);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  // Sync from backend on load
  useEffect(() => {
    if (settingsQuery.data && !downloadDirDirty) {
      setDownloadDir((settingsQuery.data.downloadDirectory as string) || "");
    }
  }, [settingsQuery.data, downloadDirDirty]);

  const saveDirMutation = useMutationWithToast({
    mutationFn: (dir: string) => updateSettings({ downloadDirectory: dir }),
    toast: {
      success: "Download directory saved",
      error: (err: Error) => ({
        message: "Failed to save download directory",
        description: err.message,
      }),
    },
    onSuccess: () => {
      setDownloadDirDirty(false);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const handleBrowseDir = useCallback(async () => {
    // Try Tauri native dialog first (desktop app)
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Select Download Directory" });
      if (selected && typeof selected === "string") {
        setDownloadDir(selected);
        setDownloadDirDirty(true);
      } else if (selected && typeof selected === "object" && "path" in selected) {
        setDownloadDir((selected as any).path);
        setDownloadDirDirty(true);
      }
      return;
    } catch {
      // Not running in Tauri — try web methods
    }

    // Try File System Access API (Chromium — best UX)
    try {
      const handle = await (window as any).showDirectoryPicker();
      // Get the readable path from the handle
      if (handle.name) {
        setDownloadDir(handle.name);
        setDownloadDirDirty(true);
      }
      return;
    } catch {
      // Not available or user cancelled — fall through to hidden input
    }

    // Fallback: hidden <input webkitdirectory>
    hiddenInputRef.current?.click();
  }, []);

  const handleHiddenDirPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // webkitRelativePath includes the full relative path from the selected dir
      const path = file.webkitRelativePath;
      const dirName = path.split("/")[0];
      if (dirName) {
        // Note: we only get the folder name, not the full absolute path,
        // but this gives us a starting point
        setDownloadDir(dirName);
        setDownloadDirDirty(true);
      }
    }
    // Reset so same folder can be re-selected
    e.target.value = "";
  }, []);

  const handleSaveDir = useCallback(() => {
    if (downloadDir.trim()) {
      saveDirMutation.mutate(downloadDir.trim());
    }
  }, [downloadDir, saveDirMutation]);

  const { addToast } = useToast();

  // ── Tauri drag-and-drop: listen for folder drops on the window ──
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const appWindow = getCurrentWebviewWindow();
        unlisten = await appWindow.onDragDropEvent((event) => {
          if (event.payload.type === "drop") {
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              const droppedPath = paths[0];
              // Show a toast asking if they want to use this as download dir
              addToast({
                type: "info",
                message: `Folder dropped: ${droppedPath}`,
                description: "Set this as your download directory? Click Save below to confirm.",
              });
              setDownloadDir(droppedPath);
              setDownloadDirDirty(true);
            }
          }
        });
      } catch {
        // Not running in Tauri — ignore
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [addToast]);

  // Infinite scroll trigger distance — shared with CatalogView via localStorage
  const [scrollThreshold, setScrollThreshold] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(ROOT_MARGIN_KEY);
      const val = stored ? parseInt(stored, 10) : 800;
      return Number.isFinite(val) && val >= 0 ? val : 800;
    } catch {
      return 800;
    }
  });

  const handleScrollThresholdChange = (val: number) => {
    setScrollThreshold(val);
    localStorage.setItem(ROOT_MARGIN_KEY, String(val));
  };

  // Page size — shared with CatalogView via localStorage
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(PAGE_SIZE_KEY);
      const val = stored ? parseInt(stored, 10) : 50;
      return Number.isFinite(val) && val >= 10 && val <= 200 ? val : 50;
    } catch {
      return 50;
    }
  });

  const handlePageSizeChange = (val: number) => {
    setPageSize(val);
    localStorage.setItem(PAGE_SIZE_KEY, String(val));
  };

  return (
    <div className="space-y-6">
      {/* Provider Management info box — placed at the top */}
      <div className="card p-4 border-yellow-500/20 bg-yellow-500/5">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-yellow-300">
              Provider Management
            </h4>
            <ul className="mt-1 text-xs text-yellow-300/70 space-y-1">
              <li>
                • Toggle a provider on to create an active source — it will be
                polled for new items on refresh
              </li>
              <li>
                • Toggle a provider off to stop polling — existing catalog items
                remain in the database
              </li>
              <li>
                • "Clear Cache" invalidates in-memory search results so the
                next fetch gets fresh data
              </li>
              <li>
                • "Clear All Cache" does the same for every provider at once
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Providers</h1>
          <p className="text-sm text-gray-500 mt-1">
            Built-in source providers — enable or disable each with a single toggle
          </p>
        </div>
        <button
          onClick={() => clearCacheMutation.mutate()}
          disabled={clearCacheMutation.isPending}
          className="btn-ghost btn-sm"
          title="Clear all in-memory provider caches"
        >
          <Eraser className="w-4 h-4" />
          {clearCacheMutation.isPending ? "Clearing..." : "Clear All Cache"}
        </button>
      </div>

      {/* Provider list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-panel-500" />
        </div>
      ) : providers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Globe className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">No providers registered</p>
          <p className="text-sm mt-1">
            Providers are registered on the backend — check the server logs
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {providers.filter((p) => p.configurable).map((provider) => {
            const Icon = PROVIDER_ICONS[provider.id] || Database;
            return (
              <div
                key={provider.id}
                className={`card-hover p-5 transition-all duration-200 ${
                  !provider.configurable
                    ? "border-panel-500/20 bg-panel-500/5"
                    : provider.enabled
                      ? "border-emerald-500/20"
                      : "border-panel-500/30"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: icon + info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          provider.enabled
                            ? "bg-panel-600/30 text-panel-300"
                            : "bg-panel-700/30 text-gray-500"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-gray-200 truncate">
                          {provider.name}
                        </h3>
                        <span className="text-xs text-gray-500">
                          {provider.id}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                      {PROVIDER_DESCRIPTIONS[provider.id] ||
                        "Built-in content provider."}
                    </p>

                    {/* Status badges */}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {provider.configurable ? (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                            provider.enabled
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-gray-700/50 text-gray-400 border border-gray-700"
                          }`}
                        >
                          {provider.enabled ? (
                            <>
                              <ToggleRight className="w-3 h-3" />
                              Enabled
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="w-3 h-3" />
                              Disabled
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-panel-500/10 text-panel-400 border border-panel-500/20">
                          <Database className="w-3 h-3" />
                          Built-in
                        </span>
                      )}
                      {provider.lastFetchedAt && (
                        <span className="text-[11px] text-gray-600">
                          Last synced:{" "}
                          {new Date(provider.lastFetchedAt).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {/* Toggle button (only for configurable providers) */}
                    {provider.configurable && (
                      <button
                        onClick={() => toggleMutation.mutate(provider.id)}
                        disabled={toggleMutation.isPending}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-panel-500 focus:ring-offset-2 focus:ring-offset-panel-700 ${
                          provider.enabled
                            ? "bg-emerald-500"
                            : "bg-gray-700"
                        }`}
                        title={
                          provider.enabled ? "Disable provider" : "Enable provider"
                        }
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform duration-200 ${
                            provider.enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    )}

                    {/* Clear cache button */}
                    <button
                      onClick={() =>
                        handleClearProviderCache(provider.id)
                      }
                      disabled={clearProviderCacheMutation.isPending && clearProviderCacheMutation.variables === provider.id}
                      className="btn-ghost btn-xs text-gray-500 hover:text-panel-300"
                      title="Clear cached data for this provider"
                    >
                      {clearProviderCacheMutation.isPending && clearProviderCacheMutation.variables === provider.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Eraser className="w-3.5 h-3.5" />
                      )}
                      Clear Cache
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Scroll threshold setting */}
      <div className="card p-4 border-panel-500/20 bg-panel-500/5">
        <div className="flex items-start gap-3">
          <MousePointer2 className="w-5 h-5 text-panel-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-gray-200">
              Infinite Scroll Trigger Distance
            </h4>
            <p className="text-xs text-gray-500 mt-1">
              How early should the next page start loading? Higher = loads sooner
              (less waiting), but may use more bandwidth.
            </p>
            <div className="flex items-center gap-4 mt-3">
              <input
                type="range"
                min={0}
                max={2000}
                step={50}
                value={scrollThreshold}
                onChange={(e) =>
                  handleScrollThresholdChange(parseInt(e.target.value, 10))
                }
                className="flex-1 h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-panel-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-panel-500 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <span className="text-sm font-medium text-panel-300 tabular-nums w-14 text-right">
                {scrollThreshold}px
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-600 mt-1">
              <span>At viewport (0px)</span>
              <span>Very early (2000px)</span>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              {scrollThreshold === 0
                ? "Next page loads only when you reach the very bottom of the current content."
                : scrollThreshold <= 200
                  ? "Conservative — next page starts loading just before you reach the bottom."
                  : scrollThreshold <= 800
                    ? "Balanced — next page loads roughly one screen height before the bottom."
                    : "Aggressive — next page loads well before you scroll to the bottom."}
            </p>
          </div>
        </div>
      </div>

      {/* Page size setting */}
      <div className="card p-4 border-panel-500/20 bg-panel-500/5">
        <div className="flex items-start gap-3">
          <List className="w-5 h-5 text-panel-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-gray-200">Page Size</h4>
            <p className="text-xs text-gray-500 mt-1">
              How many items to load per page. Larger values mean fewer page loads
              but may take longer to fetch. Changes take effect on the next catalog
              visit.
            </p>
            <div className="flex items-center gap-4 mt-3">
              <input
                type="range"
                min={10}
                max={200}
                step={10}
                value={pageSize}
                onChange={(e) => handlePageSizeChange(parseInt(e.target.value, 10))}
                className="flex-1 h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-panel-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-panel-500 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <span className="text-sm font-medium text-panel-300 tabular-nums w-14 text-right">
                {pageSize} items
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-600 mt-1">
              <span>Compact (10)</span>
              <span>Large (200)</span>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              {pageSize <= 20
                ? "Small pages — quick loads but more page fetches as you scroll."
                : pageSize <= 50
                  ? "Standard — good balance between load speed and scroll distance."
                  : pageSize <= 100
                    ? "Large pages — fewer page loads but each fetch takes longer."
                    : "Very large pages — minimal pagination but highest fetch time per page."}
            </p>
          </div>
        </div>
      </div>

      {/* ── Download Directory ── */}
      <div className="card p-4 border-panel-500/20 bg-panel-500/5">
        <div className="flex items-start gap-3">
          <FolderOpen className="w-5 h-5 text-panel-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-gray-200">
              Download Directory
            </h4>
            <p className="text-xs text-gray-500 mt-1">
              Choose where downloaded comic files should be saved. On the desktop app,
              you can also drag and drop a folder from your file manager.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <input
                type="text"
                value={downloadDir}
                onChange={(e) => {
                  setDownloadDir(e.target.value);
                  setDownloadDirDirty(true);
                }}
                placeholder="/path/to/downloads"
                className="input flex-1 text-sm"
              />
              <button
                type="button"
                onClick={handleBrowseDir}
                className="btn-secondary btn-sm gap-1.5"
                title="Browse for folder"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Browse
              </button>
              {downloadDirDirty && (
                <button
                  type="button"
                  onClick={handleSaveDir}
                  disabled={saveDirMutation.isPending}
                  className="btn-primary btn-sm gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saveDirMutation.isPending ? "Saving..." : "Save"}
                </button>
              )}
            </div>

            {/* Hidden input for web directory picking fallback */}
            <input
              ref={hiddenInputRef}
              type="file"
              {...{ webkitdirectory: true as any, directory: true as any }}
              onChange={handleHiddenDirPick}
              style={{ display: "none" }}
            />

            {settingsQuery.isLoading && (
              <p className="text-xs text-gray-600 mt-2">Loading current setting...</p>
            )}
            {saveDirMutation.isSuccess && (
              <p className="text-xs text-emerald-500 mt-2">Download directory updated.</p>
            )}
            {downloadDir && !downloadDirDirty && (
              <p className="text-xs text-gray-600 mt-2">
                Current: <code className="text-panel-400">{downloadDir}</code>
              </p>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
