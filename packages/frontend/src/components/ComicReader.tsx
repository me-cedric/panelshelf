import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  Maximize2,
  Minimize2,
  CheckCircle2,
  FileText,
  Keyboard,
} from "lucide-react";
import {
  fetchLibraryItem,
  fetchReadingProgress,
  updateReadingProgress,
  getPageUrl,
} from "../api/library.ts";
import type { LibraryItem } from "../types/index.ts";

type FitMode = "width" | "height" | "original";

export default function ComicReader() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageImgRef = useRef<HTMLImageElement>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [showToolbar, setShowToolbar] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [totalPagesFromData, setTotalPagesFromData] = useState<number | null>(
    null
  );

  const itemFromState = (location.state as { item?: LibraryItem })?.item;

  const { data: itemData, isLoading: itemLoading } = useQuery({
    queryKey: ["library-item", id],
    queryFn: () => fetchLibraryItem(id!),
    enabled: !!id && !itemFromState,
  });

  const item = itemFromState || itemData?.item || null;

  const { data: progressData } = useQuery({
    queryKey: ["reading-progress", id],
    queryFn: () => fetchReadingProgress(id!),
    enabled: !!id,
  });

  const progress = progressData?.progress;

  // Initialize current page from progress
  useEffect(() => {
    if (progress?.currentPage && currentPage === 1) {
      setCurrentPage(progress.currentPage);
    }
    if (progress?.totalPages && !totalPagesFromData) {
      setTotalPagesFromData(progress.totalPages);
    }
    if (item?.pageCount && !totalPagesFromData) {
      setTotalPagesFromData(item.pageCount);
    }
  }, [progress, item]);

  const totalPages = totalPagesFromData || 0;

  const saveProgressMutation = useMutation({
    mutationFn: (data: { currentPage: number; completed?: boolean }) =>
      updateReadingProgress(id!, data),
  });

  // Debounced progress save
  const saveProgress = useCallback(
    (page: number) => {
      saveProgressMutation.mutate({
        currentPage: page,
        completed: page >= totalPages && totalPages > 0,
      });
    },
    [id, totalPages, saveProgressMutation]
  );

  const goToPage = useCallback(
    (page: number, save: boolean = false) => {
      const clamped = Math.max(1, Math.min(page, totalPages || 1));
      setCurrentPage(clamped);
      setImgLoaded(false);
      setImgError(false);
      // Save progress if requested
      if (save) {
        saveProgress(clamped);
      }
      // Check if image is already cached (onLoad won't fire for cached images)
      if (pageImgRef.current?.complete) {
        setImgLoaded(true);
      }
      // Scroll to top when page changes
      containerRef.current?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    },
    [totalPages, saveProgress]
  );

  const goNext = useCallback(() => {
    if (currentPage < totalPages) {
      goToPage(currentPage + 1);
      saveProgress(currentPage + 1);
    }
  }, [currentPage, totalPages, goToPage, saveProgress]);

  const goPrev = useCallback(() => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
      saveProgress(currentPage - 1);
    }
  }, [currentPage, goToPage, saveProgress]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (showShortcuts) return;

      switch (e.key) {
        case "ArrowRight":
        case " ":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "Home":
          e.preventDefault();
          goToPage(1, true);
          break;
        case "End":
          e.preventDefault();
          goToPage(totalPages, true);
          break;
        case "f":
          setFitMode((m) =>
            m === "width" ? "height" : m === "height" ? "original" : "width"
          );
          break;
        case "z":
          setFitMode("original");
          break;
        case "Escape":
          navigate("/");
          break;
        case "?":
          setShowShortcuts((s) => !s);
          break;
      }
    },
    [goNext, goPrev, goToPage, totalPages, navigate, showShortcuts]
  );

  // Stable keydown handler using a ref so the event listener isn't re-attached on every render
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auto-hide toolbar on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let timeout: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      setShowToolbar(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowToolbar(false), 2000);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(timeout);
    };
  }, []);

  // Pre-cache next/prev pages
  useEffect(() => {
    if (!id) return;
    // Preload next page
    if (currentPage < totalPages) {
      const img = new Image();
      img.src = getPageUrl(id, currentPage + 1);
    }
    // Preload previous page
    if (currentPage > 1) {
      const img = new Image();
      img.src = getPageUrl(id, currentPage - 1);
    }
  }, [id, currentPage, totalPages]);

  const pageUrl = id ? getPageUrl(id, currentPage) : "";

  if (!id) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No comic selected
      </div>
    );
  }

  if (itemLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-panel-500 border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-gray-400">Loading comic...</span>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Comic not found
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">
      {/* Toolbar */}
      <div
        className={`absolute top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${
          showToolbar ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-all"
              onClick={() => navigate("/")}
              title="Back to library"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-sm font-medium text-white truncate max-w-[300px]">
                {item.title}
              </h2>
              <p className="text-xs text-gray-400">
                Page {currentPage}{totalPages > 0 ? ` of ${totalPages}` : ""}{" "}
                · {item.format}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Navigation */}
            <button
              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30"
              onClick={() => goToPage(1, true)}
              disabled={currentPage <= 1}
              title="First page (Home)"
            >
              <ChevronLeft className="w-4 h-4" />
              <ChevronLeft className="w-4 h-4 -ml-2" />
            </button>
            <button
              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30"
              onClick={goPrev}
              disabled={currentPage <= 1}
              title="Previous page (←)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <span className="text-xs text-gray-400 mx-2 min-w-[60px] text-center tabular-nums">
              {currentPage} / {totalPages || "?"}
            </span>

            <button
              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30"
              onClick={goNext}
              disabled={currentPage >= totalPages && totalPages > 0}
              title="Next page (→/Space)"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30"
              onClick={() => goToPage(totalPages, true)}
              disabled={currentPage >= totalPages}
              title="Last page (End)"
            >
              <ChevronRight className="w-4 h-4 -mr-2" />
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="w-px h-6 bg-white/10 mx-2" />

            {/* Zoom & Fit */}
            <button
              className={`p-2 rounded-lg transition-all ${
                fitMode === "width"
                  ? "bg-white/15 text-white"
                  : "text-gray-300 hover:text-white hover:bg-white/10"
              }`}
              onClick={() => setFitMode("width")}
              title="Fit to width (f)"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              className={`p-2 rounded-lg transition-all ${
                fitMode === "height"
                  ? "bg-white/15 text-white"
                  : "text-gray-300 hover:text-white hover:bg-white/10"
              }`}
              onClick={() => setFitMode("height")}
              title="Fit to height (f)"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              className={`p-2 rounded-lg transition-all ${
                fitMode === "original"
                  ? "bg-white/15 text-white"
                  : "text-gray-300 hover:text-white hover:bg-white/10"
              }`}
              onClick={() => setFitMode("original")}
              title="Original size (z)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="w-px h-6 bg-white/10 mx-2" />

            {/* Progress actions */}
            <button
              className={`p-2 rounded-lg transition-all disabled:opacity-30 ${
                currentPage >= totalPages && totalPages > 0
                  ? "text-emerald-400"
                  : "text-gray-300 hover:text-white hover:bg-white/10"
              }`}
              onClick={() => {
                const targetPage = totalPages;
                goToPage(targetPage);
                saveProgress(targetPage);
              }}
              disabled={currentPage >= totalPages}
              title="Mark as finished"
            >
              <CheckCircle2 className="w-5 h-5" />
            </button>

            <button
              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-all"
              onClick={() => setShowShortcuts((s) => !s)}
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Page display */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex items-start justify-center"
        onClick={(e) => {
          // Click left/right halves to navigate
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          if (x < rect.width * 0.3) {
            goPrev();
          } else if (x > rect.width * 0.7) {
            goNext();
          }
        }}
      >
        <div
          className="flex items-start justify-center min-h-full"
          style={{
            padding: "20px",
            ...(fitMode === "width"
              ? { width: "100%" }
              : fitMode === "height"
                ? { height: "100%" }
                : {}),
          }}
        >
          {imgError ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <FileText className="w-16 h-16 mb-3 text-gray-700" />
              <p>Failed to load page {currentPage}</p>
              <p className="text-xs text-gray-600 mt-1">
                The file format may not be supported for direct rendering
              </p>
              <div className="flex gap-2 mt-4">
                <button className="btn-secondary btn-sm" onClick={goPrev}>
                  Previous
                </button>
                <button className="btn-secondary btn-sm" onClick={goNext}>
                  Skip to next
                </button>
              </div>
            </div>
          ) : (
            <img
              ref={pageImgRef}
              src={pageUrl}
              alt={`Page ${currentPage}`}
              className={`transition-opacity duration-200 ${
                imgLoaded ? "opacity-100" : "opacity-0"
              }`}
              style={{
                maxWidth: fitMode === "width" ? "100%" : undefined,
                maxHeight:
                  fitMode === "height" ? "calc(100vh - 40px)" : undefined,
                objectFit:
                  fitMode === "width"
                    ? "contain"
                    : fitMode === "height"
                      ? "contain"
                      : undefined,
                width:
                  fitMode === "width" || fitMode === "height"
                    ? "auto"
                    : undefined,
                height:
                  fitMode === "height"
                    ? "calc(100vh - 40px)"
                    : fitMode === "width"
                      ? "auto"
                      : undefined,
              }}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          )}
        </div>
      </div>

      {/* Bottom progress bar */}
      {totalPages > 0 && (
        <div className="h-1 bg-gray-800">
          <div
            className="h-full bg-panel-500 transition-all duration-300"
            style={{
              width: `${Math.min(100, (currentPage / totalPages) * 100)}%`,
            }}
          />
        </div>
      )}

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="card p-6 max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-4">
              Keyboard Shortcuts
            </h3>
            <div className="space-y-2 text-sm">
              {[
                ["← / →", "Previous / Next page"],
                ["Space", "Next page"],
                ["Home", "First page"],
                ["End", "Last page"],
                ["F", "Cycle fit mode"],
                ["Z", "Original zoom"],
                ["Esc", "Exit reader"],
                ["?", "Toggle shortcuts"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <kbd className="px-2 py-0.5 rounded bg-gray-700 text-gray-200 text-xs font-mono">
                    {key}
                  </kbd>
                  <span className="text-gray-400 text-xs ml-4">{desc}</span>
                </div>
              ))}
            </div>
            <button
              className="btn-primary w-full mt-4"
              onClick={() => setShowShortcuts(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay for page transitions */}
      {!imgLoaded && !imgError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none">
          <div className="w-10 h-10 border-2 border-panel-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
