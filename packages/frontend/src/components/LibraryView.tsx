import { useState, useCallback, useEffect, useMemo, useRef, useId } from "react";
import { useAutoRefresh } from "../hooks/useAutoRefresh.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  FolderPlus,
  Trash2,
  RefreshCw,
  Search,
  FileText,
  Bookmark,
  CheckCircle2,
  Clock,
  Grid3X3,
  List,
  Library,
  ArrowUpDown,
  FolderTree,
  Layers,
  ChevronRight,
  MoreVertical,
  RotateCcw,
  Save,
} from "lucide-react";
import {
  fetchLibrarySources,
  createLibrarySource,
  deleteLibrarySource,
  scanLibrarySource,
  clearAllLibrarySources,
  clearLibrarySource,
  touchScanAllTimestamp,
  fetchLibraryItems,
  fetchLibraryStats,
  getCoverUrl,
  updateReadingProgress,
} from "../api/library.ts";
import { useMutationWithToast } from "../hooks/useMutationWithToast.ts";
import { useToast } from "./Toast.tsx";
import type { LibrarySource, LibraryItem, LibraryStats } from "../types/index.ts";

type ViewMode = "grid" | "list";
type GroupMode = "none" | "folder" | "series";

/** Extract a group key from a library item based on the grouping mode. */
function getGroupKey(item: LibraryItem, mode: GroupMode): string | null {
  if (mode === "none") return null;
  if (mode === "folder") {
    // Extract parent directory name from the file path
    const parts = item.filePath.replace(/\\/g, "/").split("/");
    // The parent dir is the second-to-last segment (the file itself is last)
    for (let i = parts.length - 2; i >= 0; i--) {
      if (parts[i]) return parts[i];
    }
    return "Root";
  }
  if (mode === "series") {
    // Heuristic: try to extract series name from the title
    // Common patterns: "Title - Issue Name", "Title #123", "Title Vol. 1"
    const title = item.title;
    // Try " - " separator (most common for series naming)
    const dashIdx = title.search(/\s+-\s+/);
    if (dashIdx > 0) return title.slice(0, dashIdx).trim();
    // Try " #" for issue-numbered series
    const hashIdx = title.search(/\s+#/);
    if (hashIdx > 0) return title.slice(0, hashIdx).trim();
    // Try " Vol." or " Vol "
    const volIdx = title.search(/\s+Vol\.?\s+/i);
    if (volIdx > 0) return title.slice(0, volIdx).trim();
    // Try " Book "
    const bookIdx = title.search(/\s+Book\s+/i);
    if (bookIdx > 0) return title.slice(0, bookIdx).trim();
    // Try " Part "
    const partIdx = title.search(/\s+Part\s+/i);
    if (partIdx > 0) return title.slice(0, partIdx).trim();
    // No pattern detected — treat the whole title as a standalone series
    return title;
  }
  return null;
}

/** Count reading progress within a group of items. */
function groupProgressSummary(items: LibraryItem[]): { completed: number; inProgress: number; total: number } {
  let completed = 0;
  let inProgress = 0;
  for (const item of items) {
    if (item.completed) completed++;
    else if (item.currentPage) inProgress++;
  }
  return { completed, inProgress, total: items.length };
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return formatDate(dateStr);
}

function getProgressLabel(item: LibraryItem): string {
  if (item.completed) return "Finished";
  if (item.currentPage && item.totalPages)
    return `${item.currentPage} / ${item.totalPages}`;
  if (item.currentPage) return `Page ${item.currentPage}`;
  return "New";
}

function getProgressPercent(item: LibraryItem): number {
  if (item.completed) return 100;
  if (item.currentPage && item.totalPages && item.totalPages > 0)
    return Math.round((item.currentPage / item.totalPages) * 100);
  return 0;
}

// ── Progress Actions Popover ──

function ProgressActions({
  item,
  onUpdate,
  isPending,
}: {
  item: LibraryItem;
  onUpdate: (id: string, data: { currentPage?: number; completed?: boolean }) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pageInput, setPageInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPageInput("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((p) => !p);
        }}
        className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
        title="Reading progress"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-gray-700/80 bg-gray-900 backdrop-blur-sm shadow-xl shadow-black/30 p-2 space-y-1"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mark read/unread */}
          {item.completed ? (
            <button
              disabled={isPending}
              onClick={() => {
                onUpdate(item.id, { completed: false });
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-gray-300 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5 text-gray-500" />
              Mark as Unread
            </button>
          ) : (
            <button
              disabled={isPending}
              onClick={() => {
                onUpdate(item.id, { completed: true });
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-gray-300 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Mark as Read
            </button>
          )}

          {/* Divider */}
          <div className="h-px bg-gray-800 mx-1" />

          {/* Set page */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const page = parseInt(pageInput, 10);
              if (!isNaN(page) && page > 0) {
                onUpdate(item.id, { currentPage: page });
                setOpen(false);
                setPageInput("");
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5"
          >
            <input
              className="w-16 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white text-center tabular-nums focus:outline-none focus:border-panel-500/50"
              type="number"
              min={1}
              max={item.totalPages || 9999}
              placeholder={String(item.currentPage || 1)}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              disabled={isPending}
            />
            <span className="text-xs text-gray-500 whitespace-nowrap">
              / {item.totalPages || "?"}
            </span>
            <button
              type="submit"
              disabled={isPending || !pageInput.trim()}
              className="ml-auto p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-40"
              title="Save page"
            >
              <Save className="w-3 h-3" />
            </button>
          </form>

          {/* Quick page shortcuts */}
          {item.totalPages && !item.completed && (
            <div className="flex items-center gap-1 px-3 pb-1.5">
              <button
                disabled={isPending}
                onClick={() => {
                  onUpdate(item.id, { currentPage: 1 });
                  setOpen(false);
                }}
                className="flex-1 text-[10px] text-gray-500 hover:text-gray-300 bg-gray-800/50 hover:bg-gray-800 rounded py-1 transition-colors disabled:opacity-50"
              >
                Start
              </button>
              <button
                disabled={isPending}
                onClick={() => {
                  onUpdate(item.id, { currentPage: Math.round(item.totalPages! / 2) });
                  setOpen(false);
                }}
                className="flex-1 text-[10px] text-gray-500 hover:text-gray-300 bg-gray-800/50 hover:bg-gray-800 rounded py-1 transition-colors disabled:opacity-50"
              >
                Midway
              </button>
              <button
                disabled={isPending}
                onClick={() => {
                  onUpdate(item.id, { completed: true });
                  setOpen(false);
                }}
                className="flex-1 text-[10px] text-emerald-500/70 hover:text-emerald-400 bg-gray-800/50 hover:bg-gray-800 rounded py-1 transition-colors disabled:opacity-50"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add Source Dialog ──

function useDirectoryPicker(multiple?: boolean) {
  const isTauriRef = useRef(
    typeof window !== "undefined" &&
    (window as any).__TAURI_INTERNALS__ !== undefined
  );

  const pickDirectories = useCallback(async (): Promise<string[]> => {
    // This hook is only called from FolderBrowserButton, which only renders
    // in the Tauri desktop app. Browser APIs can't expose real filesystem
    // paths, so the browser fallbacks have been removed.
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: multiple ?? true,
        title: "Select Comics Folders",
      });
      if (!selected) return [];
      return Array.isArray(selected) ? selected : [selected];
    } catch {
      return [];
    }
  }, [multiple]);

  return pickDirectories;
}

function FolderBrowserButton({ onPathsSelected }: { onPathsSelected: (paths: string[]) => void }) {
  const isTauriRef = useRef(
    typeof window !== "undefined" &&
    (window as any).__TAURI_INTERNALS__ !== undefined
  );

  // Browse button only works in the Tauri desktop app (native dialog returns real paths).
  // In a browser, file system APIs can't expose the full filesystem path needed by the backend.
  if (!isTauriRef.current) return null;

  const pickDirectories = useDirectoryPicker(true);
  const [browsing, setBrowsing] = useState(false);

  const handleBrowse = useCallback(async () => {
    setBrowsing(true);
    try {
      const paths = await pickDirectories();
      if (paths.length > 0) {
        onPathsSelected(paths);
      }
    } finally {
      setBrowsing(false);
    }
  }, [pickDirectories, onPathsSelected]);

  return (
    <button
      type="button"
      onClick={handleBrowse}
      disabled={browsing}
      className="btn-ghost btn-sm shrink-0"
      title="Browse for folders..."
    >
      <FolderPlus className="w-4 h-4" />
      {browsing ? "..." : "Browse"}
    </button>
  );
}

/** Validate that a path looks like a valid directory path before submitting. */
interface PathValidation {
  valid: boolean;
  message: string;
}

function validatePath(value: string): PathValidation {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, message: "Path is required." };

  // URLs are not valid directory paths
  if (/^https?:\/\//i.test(trimmed))
    return { valid: false, message: "Enter a local folder path, not a URL." };
  if (/^ftp:\/\//i.test(trimmed))
    return { valid: false, message: "Enter a local folder path, not a URL." };

  // Looks like a file with a comic-related extension
  if (/\.(cbz|cbr|pdf|rar|zip|tar\.gz|7z)$/i.test(trimmed))
    return { valid: false, message: "This looks like a file, not a folder. Enter the directory path." };

  // Acceptable path patterns:
  //   - Unix absolute:  /foo/bar
  //   - Home shorthand: ~/foo   or  ~user/foo
  //   - Windows drive:  C:\foo  or  D:/foo
  //   - Windows UNC:    \\server\share
  //   - Relative:       ./foo   or   ../foo  or  foo/bar
  const isUnixAbs = trimmed.startsWith("/");
  const isHome    = /^~(\/[^\0]*)?$/.test(trimmed);
  const isWinDrive = /^[A-Za-z]:[\\/]/.test(trimmed);
  const isWinUNC  = /^\\{2}[^\\]+/.test(trimmed);
  const isRelative = /^(\.\.?\/)/.test(trimmed);

  // A plain name (no slash, no colon) is allowed -- might be a relative dir
  const hasPathChars = isUnixAbs || isHome || isWinDrive || isWinUNC || isRelative || trimmed.includes("/") || trimmed.includes("\\");

  if (!hasPathChars && !/^[a-zA-Z0-9_\- .]+$/.test(trimmed)) {
    return { valid: false, message: "Enter a valid folder path." };
  }

  // Check for obviously problematic characters
  if (/[<>"|?*\x00-\x1f]/.test(trimmed))
    return { valid: false, message: "Path contains invalid characters." };

  return { valid: true, message: "" };
}

function AddSourceDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [paths, setPaths] = useState<string[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [name, setName] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [touched, setTouched] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [addingNames, setAddingNames] = useState<Set<string>>(new Set());
  const [scanOnAdd, setScanOnAdd] = useState(true);
  const [addProgress, setAddProgress] = useState<{
    phase: "creating" | "scanning";
    current: number;
    total: number;
    currentPath: string;
  } | null>(null);

  // Validate the manual input path (for visual feedback on blur)
  const addPathFromInput = useCallback(() => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;

    const validation = validatePath(trimmed);
    if (!validation.valid) {
      setInputError(validation.message);
      return;
    }

    // Add path if it's not already in the list
    setPaths((prev) => {
      if (prev.includes(trimmed)) return prev;
      return [...prev, trimmed];
    });
    setPathInput("");
    setInputError(null);
    setTouched(true);
  }, [pathInput]);

  const removePath = useCallback((p: string) => {
    setPaths((prev) => prev.filter((v) => v !== p));
  }, []);

  // ── Drag-and-drop ──

  const isTauri = useRef(
    typeof window !== "undefined" &&
    (window as any).__TAURI_INTERNALS__ !== undefined
  );

  // Listen for Tauri native file-drop events (desktop only)
  useEffect(() => {
    if (!open || !isTauri.current) return;

    const onDragEnter = (e: Event) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onDragOver = (e: Event) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (e: Event) => {
      e.preventDefault();
      setDragOver(false);
    };
    const onDrop = (e: CustomEvent<string[]>) => {
      e.preventDefault();
      setDragOver(false);
      const droppedPaths = e.detail;
      if (droppedPaths && droppedPaths.length > 0) {
        setPaths((prev) => {
          const existing = new Set(prev);
          const newPaths = droppedPaths.filter((p: string) => !existing.has(p));
          if (newPaths.length === 0) return prev;
          return [...prev, ...newPaths];
        });
        setTouched(true);
      }
    };

    window.addEventListener("tauri://drag-enter", onDragEnter);
    window.addEventListener("tauri://drag-over", onDragOver);
    window.addEventListener("tauri://drag-leave", onDragLeave);
    window.addEventListener("tauri://file-drop", onDrop as EventListener);

    return () => {
      window.removeEventListener("tauri://drag-enter", onDragEnter);
      window.removeEventListener("tauri://drag-over", onDragOver);
      window.removeEventListener("tauri://drag-leave", onDragLeave);
      window.removeEventListener("tauri://file-drop", onDrop as EventListener);
    };
  }, [open]);

  // Browser drag-and-drop via standard HTML5 events
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    dragCounter.current = 0;

    // In Tauri, the native file-drop event already handled this with the real path
    if (isTauri.current) return;

    // Collect all dropped directories
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const newDirs: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry =
        items[i].kind === "file" &&
        (items[i] as any).webkitGetAsEntry
          ? (items[i] as any).webkitGetAsEntry()
          : null;
      if (entry && entry.isDirectory) {
        newDirs.push(entry.name);
      }
    }

    if (newDirs.length > 0) {
      setPaths((prev) => {
        const existing = new Set(prev);
        const unique = newDirs.filter((d) => !existing.has(d));
        return unique.length > 0 ? [...prev, ...unique] : prev;
      });
      setTouched(true);
    }
  }, []);

  const addMutation = useMutationWithToast({
    mutationFn: async () => {
      // Create each source sequentially, tracking successes & failures
      const results: { name: string; success: boolean; error?: string; scanResult?: { added: number; skipped: number; errors: string[] } }[] = [];
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        const folderNum = i + 1;
        const total = paths.length;
        try {
          setAddingNames((prev) => new Set(prev).add(p));
          setAddProgress({ phase: "creating", current: folderNum, total, currentPath: p });
          const { source } = await createLibrarySource({
            path: p,
            name: name || undefined,
            scanRecursive: recursive,
          });

          // Scan immediately after creation if enabled
          let scanResult: { added: number; skipped: number; errors: string[] } | undefined;
          if (scanOnAdd && source?.id) {
            setAddProgress({ phase: "scanning", current: folderNum, total, currentPath: p });
            try {
              scanResult = await scanLibrarySource(source.id);
            } catch {
              // Scan failure shouldn't block the add — just note it silently
            }
          }

          results.push({ name: p, success: true, scanResult });
        } catch (err: any) {
          results.push({ name: p, success: false, error: err.message });
        } finally {
          setAddingNames((prev) => {
            const next = new Set(prev);
            next.delete(p);
            return next;
          });
        }
      }
      setAddProgress(null);
      return results;
    },
    toast: {
      success: (results: { name: string; success: boolean; error?: string; scanResult?: { added: number; skipped: number; errors: string[] } }[]) => {
        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        // Count total new items discovered by scans
        const totalFound = results.reduce((sum, r) => sum + (r.scanResult?.added || 0), 0);

        // Count folders that were scanned but had no comic files
        const noComicsCount = results.filter(
          (r) => r.success && r.scanResult !== undefined && r.scanResult.added === 0 && r.scanResult.skipped === 0 && r.scanResult.errors.length === 0
        ).length;

        let baseMessage: string;
        if (failed === 0) {
          baseMessage = succeeded === 1
            ? "1 library folder added"
            : `${succeeded} library folders added`;
        } else if (succeeded === 0) {
          return {
            message: "Failed to add folders",
            description: results.map((r) => `${r.name}: ${r.error}`).join("\n"),
          };
        } else {
          baseMessage = `${succeeded} folder(s) added, ${failed} failed`;
        }

        // Append scan summary
        if (totalFound > 0) {
          const note = succeeded === 1
            ? `${baseMessage} (${totalFound} ${totalFound === 1 ? "comic" : "comics"} found)`
            : `${baseMessage} (${totalFound} new)`;
          // Add note about empty folders if any were scanned without finding comics
          if (noComicsCount > 0) {
            return `${note}, ${noComicsCount} ${noComicsCount === 1 ? "folder" : "folders"} empty`;
          }
          return note;
        }

        // If nothing was scanned (scanOnAdd off), just return baseMessage
        if (noComicsCount === 0) return baseMessage;

        // All scanned folders had no comics
        return `${baseMessage} (no comics found in ${noComicsCount} ${noComicsCount === 1 ? "folder" : "folders"})`;
      },
      error: (err: Error) => ({
        message: "Failed to add library folders",
        description: err.message,
      }),
    },
    onSuccess: (results: { name: string; success: boolean; error?: string; scanResult?: { added: number; skipped: number; errors: string[] } }[]) => {
      queryClient.invalidateQueries({ queryKey: ["library-sources"] });

      // Only invalidate items/stats if at least one folder actually found comics
      const anyComicsFound = results.some(
        (r) => r.scanResult !== undefined && (r.scanResult.added > 0 || r.scanResult.skipped > 0)
      );
      if (anyComicsFound) {
        queryClient.invalidateQueries({ queryKey: ["library-items"] });
        queryClient.invalidateQueries({ queryKey: ["library-stats"] });
      }

      setPaths([]);
      setPathInput("");
      setName("");
      onClose();
    },
  });

  if (!open) return null;

  const allValid = paths.length > 0 && paths.every((p) => validatePath(p).valid);
  const isPending = addMutation.isPending && !addMutation.isPaused;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={`card relative p-6 w-full max-w-lg mx-4 transition-all duration-200 ${
          dragOver
            ? "border-panel-500/60 ring-2 ring-panel-500/30 scale-[1.02]"
            : ""
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <h3 className="text-lg font-semibold text-white mb-1">
          {paths.length > 0 ? `Add Library Folders (${paths.length})` : "Add Library Folders"}
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Add one or more folders to your library.
        </p>

        <div className="space-y-4">
          {/* Drop zone highlight overlay */}
          {dragOver && (
            <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-panel-500/50 bg-panel-500/5 flex items-center justify-center pointer-events-none z-10">
              <div className="text-center">
                <FolderPlus className="w-10 h-10 text-panel-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-panel-300">Drop folders here</p>
              </div>
            </div>
          )}

          {/* Path input row */}
          <div>
            <label htmlFor={inputId} className="block text-sm text-gray-400 mb-1">
              Folder paths
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                id={inputId}
                className={`input flex-1 ${inputError ? "border-red-500/60 focus:border-red-500/80" : ""}`}
                placeholder="/path/to/comics  (press Enter to add)"
                value={pathInput}
                onChange={(e) => {
                  setPathInput(e.target.value);
                  if (inputError) setInputError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPathFromInput();
                  }
                }}
                onBlur={() => {
                  if (pathInput.trim()) addPathFromInput();
                }}
              />
              <FolderBrowserButton onPathsSelected={(newPaths) => {
                setPaths((prev) => {
                  const existing = new Set(prev);
                  const unique = newPaths.filter((p) => !existing.has(p));
                  return unique.length > 0 ? [...prev, ...unique] : prev;
                });
                setTouched(true);
              }} />
            </div>
            {inputError && (
              <p className="text-xs text-red-400/80 mt-1.5 flex items-center gap-1.5">
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {inputError}
              </p>
            )}
            <p className="text-xs text-gray-600 mt-1.5">
              Type a path and press Enter, or drag folders from Finder/Explorer onto this dialog.
            </p>
          </div>

          {/* Path chips list */}
          {paths.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {paths.map((p) => {
                const val = validatePath(p);
                const isAdding = addingNames.has(p);
                return (
                  <div
                    key={p}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      val.valid
                        ? "border-gray-700/60 bg-gray-800/40"
                        : "border-red-500/30 bg-red-500/5"
                    } ${isAdding ? "opacity-60" : ""}`}
                  >
                    <FolderTree className="w-3.5 h-3.5 text-panel-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-gray-300">
                      {p}
                    </span>
                    {isAdding && (
                      <RefreshCw className="w-3 h-3 text-gray-500 animate-spin shrink-0" />
                    )}
                    {!val.valid && (
                      <span className="text-[10px] text-red-400/70 shrink-0" title={val.message}>
                        invalid
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={isAdding}
                      onClick={() => removePath(p)}
                      className="p-0.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-700/50 transition-colors shrink-0 disabled:opacity-30"
                      title={`Remove ${p}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Display name (optional) */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Display name prefix (optional)
            </label>
            <input
              className="input"
              placeholder={`Applies to all folders (e.g. "Marvel")`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {paths.length > 1 && name && (
              <p className="text-xs text-gray-600 mt-1">
                Folders will be named like "{name} / Comics" etc.
              </p>
            )}
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-panel-500 focus:ring-panel-500"
              />
              <span className="text-sm text-gray-300">Scan subdirectories recursively</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={scanOnAdd}
                onChange={(e) => setScanOnAdd(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-panel-500 focus:ring-panel-500"
              />
              <span className="text-sm text-gray-300">Scan on add</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!allValid || isPending}
            onClick={() => addMutation.mutate()}
          >
            {isPending && addProgress ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {addProgress.phase === "creating"
                  ? `Adding folder ${addProgress.current} of ${addProgress.total}...`
                  : `Scanning folder ${addProgress.current} of ${addProgress.total}...`}
              </span>
            ) : isPending ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Processing...
              </span>
            ) : paths.length === 1 ? (
              "Add 1 Folder"
            ) : (
              `Add ${paths.length} Folders`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Source Card ──

function SourceCard({
  source,
  onScan,
  onClear,
  onDelete,
  isScanning,
  isClearing,
  isActive,
  onClick,
}: {
  source: LibrarySource;
  onScan: () => void;
  onClear: () => void;
  onDelete: () => void;
  isScanning: boolean;
  isClearing: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`card-hover p-4 text-left w-full transition-all ${
        isActive
          ? "border-panel-500/50 bg-panel-500/5"
          : "border-gray-800"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-panel-600/10 flex items-center justify-center shrink-0">
            <FolderPlus className="w-5 h-5 text-panel-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {source.name}
            </p>
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {source.path}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-3">
          {source.lastScannedAt && (
            <span className="badge-blue text-[10px] px-1.5 py-0.5 hidden sm:inline-flex">
              {source.itemCount} items
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onScan();
            }}
            disabled={isScanning}
            className="btn-ghost btn-xs"
            title="Scan folder"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isScanning ? "animate-spin" : ""}`}
            />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            disabled={isClearing}
            className="btn-ghost btn-xs text-yellow-400 hover:text-yellow-300"
            title="Clear items in this folder"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isClearing ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="btn-ghost btn-xs text-red-400 hover:text-red-300"
            title="Remove source"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {source.lastScannedAt && (
        <p className="text-xs text-gray-600 mt-2">
          Last scanned: {formatDate(source.lastScannedAt)}
        </p>
      )}
    </button>
  );
}

// ── Item Card (Grid) ──

function ItemCard({
  item,
  onClick,
  index,
  onProgressUpdate,
  isProgressPending,
}: {
  item: LibraryItem;
  onClick: () => void;
  index: number;
  onProgressUpdate?: (id: string, data: { currentPage?: number; completed?: boolean }) => void;
  isProgressPending?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const progress = getProgressPercent(item);
  const label = getProgressLabel(item);

  const accentBorder =
    item.completed
      ? "border-emerald-500/40"
      : item.currentPage
        ? "border-yellow-500/40"
        : "border-gray-700/40";

  const hoverShadow =
    item.completed
      ? "hover:shadow-emerald-500/10"
      : item.currentPage
        ? "hover:shadow-yellow-500/10"
        : "hover:shadow-white/5";

  return (
    <button
      onClick={onClick}
      className={`card-enter group relative flex flex-col rounded-xl border ${accentBorder} bg-gray-900/80 backdrop-blur-sm text-left transition-all duration-300 ease-out hover:-translate-y-1.5 hover:shadow-xl ${hoverShadow} hover:border-gray-700 focus:outline-none focus:ring-2 focus:ring-panel-500/50 focus:ring-offset-2 focus:ring-offset-gray-900`}
      style={{ animationDelay: `${index * 35}ms` }}
    >
      {/* Cover container */}
      <div className="aspect-[3/4] bg-gray-800 relative overflow-hidden rounded-xl">
        {!imgError ? (
          <>
            <img
              src={getCoverUrl(item.id)}
              alt={item.title}
              className="w-full h-full object-cover transition-all duration-500 ease-out group-hover:scale-110 group-hover:rotate-[1deg]"
              onError={() => setImgError(true)}
            />
            {/* Gradient overlay — dark at bottom for readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-gray-900/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileText className="w-12 h-12 text-gray-600" />
          </div>
        )}

        {/* Top-right: progress status badge */}
        {item.currentPage && (
          <div className="absolute top-2 right-2 transition-all duration-300 group-hover:scale-110">
            {item.completed ? (
              <span className="badge-green text-[10px]">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Done
              </span>
            ) : (
              <span className="badge-yellow text-[10px]">
                <Bookmark className="w-3 h-3 mr-1" />
                {item.currentPage}
              </span>
            )}
          </div>
        )}

        {/* Bottom-left: format badge, slides out on hover */}
        <div className="absolute bottom-2 left-2 transition-all duration-300 group-hover:translate-y-8 group-hover:opacity-0">
          <span className="badge-gray text-[10px]">{item.format}</span>
        </div>

        {/* Bottom-center: reading position on hover */}
        {progress > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 translate-y-8 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
            <span className="text-[10px] font-medium text-white bg-black/60 px-2 py-0.5 rounded-full backdrop-blur-sm">
              {label}
            </span>
          </div>
        )}

        {/* Progress bar at bottom of cover */}
        {progress > 0 && progress < 100 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800/80">
            <div
              className="h-full bg-gradient-to-r from-panel-500 to-panel-400 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="p-3 flex-1 flex flex-col justify-between gap-1.5">
        <p className="text-sm font-medium text-white truncate group-hover:text-panel-300 transition-colors duration-200">
          {item.title}
        </p>

        <div className="flex items-center gap-2 text-xs text-gray-500">
          {item.pageCount && (
            <span className="tabular-nums">
              {item.pageCount} {item.pageCount === 1 ? "page" : "pages"}
            </span>
          )}
          {item.pageCount && item.fileSizeBytes && (
            <span className="text-gray-700">·</span>
          )}
          {item.fileSizeBytes && (
            <span className="tabular-nums">{formatFileSize(item.fileSizeBytes)}</span>
          )}
        </div>

        {/* Always-visible progress controls */}
        <div className="flex items-center gap-1.5">
          {onProgressUpdate && (
            <ProgressActions
              item={item}
              onUpdate={onProgressUpdate}
              isPending={!!isProgressPending}
            />
          )}
          {/* Hover-only action hint */}
          <div className="opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0 flex items-center gap-1.5">
            <div className="h-px flex-1 bg-gradient-to-r from-panel-500/30 to-transparent" />
            <span className="text-[10px] font-medium text-panel-400 tracking-wider uppercase">
              {item.completed ? "Re-read" : item.currentPage ? "Continue" : "Read"}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Item Row (List) ──

function ItemRow({
  item,
  onClick,
  index,
  onProgressUpdate,
  isProgressPending,
}: {
  item: LibraryItem;
  onClick: () => void;
  index: number;
  onProgressUpdate?: (id: string, data: { currentPage?: number; completed?: boolean }) => void;
  isProgressPending?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const progress = getProgressPercent(item);
  const label = getProgressLabel(item);

  // Left accent color based on reading status
  const accentColor =
    item.completed
      ? "border-l-emerald-500"
      : item.currentPage
        ? "border-l-yellow-500"
        : "border-l-gray-600";

  const accentDot =
    item.completed
      ? "bg-emerald-500"
      : item.currentPage
        ? "bg-yellow-500"
        : "bg-gray-500";

  return (
    <button
      onClick={onClick}
      className={`card-enter-list group flex items-center gap-4 w-full text-left rounded-xl border border-gray-800/60 bg-gray-900/50 backdrop-blur-sm ${accentColor} border-l-4 transition-all duration-200 ease-out hover:bg-gray-800/60 hover:border-gray-700 hover:shadow-lg hover:shadow-black/20 focus:outline-none focus:ring-2 focus:ring-panel-500/50 focus:ring-offset-2 focus:ring-offset-gray-900`}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Thumbnail — wider for list view */}
      <div className="w-20 h-28 shrink-0 bg-gray-800 relative overflow-hidden rounded-xl">
        {!imgError ? (
          <img
            src={getCoverUrl(item.id)}
            alt={item.title}
            className="w-full h-full object-cover transition-all duration-300 group-hover:scale-110"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileText className="w-8 h-8 text-gray-600" />
          </div>
        )}
        {/* Format badge on thumbnail */}
        <div className="absolute bottom-1 left-1">
          <span className="bg-black/60 text-[9px] font-medium text-gray-300 px-1.5 py-0.5 rounded">
            {item.format}
          </span>
        </div>
      </div>

      {/* Info section */}
      <div className="flex-1 min-w-0 py-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${accentDot} shrink-0`} />
          <p className="text-sm font-medium text-white truncate group-hover:text-panel-300 transition-colors">
            {item.title}
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          {item.pageCount && (
            <span className="tabular-nums">
              {item.pageCount} {item.pageCount === 1 ? "page" : "pages"}
            </span>
          )}
          {item.fileSizeBytes && (
            <span className="tabular-nums">{formatFileSize(item.fileSizeBytes)}</span>
          )}
          {item.addedAt && (
            <span className="text-gray-600">Added {formatDate(item.addedAt)}</span>
          )}
        </div>

        {/* Progress bar — full width strip */}
        {(progress > 0 || item.completed) && (
          <div className="w-full max-w-xs h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                item.completed
                  ? "bg-emerald-500"
                  : "bg-gradient-to-r from-panel-500 to-panel-400 progress-pulse"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Status text */}
        <p className="text-[11px] text-gray-600">
          {item.completed
            ? "Completed"
            : item.currentPage
              ? `${label}`
              : "Not started yet"}
        </p>
      </div>

      {/* Right side — action on hover */}
      <div className="pr-4 shrink-0 flex flex-col items-end gap-2">
        {/* Status badge (always visible) */}
        {item.completed ? (
          <span className="badge-green text-[10px]">
            <CheckCircle2 className="w-3 h-3" />
          </span>
        ) : item.currentPage ? (
          <span className="badge-yellow text-[10px]">{Math.round(progress)}%</span>
        ) : (
          <Clock className="w-3.5 h-3.5 text-gray-600" />
        )}

        {/* Always-visible progress controls */}
        {onProgressUpdate && (
          <div className="pr-1">
            <ProgressActions
              item={item}
              onUpdate={onProgressUpdate}
              isPending={!!isProgressPending}
            />
          </div>
        )}
        {/* Hover action button */}
        <div className="opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all duration-200 ease-out">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-panel-400 bg-panel-500/10 border border-panel-500/20 rounded-lg px-3 py-1.5 hover:bg-panel-500/20 transition-colors whitespace-nowrap">
            {item.completed ? "Re-read" : item.currentPage ? "Continue" : "Open"}
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Main Library View ──

export default function LibraryView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<string>(
    () => localStorage.getItem("library-sort-by") || "title"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(
    () => (localStorage.getItem("library-sort-order") as "asc" | "desc") || "asc"
  );
  const [groupMode, setGroupMode] = useState<GroupMode>(
    () => (localStorage.getItem("library-group-mode") as GroupMode) || "none"
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [scanningIds, setScanningIds] = useState<Set<string>>(new Set());
  const [scanAllProgress, setScanAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [clearScanPhase, setClearScanPhase] = useState<{
    phase: "clearing" | "scanning";
    current: number;
    total: number;
    currentPath?: string;
  } | null>(null);

  // Tick every 30s to refresh relative timestamps (e.g. "5m ago" → "6m ago", ...)
  useAutoRefresh(30_000);

  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ["library-sources"],
    queryFn: fetchLibrarySources,
  });

  const sources = sourcesData?.sources || [];

  // Auto-select first source
  useEffect(() => {
    if (!activeSourceId && sources.length > 0) {
      setActiveSourceId(sources[0].id);
    }
  }, [activeSourceId, sources]);

  const { data: itemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ["library-items", activeSourceId, searchQuery, sortBy, sortOrder],
    queryFn: () =>
      fetchLibraryItems({
        sourceId: activeSourceId || undefined,
        search: searchQuery || undefined,
        limit: 100,
        sortBy,
        sortOrder,
      }),
    enabled: !!activeSourceId,
  });

  const { data: stats } = useQuery({
    queryKey: ["library-stats"],
    queryFn: fetchLibraryStats,
    refetchInterval: 30_000,
  });

  const items = itemsData?.items || [];

  // Group items when groupMode is active
  const groupedItems = useMemo(() => {
    if (groupMode === "none") return null;
    const groups = new Map<string, LibraryItem[]>();
    for (const item of items) {
      const key = getGroupKey(item, groupMode);
      if (!key) continue;
      const arr = groups.get(key);
      if (arr) arr.push(item);
      else groups.set(key, [item]);
    }
    // Sort groups by name
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [items, groupMode]);

  const toggleGroup = useCallback((name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const progressMutation = useMutationWithToast({
    mutationFn: ({ id, data }: { id: string; data: { currentPage?: number; completed?: boolean } }) =>
      updateReadingProgress(id, data),
    toast: {
      success: "Progress updated",
      error: (err: Error) => ({ message: "Failed to update progress", description: err.message }),
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      queryClient.invalidateQueries({ queryKey: ["library-stats"] });
    },
  });

  const handleProgressUpdate = useCallback(
    (id: string, data: { currentPage?: number; completed?: boolean }) => {
      progressMutation.mutate({ id, data });
    },
    [progressMutation]
  );

  const deleteMutation = useMutationWithToast({
    mutationFn: (id: string) => deleteLibrarySource(id),
    toast: {
      success: "Library source removed",
      error: (err: Error) => ({ message: "Failed to remove source", description: err.message }),
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-sources"] });
      queryClient.invalidateQueries({ queryKey: ["library-stats"] });
      if (activeSourceId) setActiveSourceId(null);
    },
  });

  const { addToast } = useToast();

  const [clearingSingleId, setClearingSingleId] = useState<string | null>(null);

  const handleClearSingle = useCallback(
    async (sourceId: string) => {
      const source = sources.find((s) => s.id === sourceId);
      const sourceName = source?.name || "this folder";
      const proceed = confirm(
        `Clear all items from "${sourceName}"? Reading progress will be deleted. The folder source itself will be preserved.`
      );
      if (!proceed) return;

      setClearingSingleId(sourceId);
      try {
        const result = await clearLibrarySource(sourceId);
        queryClient.invalidateQueries({ queryKey: ["library-sources"] });
        queryClient.invalidateQueries({ queryKey: ["library-items"] });
        queryClient.invalidateQueries({ queryKey: ["library-stats"] });
        addToast({
          message: `Cleared ${result.deletedItems} item${result.deletedItems !== 1 ? "s" : ""} from "${sourceName}"`,
          type: "success",
        });
      } catch (err: any) {
        addToast({
          message: "Failed to clear items",
          description: err.message,
          type: "error",
        });
      } finally {
        setClearingSingleId(null);
      }
    },
    [sources, queryClient, addToast]
  );

  const handleScan = useCallback(
    async (id: string) => {
      setScanningIds((prev) => new Set(prev).add(id));
      try {
        const result = await scanLibrarySource(id);
        queryClient.invalidateQueries({ queryKey: ["library-sources"] });
        queryClient.invalidateQueries({ queryKey: ["library-items"] });
        queryClient.invalidateQueries({ queryKey: ["library-stats"] });
        const addedText = result.added > 0 ? `${result.added} new` : "no new";
        const skippedText = result.skipped > 0 ? `, ${result.skipped} existing` : "";
        addToast({
          message: `Scan complete: ${addedText} comics found${skippedText}`,
          type: result.errors.length > 0 ? "warning" : "success",
        });
        if (result.errors.length > 0) {
          addToast({
            message: `${result.errors.length} scan errors`,
            description: result.errors.slice(0, 3).join("\n"),
            type: "error",
          });
        }
      } catch (err: any) {
        addToast({
          message: "Scan failed",
          description: err.message,
          type: "error",
        });
      } finally {
        setScanningIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [queryClient, addToast]
  );

  const handleClearAndRescan = useCallback(async () => {
    const proceed = confirm(
      "This will delete all imported comics and reading progress, then re-scan every library folder from scratch.\n\n" +
      "Library folder sources themselves will be preserved. Continue?"
    );
    if (!proceed) return;

    setClearScanPhase({ phase: "clearing", current: 0, total: 1 });
    try {
      // Step 1: Clear all items
      const clearResult = await clearAllLibrarySources();
      queryClient.invalidateQueries({ queryKey: ["library-sources"] });
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      queryClient.invalidateQueries({ queryKey: ["library-stats"] });

      // Step 2: Re-scan each source individually with progress tracking
      const enabledSources = sources.filter((s) => s.enabled);
      const results: Array<{ sourceId: string; name: string; added: number; skipped: number; errors: string[] }> = [];

      for (let i = 0; i < enabledSources.length; i++) {
        const source = enabledSources[i];
        setClearScanPhase({ phase: "scanning", current: i, total: enabledSources.length, currentPath: source.path });
        try {
          const result = await scanLibrarySource(source.id);
          results.push({ sourceId: source.id, name: source.name, ...result });
        } catch (err: any) {
          results.push({ sourceId: source.id, name: source.name, added: 0, skipped: 0, errors: [err.message] });
        }
      }

      // Final invalidation and toast
      queryClient.invalidateQueries({ queryKey: ["library-sources"] });
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      queryClient.invalidateQueries({ queryKey: ["library-stats"] });

      const totalAdded = results.reduce((sum, r) => sum + r.added, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);

      addToast({
        message: `Library reset: cleared ${clearResult.deletedItems} items, re-scanned ${results.length} folder(s)`,
        description: totalAdded > 0 || totalSkipped > 0
          ? `${totalAdded} new, ${totalSkipped} existing`
          : undefined,
        type: "success",
      });
    } catch (err: any) {
      addToast({
        message: "Clear & re-scan failed",
        description: err.message,
        type: "error",
      });
    } finally {
      setClearScanPhase(null);
    }
  }, [sources, queryClient, addToast]);

  const handleScanAll = useCallback(async () => {
    const enabledSources = sources.filter((s) => s.enabled);
    if (enabledSources.length === 0) return;

    setScanAllProgress({ done: 0, total: enabledSources.length });

    const results: Array<{ sourceId: string; name: string; added: number; skipped: number; errors: string[] }> = [];

    try {
      for (let i = 0; i < enabledSources.length; i++) {
        const source = enabledSources[i];
        try {
          const result = await scanLibrarySource(source.id);
          results.push({ sourceId: source.id, name: source.name, ...result });
        } catch (err: any) {
          results.push({ sourceId: source.id, name: source.name, added: 0, skipped: 0, errors: [err.message] });
        }
        setScanAllProgress({ done: i + 1, total: enabledSources.length });
      }

      // Persist the scan-all timestamp
      try {
        await touchScanAllTimestamp();
      } catch {
        // Non-critical — don't block the toast
      }

      queryClient.invalidateQueries({ queryKey: ["library-sources"] });
      queryClient.invalidateQueries({ queryKey: ["library-items"] });
      queryClient.invalidateQueries({ queryKey: ["library-stats"] });

      const totalAdded = results.reduce((sum, r) => sum + r.added, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

      if (totalErrors > 0) {
        addToast({
          message: `Scanned ${enabledSources.length} folder(s): ${totalAdded} new, ${totalSkipped} existing, ${totalErrors} error(s)`,
          description: results
            .filter((r) => r.errors.length > 0)
            .map((r) => `${r.name}: ${r.errors.slice(0, 2).join("; ")}`)
            .join("\n"),
          type: "warning",
        });
      } else {
        addToast({
          message: `Scanned ${enabledSources.length} folder(s): ${totalAdded} new, ${totalSkipped} existing`,
          type: "success",
        });
      }
    } catch (err: any) {
      addToast({
        message: "Batch scan failed",
        description: err.message,
        type: "error",
      });
    } finally {
      setScanAllProgress(null);
    }
  }, [sources, queryClient, addToast]);

  const handleOpenReader = useCallback(
    (item: LibraryItem) => {
      navigate(`/library/read/${item.id}`, { state: { item } });
    },
    [navigate]
  );

  return (
    <div className="space-y-6">
      {/* Shared keyframe animations */}
      <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Library className="w-6 h-6 text-panel-400" />
            Library
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Browse and read your local comic collection
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary"
            onClick={handleClearAndRescan}
            disabled={clearScanPhase !== null}
            title="Delete all items and re-scan every folder"
          >
            <RotateCcw className={`w-4 h-4 ${clearScanPhase !== null ? "animate-spin" : ""}`} />
            {clearScanPhase !== null ? "Working..." : "Clear & Re-scan"}
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowAddDialog(true)}
          >
            <FolderPlus className="w-4 h-4" />
            Add Folder
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && stats.totalItems > 0 && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="card px-4 py-2.5 flex items-center gap-3">
            <FileText className="w-4 h-4 text-panel-400" />
            <div>
              <span className="text-lg font-bold text-white">{stats.totalItems}</span>
              <span className="text-xs text-gray-500 ml-1.5">
                {stats.totalItems === 1 ? "comic" : "comics"}
              </span>
            </div>
          </div>

          <div className="card px-4 py-2.5 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <div>
              <span className="text-lg font-bold text-white">{stats.completedCount}</span>
              <span className="text-xs text-gray-500 ml-1.5">Read</span>
            </div>
          </div>

          <div className="card px-4 py-2.5 flex items-center gap-3">
            <Bookmark className="w-4 h-4 text-yellow-400" />
            <div>
              <span className="text-lg font-bold text-white">{stats.inProgressCount}</span>
              <span className="text-xs text-gray-500 ml-1.5">In Progress</span>
            </div>
          </div>

          <div className="card px-4 py-2.5 flex items-center gap-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <div>
              <span className="text-lg font-bold text-white">{stats.unreadCount}</span>
              <span className="text-xs text-gray-500 ml-1.5">Unread</span>
            </div>
          </div>

          {stats.totalSources > 1 && (
            <div className="text-xs text-gray-600 ml-auto">
              across {stats.totalSources} {stats.totalSources === 1 ? "folder" : "folders"}
            </div>
          )}
        </div>
      )}

      {/* Clear & Re-scan progress panel */}
      {clearScanPhase && (
        <div className="card p-5 border-panel-500/30 bg-panel-500/5">
          <div className="flex items-center gap-4">
            {/* Phase icon */}
            <div className="w-10 h-10 rounded-full bg-panel-500/20 flex items-center justify-center shrink-0">
              {clearScanPhase.phase === "clearing" ? (
                <RefreshCw className="w-5 h-5 text-panel-400 animate-spin" />
              ) : (
                <RefreshCw className="w-5 h-5 text-panel-400 animate-spin" />
              )}
            </div>

            {/* Phase details */}
            <div className="flex-1 min-w-0">
              {clearScanPhase.phase === "clearing" ? (
                <>
                  <p className="text-sm font-medium text-white">
                    Clearing items...
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Deleting all imported comics and reading progress
                  </p>
                  {/* Indeterminate progress bar — animated shimmer to distinguish from determinate scanning bar */}
                  <div className="mt-3 h-1.5 bg-gray-700/50 rounded-full overflow-hidden relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-panel-400/60 to-transparent rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-white">
                    Scanning folders{" "}
                    <span className="text-panel-400 tabular-nums">
                      {clearScanPhase.current + 1}/{clearScanPhase.total}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {clearScanPhase.currentPath || "Processing..."}
                  </p>
                  {/* Determinate progress bar */}
                  <div className="mt-3 h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-panel-500 to-panel-400 rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: `${((clearScanPhase.current + 1) / clearScanPhase.total) * 100}%`,
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Percent badge */}
            {clearScanPhase.phase === "scanning" && (
              <div className="shrink-0">
                <span className="text-lg font-bold text-panel-400 tabular-nums">
                  {Math.round(((clearScanPhase.current + 1) / clearScanPhase.total) * 100)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {sources.length === 0 && !sourcesLoading ? (
        <div className="card p-12 text-center">
          <Library className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-300 mb-2">
            No library folders yet
          </h2>
          <p className="text-gray-500 max-w-md mx-auto">
            Add a folder containing your comic files (CBZ, CBR, PDF) to get
            started. Your reading progress will be tracked automatically.
          </p>
          <button
            className="btn-primary mt-6"
            onClick={() => setShowAddDialog(true)}
          >
            <FolderPlus className="w-4 h-4" />
            Add Your First Folder
          </button>
        </div>
      ) : (
        <>
          {/* Source tabs */}
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                isActive={activeSourceId === source.id}
                onClick={() => setActiveSourceId(source.id)}
                onScan={() => handleScan(source.id)}
                onClear={() => handleClearSingle(source.id)}
                onDelete={() => {
                  if (
                    confirm(
                      `Remove "${source.name}" from library? Items will be deleted.`
                    )
                  ) {
                    deleteMutation.mutate(source.id);
                  }
                }}
                isScanning={scanningIds.has(source.id)}
                isClearing={clearingSingleId === source.id}
              />
            ))}

            {/* Batch scan button — visible when 2+ sources exist */}
            {sources.length >= 2 && (
              <button
                onClick={handleScanAll}
                disabled={scanAllProgress !== null}
                className="card-hover p-4 text-left transition-all border border-dashed border-gray-700/50 hover:border-gray-600/50 flex items-center gap-3"
                title="Scan all folders"
              >
                <div className="w-10 h-10 rounded-lg bg-panel-600/10 flex items-center justify-center shrink-0">
                  <RefreshCw className={`w-5 h-5 text-panel-400 ${scanAllProgress !== null ? "animate-spin" : ""}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-300 truncate">
                    {scanAllProgress !== null
                      ? `Scanning ${scanAllProgress.done}/${scanAllProgress.total}...`
                      : "Scan All"}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {scanAllProgress !== null
                      ? `${scanAllProgress.done} of ${scanAllProgress.total} folder${scanAllProgress.total !== 1 ? "s" : ""} scanned`
                      : (
                        <>
                          {sources.length} folder{sources.length !== 1 ? "s" : ""}
                          {stats?.lastScanAllAt && (
                            <>
                              <span className="mx-1.5 text-gray-700">·</span>
                              <span className="text-gray-500">Last scan: {timeAgo(stats.lastScanAllAt)}</span>
                            </>
                          )}
                        </>
                      )}
                  </p>
                </div>
              </button>
            )}
          </div>

          {/* Search, sort, and view toggle */}
          {activeSourceId && (
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  className="input pl-9"
                  placeholder="Search in this folder..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Sort dropdown */}
              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-gray-500" />
                <select
                  className="select w-auto text-xs py-1.5 px-2"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value);
                    localStorage.setItem("library-sort-by", e.target.value);
                  }}
                >
                  <option value="title">Title</option>
                  <option value="addedAt">Date Added</option>
                  <option value="fileSizeBytes">File Size</option>
                  <option value="format">Format</option>
                  <option value="pageCount">Page Count</option>
                </select>
                <button
                  onClick={() =>
                    setSortOrder((prev) => {
                      const next = prev === "asc" ? "desc" : "asc";
                      localStorage.setItem("library-sort-order", next);
                      return next;
                    })
                  }
                  className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                  title={sortOrder === "asc" ? "Ascending" : "Descending"}
                >
                  <ArrowUpDown
                    className={`w-3.5 h-3.5 transition-transform duration-300 ${
                      sortOrder === "desc" ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>

              {/* Group toggle */}
              <div className="flex rounded-lg border border-gray-700 overflow-hidden">
                <button
                  onClick={() => {
                    const modes: GroupMode[] = ["none", "folder", "series"];
                    const idx = modes.indexOf(groupMode);
                    const next = modes[(idx + 1) % modes.length];
                    setGroupMode(next);
                    localStorage.setItem("library-group-mode", next);
                  }}
                  className={`p-2 transition-colors ${
                    groupMode !== "none"
                      ? "bg-panel-600/20 text-panel-400"
                      : "bg-transparent text-gray-500 hover:text-gray-300"
                  }`}
                  title={`Group: ${groupMode === "none" ? "None" : groupMode === "folder" ? "By Folder" : "By Series"}`}
                >
                  {groupMode === "series" ? (
                    <Layers className="w-4 h-4" />
                  ) : (
                    <FolderTree className="w-4 h-4" />
                  )}
                </button>
              </div>

              <div className="flex rounded-lg border border-gray-700 overflow-hidden">
                <button
                  className={`p-2 transition-colors ${
                    viewMode === "grid"
                      ? "bg-panel-600/20 text-panel-400"
                      : "bg-transparent text-gray-500 hover:text-gray-300"
                  }`}
                  onClick={() => setViewMode("grid")}
                  title="Grid view"
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  className={`p-2 transition-colors ${
                    viewMode === "list"
                      ? "bg-panel-600/20 text-panel-400"
                      : "bg-transparent text-gray-500 hover:text-gray-300"
                  }`}
                  onClick={() => setViewMode("list")}
                  title="List view"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Items */}
          {activeSourceId && (
            <>
              {itemsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
                  <span className="ml-3 text-gray-500">Loading items...</span>
                </div>
              ) : items.length === 0 ? (
                <div className="card p-8 text-center">
                  <FileText className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                  <p className="text-gray-400">
                    {searchQuery
                      ? "No comics match your search."
                      : "No comics found. Click the scan icon to scan this folder."}
                  </p>
                </div>
              ) : groupedItems ? (
                <div className="space-y-6">
                  {groupedItems.map(([groupName, groupItems]) => {
                    const isCollapsed = collapsedGroups.has(groupName);
                    const summary = groupProgressSummary(groupItems);
                    const completed = summary.completed;
                    const inProgress = summary.inProgress;
                    return (
                      <div key={groupName}>
                        {/* Sticky group header */}
                        <div className="sticky top-0 z-10 -mx-1 px-1 py-2">
                          <button
                            onClick={() => toggleGroup(groupName)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-900/90 backdrop-blur-sm border border-gray-800/80 hover:border-gray-700/80 transition-all text-left group/header"
                          >
                            <ChevronRight
                              className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${
                                isCollapsed ? "" : "rotate-90"
                              }`}
                            />
                            {groupMode === "folder" ? (
                              <FolderTree className="w-4 h-4 text-panel-400" />
                            ) : (
                              <Layers className="w-4 h-4 text-panel-400" />
                            )}
                            <span className="text-sm font-semibold text-white truncate">
                              {groupName}
                            </span>
                            <span className="text-xs text-gray-500 tabular-nums shrink-0">
                              {groupItems.length} {groupItems.length === 1 ? "item" : "items"}
                            </span>
                            <div className="flex items-center gap-2 ml-auto shrink-0">
                              {completed > 0 && (
                                <span className="badge-green text-[10px]">
                                  <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                                  {completed}
                                </span>
                              )}
                              {inProgress > 0 && (
                                <span className="badge-yellow text-[10px]">
                                  <Bookmark className="w-2.5 h-2.5 mr-1" />
                                  {inProgress}
                                </span>
                              )}
                            </div>
                          </button>
                        </div>

                        {!isCollapsed && (
                          <div className="mt-3">
                            {viewMode === "grid" ? (
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                                {groupItems.map((item, i) => (
                                  <ItemCard
                                    key={item.id}
                                    item={item}
                                    index={i}
                                    onClick={() => handleOpenReader(item)}
                                    onProgressUpdate={handleProgressUpdate}
                                    isProgressPending={progressMutation.isPending}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {groupItems.map((item, i) => (
                                  <ItemRow
                                    key={item.id}
                                    item={item}
                                    index={i}
                                    onClick={() => handleOpenReader(item)}
                                    onProgressUpdate={handleProgressUpdate}
                                    isProgressPending={progressMutation.isPending}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : viewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                  {items.map((item, i) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      index={i}
                      onClick={() => handleOpenReader(item)}
                      onProgressUpdate={handleProgressUpdate}
                      isProgressPending={progressMutation.isPending}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item, i) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      index={i}
                      onClick={() => handleOpenReader(item)}
                      onProgressUpdate={handleProgressUpdate}
                      isProgressPending={progressMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Add dialog */}
      <AddSourceDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
      />
    </div>
  );
}
