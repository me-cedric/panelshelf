import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Grid3X3,
  List,
  SlidersHorizontal,
  Download,
  ExternalLink,
  BookOpen,
  ArrowUpDown,
  Plus,
  X,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Settings,
  ArrowRight,
  Wind,
} from "lucide-react";
import { fetchSources, fetchSavedSearches, createSavedSearch, deleteSavedSearch, refreshSource, liveSearchCatalog, fetchDetailLinks, fetchCatalogItems } from "../api/client.ts";
import { useMutationWithToast } from "../hooks/useMutationWithToast.ts";
import { useToast } from "../components/Toast.tsx";
import type { CatalogFilters, Source } from "../types/index.ts";
import SearchFilters from "./SearchFilters.tsx";

const VIEW_MODE_KEY = "panelshelf-view-mode";
const CLICKED_URLS_KEY = "panelshelf-clicked-urls";
const DOWNLOADED_ITEMS_KEY = "panelshelf-downloaded-items";
const PINNED_DOWNLOADS_KEY = "panelshelf-pinned-downloads";
const DOWNLOAD_HISTORY_KEY = "panelshelf-download-history";
const ROOT_MARGIN_KEY = "panelshelf-root-margin";
const PAGE_SIZE_KEY = "panelshelf-page-size";

export default function CatalogView() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"grid" | "table">(
    () => (localStorage.getItem(VIEW_MODE_KEY) as "grid" | "table") || "grid"
  );
  const [showFilters, setShowFilters] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<CatalogFilters>(() => ({
    sortBy: "releaseDate",
    sortOrder: "desc",
    limit: (() => {
      try {
        const stored = localStorage.getItem(PAGE_SIZE_KEY);
        const val = stored ? parseInt(stored, 10) : 50;
        return Number.isFinite(val) && val >= 10 && val <= 200 ? val : 50;
      } catch {
        return 50;
      }
    })(),
    offset: 0,
  }));
  const [saveSearchName, setSaveSearchName] = useState("");
  const [showSaveSearch, setShowSaveSearch] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const freshResultCountRef = useRef(0);
  const errorCountRef = useRef(0);
  const liveSentinelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const refreshAbortRef = useRef<AbortController | null>(null);
  const { addToast } = useToast();

  // Mount guard: prevent IntersectionObserver from auto-loading immediately on mount.
  // The observer fires when the sentinel is already in-view, which happens on short
  // result sets — this guard delays auto-load until the user has had time to scroll.
  const mountedAtRef = useRef(Date.now());
  const MIN_SCROLL_DELAY_MS = 1500;

  // Infinite scroll root margin — configurable via Sources page (localStorage)
  const [rootMargin, setRootMargin] = useState<number>(
    () => {
      try {
        const stored = localStorage.getItem(ROOT_MARGIN_KEY);
        const val = stored ? parseInt(stored, 10) : 800;
        return Number.isFinite(val) && val >= 0 ? val : 800;
      } catch {
        return 800;
      }
    }
  );

  // Page size — configurable via Sources page (localStorage)
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(PAGE_SIZE_KEY);
      const val = stored ? parseInt(stored, 10) : 50;
      return Number.isFinite(val) && val >= 10 && val <= 200 ? val : 50;
    } catch {
      return 50;
    }
  });

  // Detail panel state (for showing download links of a live result)
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [detailData, setDetailData] = useState<{
    title: string;
    coverUrl?: string;
    description: string;
    downloadLinks: Array<{
      provider: string;
      url: string;
      className: string;
    }>;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [clickedUrls, setClickedUrls] = useState<Record<string, boolean>>(
    () => {
      try {
        const stored = localStorage.getItem(CLICKED_URLS_KEY);
        return stored ? JSON.parse(stored) : {};
      } catch {
        return {};
      }
    }
  ); // download URLs the user has clicked (persisted in localStorage)

  const [downloadedItems, setDownloadedItems] = useState<Record<string, boolean>>(
    () => {
      try {
        const stored = localStorage.getItem(DOWNLOADED_ITEMS_KEY);
        return stored ? JSON.parse(stored) : {};
      } catch {
        return {};
      }
    }
  ); // items (by detailUrl) that have had downloads clicked

  // Download history — tracks every download link clicked, for the Downloads page
  const [downloadHistory, setDownloadHistory] = useState<Array<{
    url: string;
    detailUrl: string | null;
    title: string | null;
    provider: string;
    timestamp: number;
  }>>(
    () => {
      try {
        const stored = localStorage.getItem(DOWNLOAD_HISTORY_KEY);
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    }
  );

  // Pinned download links — persist across page refreshes, allow pinning from multiple items
  const [pinnedDownloads, setPinnedDownloads] = useState<Array<{
    id: string;         // detail URL (unique per item)
    title: string;
    downloadLinks: Array<{ provider: string; url: string; className: string }>;
  }>>(
    () => {
      try {
        const stored = localStorage.getItem(PINNED_DOWNLOADS_KEY);
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    }
  );

  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: () => fetchSources().then((r) => r.sources),
  });

  // Live search: proxy to source feed in real-time with infinite scroll
  // Phase 1: fetch cached data immediately (stale-while-revalidate)
  const rssSource = sourcesQuery.data?.find((s) => s.type === "rss" && s.enabled);

  // Build a lookup of source ID → source name for display
  const sourceNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of sourcesQuery.data || []) {
      map[s.id] = s.name;
    }
    return map;
  }, [sourcesQuery.data]);

  // Non-RSS live-search sources (provider-based scraping)
  const dcmSource = useMemo(() =>
    sourcesQuery.data?.find((s) => s.name === "Digital Comic Museum" && s.enabled) ?? null,
    [sourcesQuery.data]
  );
  const iaSource = useMemo(() =>
    sourcesQuery.data?.find((s) => s.name === "Internet Archive" && s.enabled) ?? null,
    [sourcesQuery.data]
  );

  const liveSearchQuery = useInfiniteQuery({
    queryKey: ["live-search", filters.search || "", rssSource?.id],
    queryFn: ({ pageParam = 1 }) => {
      if (!rssSource) return { items: [], page: 1, totalPages: 1, hasMore: false, cached: false };
      const q = filters.search || "";
      // Phase 1: fetch with fresh=false to get cached/instant data
      return liveSearchCatalog(rssSource.id, q, pageParam, false);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      return lastPage.hasMore ? lastPage.page + 1 : undefined;
    },
    enabled: !!rssSource,
    staleTime: 30_000, // 30s — prevents flicker on re-mounts
    retry: false,
  });

  // DCM live-search (provider scraper for browse-all / search via DCM's index.php)
  const dcmLiveQuery = useInfiniteQuery({
    queryKey: ["live-search", filters.search || "", dcmSource?.id],
    queryFn: ({ pageParam = 1 }) => {
      if (!dcmSource) return { items: [], page: 1, totalPages: 1, hasMore: false, cached: false };
      return liveSearchCatalog(dcmSource.id, filters.search || "", pageParam, false);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!dcmSource,
    staleTime: 30_000,
    retry: false,
  });

  // Internet Archive live-search (provider scraper via IA Advanced Search API)
  const iaLiveQuery = useInfiniteQuery({
    queryKey: ["live-search", filters.search || "", iaSource?.id],
    queryFn: ({ pageParam = 1 }) => {
      if (!iaSource) return { items: [], page: 1, totalPages: 1, hasMore: false, cached: false };
      return liveSearchCatalog(iaSource.id, filters.search || "", pageParam, false);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!iaSource,
    staleTime: 30_000,
    retry: false,
  });

  // Database catalog query — shows ingested items from ALL sources (RSS + non-RSS)
  // Uses offset-based pagination converted to infinite query
  const catalogQuery = useInfiniteQuery({
    queryKey: ["catalog-db", filters],
    queryFn: ({ pageParam = 0 }) => {
      return fetchCatalogItems({
        ...filters,
        offset: pageParam,
        limit: filters.limit || 50,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = (lastPage.offset || 0) + (lastPage.limit || 50);
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: true,
    staleTime: 60_000,
    retry: false,
  });

  // Flatten all fetched pages into items, tracking cache status per-item
  const livePages = liveSearchQuery.data?.pages ?? [];
  const liveItemsWithCache = livePages.flatMap((p) =>
    p.items.map((item) => ({ ...item, _fromCached: p.cached, _source: "live" as "live" | "db" }))
  );

  // Flatten DCM live-search results
  const dcmLivePages = dcmLiveQuery.data?.pages ?? [];
  const dcmLiveItems = dcmLivePages.flatMap((p) =>
    p.items.map((item) => ({ ...item, _fromCached: p.cached, _source: "live" as "live" | "db" }))
  );

  // Flatten Internet Archive live-search results
  const iaLivePages = iaLiveQuery.data?.pages ?? [];
  const iaLiveItems = iaLivePages.flatMap((p) =>
    p.items.map((item) => ({ ...item, _fromCached: p.cached, _source: "live" as "live" | "db" }))
  );

  // ── Client-side filtering of live items ──
  // Live items come from source scrapers/feeds and don't support server-side
  // filtering by publisher, format, date range, etc. We apply available filters
  // client-side so the UI is consistent with DB catalog filtering.

  function applyClientFilters<T extends { sourceId?: string; releaseDate?: string | null }>(
    items: T[],
    currentFilters: CatalogFilters
  ): T[] {
    let filtered = items;

    // sourceId filter: only show items from matching source
    if (currentFilters.sourceId) {
      filtered = filtered.filter(i => i.sourceId === currentFilters.sourceId);
    }

    // releaseDate range filter
    if (currentFilters.dateFrom) {
      const from = new Date(currentFilters.dateFrom).getTime();
      filtered = filtered.filter(i => {
        if (!i.releaseDate) return false;
        return new Date(i.releaseDate).getTime() >= from;
      });
    }
    if (currentFilters.dateTo) {
      const to = new Date(currentFilters.dateTo).getTime();
      filtered = filtered.filter(i => {
        if (!i.releaseDate) return true; // no date = show it (conservative)
        return new Date(i.releaseDate).getTime() <= to;
      });
    }

    return filtered;
  }

  const filteredLiveItems = useMemo(
    () => applyClientFilters(liveItemsWithCache, filters),
    [liveItemsWithCache, filters.sourceId, filters.dateFrom, filters.dateTo]
  );

  const filteredDcmLiveItems = useMemo(
    () => applyClientFilters(dcmLiveItems, filters),
    [dcmLiveItems, filters.sourceId, filters.dateFrom, filters.dateTo]
  );

  const filteredIaLiveItems = useMemo(
    () => applyClientFilters(iaLiveItems, filters),
    [iaLiveItems, filters.sourceId, filters.dateFrom, filters.dateTo]
  );

  // Flatten database catalog items into a compatible display format
  const catalogPages = catalogQuery.data?.pages ?? [];
  const dbItems = catalogPages.flatMap((page) =>
    page.items.map((item) => ({
      id: item.detailUrl || item.id,
      title: item.title,
      description: item.description || "",
      detailUrl: item.detailUrl || "",
      coverUrl: item.coverUrl || undefined,
      releaseDate: item.releaseDate || null,
      source: sourceNameMap[item.sourceId] || "Unknown",
      sourceId: item.sourceId,
      live: true as const,
      _fromCached: false,
      _source: "db" as "live" | "db",
    }))
  );

  // Merge filtered live-search (RSS + DCM + IA) and DB catalog items, deduplicating by detailUrl.
  // Then sort by the active sortBy/sortOrder.
  const mergedItems = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<Record<string, any>> = [];

    // RSS live items first (highest priority, but filtered client-side)
    for (const item of filteredLiveItems) {
      const key = item.detailUrl || item.id;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    // DCM live items
    for (const item of filteredDcmLiveItems) {
      const key = item.detailUrl || item.id;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    // IA live items
    for (const item of filteredIaLiveItems) {
      const key = item.detailUrl || item.id;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    // DB items (skip duplicates) — pre-filtered by backend + defensive client-side filter
    for (const item of dbItems) {
      const key = item.detailUrl || item.id;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    // Apply client-side sorting
    const sortBy = filters.sortBy || "releaseDate";
    const sortOrder = filters.sortOrder || "desc";
    const multiplier = sortOrder === "desc" ? -1 : 1;

    result.sort((a, b) => {
      let aVal: any, bVal: any;

      switch (sortBy) {
        case "title":
          aVal = (a.title || "").toLowerCase();
          bVal = (b.title || "").toLowerCase();
          return aVal < bVal ? -multiplier : aVal > bVal ? multiplier : 0;
        case "publisher":
          aVal = (a.source || "").toLowerCase();
          bVal = (b.source || "").toLowerCase();
          return aVal < bVal ? -multiplier : aVal > bVal ? multiplier : 0;
        case "addedAt":
          aVal = a.releaseDate || "";
          bVal = b.releaseDate || "";
          return aVal < bVal ? multiplier : aVal > bVal ? -multiplier : 0;
        case "releaseDate":
        default:
          aVal = a.releaseDate || "";
          bVal = b.releaseDate || "";
          return aVal < bVal ? multiplier : aVal > bVal ? -multiplier : 0;
      }
    });

    return result;
  }, [filteredLiveItems, filteredDcmLiveItems, filteredIaLiveItems, dbItems, filters.sortBy, filters.sortOrder]);

  const cachedCount = filteredLiveItems.filter((i) => i._fromCached).length
    + filteredDcmLiveItems.filter((i) => i._fromCached).length
    + filteredIaLiveItems.filter((i) => i._fromCached).length;
  const freshCount = filteredLiveItems.length + filteredDcmLiveItems.length + filteredIaLiveItems.length - cachedCount;
  const livePagesCount = livePages.length;
  const dcmLivePagesCount = dcmLivePages.length;
  const iaLivePagesCount = iaLivePages.length;
  const liveHasMore = liveSearchQuery.hasNextPage || dcmLiveQuery.hasNextPage || iaLiveQuery.hasNextPage;
  const dbHasMore = catalogQuery.hasNextPage;
  const anyCached = livePages.some((p) => p.cached);
  // Note: DCM/IA cached state is tracked separately (dcmLivePages, iaLivePages)
  // but the background refresh effect only handles RSS WordPress pagination.
  const dbTotal = catalogPages[0]?.total ?? 0;

  // Stable refs for fetch functions — prevents IntersectionObserver from re-creating on every render.
  // Updated after query declarations so they're in scope.
  const liveFetchNextPageRef = useRef(liveSearchQuery.fetchNextPage);
  liveFetchNextPageRef.current = liveSearchQuery.fetchNextPage;
  const catalogFetchNextPageRef = useRef(catalogQuery.fetchNextPage);
  catalogFetchNextPageRef.current = catalogQuery.fetchNextPage;
  const dcmFetchNextPageRef = useRef(dcmLiveQuery.fetchNextPage);
  dcmFetchNextPageRef.current = dcmLiveQuery.fetchNextPage;
  const iaFetchNextPageRef = useRef(iaLiveQuery.fetchNextPage);
  iaFetchNextPageRef.current = iaLiveQuery.fetchNextPage;

  // IntersectionObserver for infinite scroll (live search + DB catalog).
  // Uses stable refs for fetch functions to avoid re-creating the observer on every render.
  // The mount guard prevents immediate loading when the sentinel is already in-view.
  useEffect(() => {
    const sentinel = liveSentinelRef.current;
    if (!sentinel) return;

    let observer: IntersectionObserver;

    const callback = (entries: IntersectionObserverEntry[]) => {
      if (!entries[0].isIntersecting) return;

      // Guard: don't auto-load within MIN_SCROLL_DELAY_MS of mount
      // (manual "Load more" button still works immediately)
      if (Date.now() - mountedAtRef.current < MIN_SCROLL_DELAY_MS) return;

      // Prioritize live-search infinite scroll: RSS first, then DCM, then IA, then DB
      if (liveSearchQuery.hasNextPage && !liveSearchQuery.isFetchingNextPage) {
        liveFetchNextPageRef.current();
      } else if (dcmLiveQuery.hasNextPage && !dcmLiveQuery.isFetchingNextPage) {
        dcmFetchNextPageRef.current();
      } else if (iaLiveQuery.hasNextPage && !iaLiveQuery.isFetchingNextPage) {
        iaFetchNextPageRef.current();
      } else if (catalogQuery.hasNextPage && !catalogQuery.isFetchingNextPage) {
        catalogFetchNextPageRef.current();
      }
    };

    observer = new IntersectionObserver(callback, {
      rootMargin: `${rootMargin}px`,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
    // Only recreate when pagination availability changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSearchQuery.hasNextPage, liveSearchQuery.isFetchingNextPage, dcmLiveQuery.hasNextPage, dcmLiveQuery.isFetchingNextPage, iaLiveQuery.hasNextPage, iaLiveQuery.isFetchingNextPage, catalogQuery.hasNextPage, catalogQuery.isFetchingNextPage, rootMargin]);

  // Phase 2: background refresh — when any cached page is detected, fetch fresh results
  // and progressively replace each page in-place. This handles the case where page 1
  // is live (cache expired) but subsequent pages are still cached from a prior session.
  useEffect(() => {
    if (!anyCached || isRefreshing || !rssSource) return;
    if (!liveSearchQuery.data?.pages.length) return;

    const sourceId = rssSource.id;
    const query = filters.search || "";

    setIsRefreshing(true);
    freshResultCountRef.current = 0;
    errorCountRef.current = 0;
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    (async () => {
      // Capture how many pages are currently in the cache so we refresh ALL of them,
      // even if fresh fetches report fewer pages (e.g., WordPress changed page count).
      const cachedData = queryClient.getQueryData(["live-search", query, sourceId]) as any;
      const cachedPageCount = cachedData?.pages?.length ?? 0;
      let maxPage = Math.max(cachedPageCount, 1);

      let page = 1;

      while (page <= maxPage && page <= 50 && !controller.signal.aborted) {
        try {
          const result = await liveSearchCatalog(
            sourceId,
            query,
            page,
            true // fresh=true
          );

          // Count total fresh items fetched
          freshResultCountRef.current += result.items.length;

          // Progressively update this page's data in the query cache
          queryClient.setQueryData(
            ["live-search", query, sourceId],
            (old: any) => {
              if (!old) return { pages: [result], pageParams: [page] };
              const newPages = [...old.pages];
              newPages[page - 1] = result;
              return { ...old, pages: newPages };
            }
          );

          // Extend maxPage if fresh results indicate more pages exist
          if (result.hasMore) {
            maxPage = Math.max(maxPage, page + 1);
          }
          page++;
        } catch (err) {
          errorCountRef.current += 1;
          if (!controller.signal.aborted) {
            console.error("[live-search] Background refresh page", page, err);
          }
          // Continue trying remaining pages
          page++;
        }
      }
    })().finally(() => {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
      setIsRefreshing(false);

      // Toast on completion
      const freshCount = freshResultCountRef.current;
      const errorCount = errorCountRef.current;
      const truncatedQuery = query.length > 30 ? query.slice(0, 30) + "..." : query;

      if (!controller.signal.aborted) {
        if (errorCount > 0) {
          addToast({
            type: "warning",
            message: `${errorCount} page${errorCount === 1 ? "" : "s"} failed to refresh for "${truncatedQuery}"`,
            description: "Some pages encountered errors — results may be incomplete",
          });
        } else if (freshCount > 0) {
          addToast({
            type: "success",
            message: `Found ${freshCount} fresh results for "${truncatedQuery}"`,
            description: "Live search updated",
          });
        }
      }
    });

    return () => {
      controller.abort();
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
    };
  }, [
    anyCached,
    filters.search,
    rssSource?.id,
    addToast,
  ]);


  const savedSearchesQuery = useQuery({
    queryKey: ["saved-searches"],
    queryFn: () => fetchSavedSearches().then((r) => r.searches),
  });

  // Mutations
  const saveSearchMutation = useMutationWithToast({
    mutationFn: () =>
      createSavedSearch({
        name: saveSearchName,
        query: filters.search,
        filters: JSON.stringify(filters),
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder || "desc",
      }),
    toast: {
      success: `Search "${saveSearchName}" saved`,
      error: (err: Error) => ({ message: "Failed to save search", description: err.message }),
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-searches"] });
      setSaveSearchName("");
      setShowSaveSearch(false);
    },
  });

  const deleteSearchMutation = useMutationWithToast({
    mutationFn: (id: string) => deleteSavedSearch(id),
    toast: {
      success: (_data, id) => {
        const name = savedSearchesQuery.data?.find((s) => s.id === id)?.name || id;
        return { message: `Search "${name}" deleted` };
      },
      error: (err: Error) => ({ message: "Failed to delete search", description: err.message }),
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-searches"] });
    },
  });

  // Debounce: sync searchText → debouncedSearchText after 300ms pause
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchText]);

  // Sync debounced search text into filters
  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      search: debouncedSearchText || undefined,
      offset: 0,
    }));
  }, [debouncedSearchText]);

  // Handlers
  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      // Clear any pending debounce and apply immediately
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      setDebouncedSearchText(searchText);
    },
    [searchText]
  );

  const handleFilterChange = useCallback((newFilters: Partial<CatalogFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters, offset: 0 }));
  }, []);

  const handleApplySavedSearch = useCallback((s: any) => {
    const parsedFilters = s.filters ? JSON.parse(s.filters) : {};
    setFilters({ ...parsedFilters, query: s.query, sortBy: s.sortBy, sortOrder: s.sortOrder });
    setSearchText(s.query || "");
  }, []);

  const clearSearch = useCallback(() => {
    setSearchText("");
    setDebouncedSearchText("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setFilters((prev) => ({ ...prev, search: undefined, offset: 0 }));
  }, []);

  const handleViewModeChange = useCallback((mode: "grid" | "table") => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }, []);

  // Open detail panel for a live search result
  const handleOpenDetail = useCallback(async (item: any) => {
    setSelectedItem(item);
    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);

    try {
      const data = await fetchDetailLinks(item.detailUrl);
      setDetailData(data);
    } catch (err: any) {
      setDetailError(err.message || "Failed to load details");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Record a download click in history (shared between button and external-link icon)
  const recordDownloadClick = useCallback((url: string, provider: string) => {
    setClickedUrls((prev) => ({ ...prev, [url]: true }));
    if (selectedItem?.detailUrl) {
      setDownloadedItems((prev) => ({ ...prev, [selectedItem.detailUrl]: true }));
    }
    // Add to download history (update timestamp if same URL already exists)
    setDownloadHistory((prev) => {
      const existing = prev.findIndex((e) => e.url === url);
      const entry = {
        url,
        detailUrl: selectedItem?.detailUrl ?? null,
        title: selectedItem?.title ?? null,
        provider,
        timestamp: Date.now(),
      };
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = entry;
        return next;
      }
      return [entry, ...prev];
    });
  }, [selectedItem]);

  // Handle download click: open the URL directly and track it
  const handleDownloadClick = useCallback((link: { provider: string; url: string; className: string }) => {
    recordDownloadClick(link.url, link.provider);
    // Open directly in a new tab
    window.open(link.url, "_blank", "noopener,noreferrer");
  }, [recordDownloadClick]);

  const handleCloseDetail = useCallback(() => {
    setSelectedItem(null);
    setDetailData(null);
    setDetailError(null);
  }, []);

  const handlePinDownload = useCallback((item: any, data: {
    title: string;
    downloadLinks: Array<{ provider: string; url: string; className: string }>;
  }) => {
    if (!data.downloadLinks.length) return;
    setPinnedDownloads((prev) => {
      // Don't add duplicates (check by detail URL)
      if (prev.some((p) => p.id === item.detailUrl)) return prev;
      return [...prev, {
        id: item.detailUrl,
        title: data.title,
        downloadLinks: data.downloadLinks,
      }];
    });
  }, []);

  const handleDismissPinned = useCallback((id: string) => {
    setPinnedDownloads((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const refreshSources = useCallback(async () => {
    if (!sourcesQuery.data) return;
    const enabled = sourcesQuery.data.filter((s) => s.enabled);
    const names = enabled.map((s) => s.name);
    let queued = 0;
    for (const source of enabled) {
      try {
        const result = await refreshSource(source.id);
        if (result.queued) queued++;
      } catch {
        // ignore individual failures
      }
    }
    queryClient.invalidateQueries({ queryKey: ["catalog-db"] });
    if (queued > 0) {
      addToast({
        type: "info",
        message: `Refreshing ${queued} source${queued === 1 ? "" : "s"}`,
        description: names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3} more`,
      });
    }
  }, [sourcesQuery.data, queryClient, addToast]);

  // Global keyboard shortcuts:
  //   / or Ctrl/Cmd+K — focus search
  //   r — refresh all sources (when not editing)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // / key — only when not already editing
      if (e.key === "/" && !isEditing) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Ctrl/Cmd+K — works anywhere
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // r — refresh all sources (only when not editing)
      if (e.key === "r" && !isEditing) {
        e.preventDefault();
        refreshSources();
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [refreshSources]);

  // Persist clicked URLs to localStorage so tracking survives page refreshes
  useEffect(() => {
    localStorage.setItem(CLICKED_URLS_KEY, JSON.stringify(clickedUrls));
  }, [clickedUrls]);

  // Persist downloaded items to localStorage
  useEffect(() => {
    localStorage.setItem(DOWNLOADED_ITEMS_KEY, JSON.stringify(downloadedItems));
  }, [downloadedItems]);

  // Persist pinned downloads to localStorage
  useEffect(() => {
    localStorage.setItem(PINNED_DOWNLOADS_KEY, JSON.stringify(pinnedDownloads));
  }, [pinnedDownloads]);

  // Persist download history to localStorage
  useEffect(() => {
    localStorage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(downloadHistory));
  }, [downloadHistory]);

  // Sync pageSize into filters when changed via Sources page
  useEffect(() => {
    setFilters((prev) => ({ ...prev, limit: pageSize, offset: 0 }));
  }, [pageSize]);

  // Persist root margin to localStorage
  useEffect(() => {
    localStorage.setItem(ROOT_MARGIN_KEY, String(rootMargin));
  }, [rootMargin]);

  // Persist page size to localStorage
  useEffect(() => {
    localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
  }, [pageSize]);



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Catalog</h1>
        <div className="flex items-center gap-2">
          <button onClick={refreshSources} className="btn-ghost btn-sm" title="Refresh all sources">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder='Search... (Esc to clear, Enter to search, / or ⌘K to focus)'
            className="input pl-10 pr-10"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
                clearSearch();
              }
            }}
          />
          {searchText && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn-secondary btn-sm gap-2 ${showFilters ? "border-panel-500 text-panel-400" : ""}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
        </button>
        <div className="flex bg-gray-800 rounded-lg border border-gray-700">
          <button
            onClick={() => handleViewModeChange("grid")}
            className={`p-2 rounded-l-lg transition-colors ${
              viewMode === "grid" ? "bg-panel-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleViewModeChange("table")}
            className={`p-2 rounded-r-lg transition-colors ${
              viewMode === "table" ? "bg-panel-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Saved searches */}
      {savedSearchesQuery.data && savedSearchesQuery.data.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Saved searches:</span>
          {savedSearchesQuery.data.map((s) => (
            <button
              key={s.id}
              onClick={() => handleApplySavedSearch(s)}
              className="badge-blue cursor-pointer hover:bg-panel-500/20 transition-colors"
            >
              {s.name}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSearchMutation.mutate(s.id);
                }}
                className="ml-1.5 hover:text-red-400"
              >
                <X className="w-3 h-3" />
              </button>
            </button>
          ))}
        </div>
      )}

      {/* Save search button */}
      {filters.search && (
        <div className="flex items-center gap-2">
          {showSaveSearch ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="input w-48"
                placeholder="Search name..."
                value={saveSearchName}
                onChange={(e) => setSaveSearchName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && saveSearchName) saveSearchMutation.mutate();
                  if (e.key === "Escape") setShowSaveSearch(false);
                }}
              />
              <button
                onClick={() => saveSearchMutation.mutate()}
                className="btn-primary btn-sm"
                disabled={!saveSearchName}
              >
                <Plus className="w-3 h-3" />
                Save
              </button>
              <button onClick={() => setShowSaveSearch(false)} className="btn-ghost btn-sm">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setShowSaveSearch(true)} className="btn-ghost btn-sm">
              <Plus className="w-3 h-3" />
              Save search
            </button>
          )}
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <SearchFilters
          filters={filters}
          sources={sourcesQuery.data || []}
          onChange={handleFilterChange}
        />
      )}

      {/* Sort bar */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-gray-500" />
          <select
            className="select w-auto text-xs py-1 px-2"
            value={filters.sortBy || "releaseDate"}
            onChange={(e) => handleFilterChange({ sortBy: e.target.value })}
          >
            <option value="releaseDate">Newest Release</option>
            <option value="addedAt">Recently Added</option>
            <option value="title">Title</option>
            <option value="publisher">Publisher</option>
            <option value="fileSizeBytes">File Size</option>
          </select>
          <button
            onClick={() =>
              handleFilterChange({ sortOrder: filters.sortOrder === "asc" ? "desc" : "asc" })
            }
            className="btn-ghost btn-xs gap-1"
            title={filters.sortOrder === "asc" ? "Ascending" : "Descending"}
          >
            <ArrowUpDown
              className={`w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                filters.sortOrder === "desc" ? "rotate-180" : ""
              }`}
            />
            {filters.sortOrder === "asc" ? "A→Z" : "Z→A"}
          </button>
        </div>

      </div>

      {/* Content */}
          {mergedItems.length === 0 ? (
            sourcesQuery.isSuccess && !rssSource && !filters.search && dbTotal === 0 ? (
              /* ── Welcome state (no sources configured, no active search) ── */
              <div className="flex flex-col items-center justify-center py-16 text-center">
                {/* Brand icon */}
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/20 mb-6 ring-1 ring-white/10">
                  <Wind className="w-10 h-10 text-white" />
                </div>

                <h2 className="text-2xl font-bold text-white tracking-tight mb-2">
                  Welcome to PanelShelf
                </h2>
                <p className="text-gray-400 max-w-md leading-relaxed mb-8">
                  Your comic collection manager. Start by enabling one or more
                  content providers — PanelShelf will fetch comics from them
                  and display them here.
                </p>

                {/* Steps */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 mb-8">
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-panel-500/20 text-panel-400 flex items-center justify-center text-sm font-bold shrink-0">
                      1
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-200">Choose a provider</p>
                      <p className="text-xs text-gray-500">Select from available sources</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-600 hidden sm:block shrink-0" />
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-panel-500/20 text-panel-400 flex items-center justify-center text-sm font-bold shrink-0">
                      2
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-200">Enable it</p>
                      <p className="text-xs text-gray-500">Toggle the provider on</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-600 hidden sm:block shrink-0" />
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-panel-500/20 text-panel-400 flex items-center justify-center text-sm font-bold shrink-0">
                      3
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-200">Refresh</p>
                      <p className="text-xs text-gray-500">Comics appear in your catalog</p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigate("/sources")}
                  className="btn-primary gap-2 px-6"
                >
                  <Settings className="w-4 h-4" />
                  Go to Sources
                  <ArrowRight className="w-4 h-4" />
                </button>

                <p className="text-xs text-gray-600 mt-4">
                  Already set up?{" "}
                  <span
                    className="text-panel-400 hover:text-panel-300 cursor-pointer underline underline-offset-2 decoration-panel-500/30"
                    onClick={() => refreshSources()}
                  >
                    Refresh sources
                  </span>
                </p>
              </div>
            ) : (
              /* ── Empty state (sources exist but no results match) ── */
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <BookOpen className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-lg font-medium">No comics found</p>
                <p className="text-sm mt-1">
                  {Object.keys(filters).length > 1
                    ? "Try adjusting your filters"
                    : "No comics match the current search — try a different query"}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-6">
              {/* Live results (search results or browse-all via WordPress pagination) */}
              {mergedItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="badge bg-panel-500/20 text-panel-300 text-xs px-2 py-0.5 rounded-full font-medium">
                      {filters.search ? "SEARCH" : "BROWSE"}
                    </span>
                    <h2 className="text-sm font-medium text-gray-300">
                      {filters.search ? `Results (${mergedItems.length})` : `Latest posts (${mergedItems.length})`}
                    </h2>
                    {livePagesCount > 0 && (
                      <span className="text-xs text-gray-600">
                        live page {livePagesCount}{liveSearchQuery.hasNextPage ? "+" : ""}
                      </span>
                    )}
                    {dcmLivePagesCount > 0 && (
                      <span className="text-xs text-gray-600">
                        DCM page {dcmLivePagesCount}{dcmLiveQuery.hasNextPage ? "+" : ""}
                      </span>
                    )}
                    {iaLivePagesCount > 0 && (
                      <span className="text-xs text-gray-600">
                        IA page {iaLivePagesCount}{iaLiveQuery.hasNextPage ? "+" : ""}
                      </span>
                    )}
                    {dbTotal > 0 && (
                      <span className="text-xs text-gray-600">
                        + {dbTotal} from database
                      </span>
                    )}
                    {cachedCount > 0 && freshCount === 0 && (
                      <span className="text-xs text-amber-400 ml-1">(cached)</span>
                    )}
                    {cachedCount > 0 && freshCount > 0 && (
                      <span className="text-xs text-gray-500 ml-1">
                        {cachedCount} cached &rarr; {freshCount} fresh
                      </span>
                    )}
                    {isRefreshing && (
                      <span className="flex items-center gap-1 text-xs text-yellow-400 ml-1">
                        <div className="animate-spin rounded-full h-2.5 w-2.5 border-b border-yellow-400" />
                        Refreshing...
                      </span>
                    )}
                    {!isRefreshing && (liveSearchQuery.isFetching || dcmLiveQuery.isFetching || iaLiveQuery.isFetching) && liveSearchQuery.isFetchingNextPage !== true && dcmLiveQuery.isFetchingNextPage !== true && iaLiveQuery.isFetchingNextPage !== true && (
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-panel-500" />
                    )}
                  </div>

                  <style>{`
                    @keyframes cache-pop {
                      0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); transform: scale(1); }
                      40% { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0.15); transform: scale(1.02); }
                      100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); transform: scale(1); }
                    }
                  `}</style>

                  {/* Live results — grid or table based on viewMode */}
                  {viewMode === "grid" ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {mergedItems.map((item) => {
                        const isCached = (item as any)._fromCached;
                        const isDb = (item as any)._source === "db";
                        return (
                          <button
                            key={item.id}
                            onClick={() => handleOpenDetail(item)}
                            className={`p-3 group text-left w-full rounded-xl border transition-all duration-500 ${
                              isCached
                                ? "bg-gray-900/50 border-gray-700/30 hover:border-gray-600/50 opacity-70 hover:opacity-90"
                                : "bg-gray-900 border-gray-800 hover:border-panel-700/50 hover:bg-gray-800/80 animate-[cache-pop_0.6s_ease-out]"
                            }`}
                          >
                            <div className={`aspect-[3/4] rounded-lg overflow-hidden mb-2 transition-all duration-500 relative ${
                              isCached
                                ? "bg-gray-800/50 grayscale opacity-60"
                                : "bg-gray-800"
                            }`}>
                              {item.coverUrl ? (
                                <img
                                  src={item.coverUrl}
                                  alt={item.title}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <BookOpen className="w-8 h-8 text-gray-700" />
                                </div>
                              )}
                              {/* Downloaded badge */}
                              {downloadedItems[item.detailUrl] && (
                                <div className="absolute top-2 right-2 bg-emerald-500/90 rounded-full p-1 shadow-lg">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                </div>
                              )}
                            </div>
                            <h3 className={`text-xs font-medium line-clamp-2 transition-colors duration-500 ${
                              isCached
                                ? "text-gray-500 group-hover:text-gray-300"
                                : "text-gray-300 group-hover:text-white"
                            }`}>
                              {item.title}
                            </h3>                              <div className="flex items-center gap-1 mt-1">
                              {isCached ? (
                                <span className="badge bg-amber-500/15 text-amber-400 text-[9px] px-1.5 py-0.5 rounded truncate max-w-full">
                                  cached
                                </span>
                              ) : isDb ? (
                                <span className="badge bg-blue-500/15 text-blue-400 text-[9px] px-1.5 py-0.5 rounded inline-block truncate max-w-full" title={item.source}>
                                  {item.source}
                                </span>
                              ) : (
                                <span className="badge bg-emerald-500/15 text-emerald-400 text-[9px] px-1.5 py-0.5 rounded">
                                  live
                                </span>
                              )}
                              {item.releaseDate && (
                                <span className="text-[10px] text-gray-600">
                                  {new Date(item.releaseDate).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-gray-800">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-900/80 border-b border-gray-800">
                            <th className="text-left px-4 py-3 text-gray-400 font-medium">Title</th>
                            <th className="text-left px-4 py-3 text-gray-400 font-medium">Source</th>
                            <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
                            <th className="text-left px-4 py-3 text-gray-400 font-medium">Release</th>
                            <th className="text-center px-4 py-3 text-gray-400 font-medium">DL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {mergedItems.map((item) => {
                            const isCached = (item as any)._fromCached;
                            const isDb = (item as any)._source === "db";
                            return (
                              <tr
                                key={item.id}
                                onClick={() => handleOpenDetail(item)}
                                className="hover:bg-gray-900/50 transition-colors group cursor-pointer"
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-3">
                                    {/* Small cover thumbnail */}
                                    <div className={`w-10 h-14 rounded overflow-hidden shrink-0 ${
                                      isCached ? "grayscale opacity-60" : ""
                                    }`}>
                                      {item.coverUrl ? (
                                        <img
                                          src={item.coverUrl}
                                          alt={item.title}
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = "none";
                                          }}
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-800">
                                          <BookOpen className="w-4 h-4 text-gray-600" />
                                        </div>
                                      )}
                                    </div>
                                    <span className={`line-clamp-1 font-medium transition-colors ${
                                      isCached ? "text-gray-500" : "text-gray-200 group-hover:text-panel-400"
                                    }`}>
                                      {item.title}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-gray-400">
                                  {item.source || "-"}
                                </td>
                                <td className="px-4 py-3">
                                  {isCached ? (
                                    <span className="badge bg-amber-500/15 text-amber-400 text-[10px] px-1.5 py-0.5 rounded">cached</span>
                                  ) : isDb ? (
                                    <span className="badge bg-blue-500/15 text-blue-400 text-[10px] px-1.5 py-0.5 rounded inline-block truncate max-w-full" title={item.source}>{item.source}</span>
                                  ) : (
                                    <span className="badge bg-emerald-500/15 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded">live</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-gray-400">
                                  {item.releaseDate ? new Date(item.releaseDate).toLocaleDateString() : "-"}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {downloadedItems[item.detailUrl] ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                                  ) : (
                                    <span className="text-gray-700">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Pinned download links from previously closed detail panels */}
                  {pinnedDownloads.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {pinnedDownloads.map((pinned) => (
                        <div key={pinned.id} className="p-4 bg-gray-900/80 border border-gray-700/50 rounded-xl">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Download Links
                            </h3>
                            <span className="text-sm text-gray-300 truncate max-w-[200px] sm:max-w-[400px] mr-auto ml-2">
                              {pinned.title}
                            </span>
                            <button
                              onClick={() => handleDismissPinned(pinned.id)}
                              className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                              title="Remove pinned links"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {pinned.downloadLinks.map((link, i) => (
                              <DownloadButton
                                key={`${pinned.id}-${i}`}
                                link={link}
                                isClicked={clickedUrls[link.url]}
                                onClick={handleDownloadClick}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )}

              {/* Infinite scroll sentinel — a minimal 1px target for IntersectionObserver.
                   Load-more UI is rendered separately below so sentinel height stays small. */}
              <div
                ref={liveSentinelRef}
                className={mergedItems.length === 0 && !liveHasMore && !dbHasMore ? "h-0 overflow-hidden" : "h-px"}
              />

              {/* Load-more / skeleton / end-state UI (below sentinel, not inside it) */}
              {(liveSearchQuery.isFetchingNextPage || dcmLiveQuery.isFetchingNextPage || iaLiveQuery.isFetchingNextPage) && (
                <div className="transition-opacity duration-300">
                  <SkeletonGrid cols="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" />
                </div>
              )}
              {liveSearchQuery.hasNextPage && (
                <div className="flex items-center justify-center py-4">
                  {liveSearchQuery.isFetchingNextPage ? (
                    <button
                      disabled
                      className="btn-secondary btn-sm gap-2 opacity-60 cursor-not-allowed"
                    >
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-current" />
                      Loading...
                    </button>
                  ) : liveSearchQuery.isError ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{liveSearchQuery.error instanceof Error ? liveSearchQuery.error.message : "Failed to load more results"}</span>
                      </div>
                      <button
                        onClick={() => liveSearchQuery.fetchNextPage()}
                        className="btn-secondary btn-sm gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => liveSearchQuery.fetchNextPage()}
                      className="btn-secondary btn-sm"
                    >
                      Show more
                    </button>
                  )}
                </div>
              )}
              {dcmLiveQuery.hasNextPage && !liveSearchQuery.hasNextPage && (
                <div className="flex items-center justify-center py-4">
                  {dcmLiveQuery.isFetchingNextPage ? (
                    <button disabled className="btn-secondary btn-sm gap-2 opacity-60 cursor-not-allowed">
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-current" />
                      Loading DCM...
                    </button>
                  ) : dcmLiveQuery.isError ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{dcmLiveQuery.error instanceof Error ? dcmLiveQuery.error.message : "Failed to load DCM results"}</span>
                      </div>
                      <button
                        onClick={() => dcmLiveQuery.fetchNextPage()}
                        className="btn-secondary btn-sm gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => dcmLiveQuery.fetchNextPage()}
                      className="btn-secondary btn-sm"
                    >
                      Load more from DCM
                    </button>
                  )}
                </div>
              )}
              {iaLiveQuery.hasNextPage && !liveSearchQuery.hasNextPage && !dcmLiveQuery.hasNextPage && (
                <div className="flex items-center justify-center py-4">
                  {iaLiveQuery.isFetchingNextPage ? (
                    <button disabled className="btn-secondary btn-sm gap-2 opacity-60 cursor-not-allowed">
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-current" />
                      Loading Internet Archive...
                    </button>
                  ) : iaLiveQuery.isError ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{iaLiveQuery.error instanceof Error ? iaLiveQuery.error.message : "Failed to load Internet Archive results"}</span>
                      </div>
                      <button
                        onClick={() => iaLiveQuery.fetchNextPage()}
                        className="btn-secondary btn-sm gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => iaLiveQuery.fetchNextPage()}
                      className="btn-secondary btn-sm"
                    >
                      Load more from Internet Archive
                    </button>
                  )}
                </div>
              )}
              {catalogQuery.hasNextPage && !liveHasMore && (
                <div className="flex items-center justify-center py-4">
                  {catalogQuery.isFetchingNextPage ? (
                    <button disabled className="btn-secondary btn-sm gap-2 opacity-60 cursor-not-allowed">
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-current" />
                      Loading from database...
                    </button>
                  ) : (
                    <button
                      onClick={() => catalogQuery.fetchNextPage()}
                      className="btn-secondary btn-sm"
                    >
                      Load more from database
                    </button>
                  )}
                </div>
              )}
              {!liveHasMore && !dbHasMore && mergedItems.length > 0 && (
                <div className="flex items-center justify-center py-4">
                  <span className="text-xs text-gray-600">All results loaded</span>
                </div>
              )}

                  {/* Detail panel overlay */}
                  {selectedItem && (
                    <div
                      className="fixed inset-0 z-50 flex items-start justify-center pt-12 pb-8 px-4"
                      onClick={handleCloseDetail}
                    >
                      {/* Backdrop */}
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                      {/* Panel */}
                      <div
                        className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Close button */}
                        <button
                          onClick={handleCloseDetail}
                          className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-gray-800/80 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>

                        {detailLoading ? (
                          <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-6 h-6 animate-spin text-panel-400" />
                          </div>
                        ) : detailError ? (
                          <div className="p-6 text-center">
                            <p className="text-red-400 text-sm mb-3">{detailError}</p>
                            <button onClick={() => handleOpenDetail(selectedItem)} className="btn-secondary btn-sm">
                              Retry
                            </button>
                            <a
                              href={selectedItem.detailUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-ghost btn-sm ml-2"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open in browser
                            </a>
                          </div>
                        ) : detailData ? (
                          <div>
                            {/* Cover */}
                            {detailData.coverUrl && (
                              <div className="w-full aspect-[16/9] bg-gray-800 overflow-hidden">
                                <img
                                  src={detailData.coverUrl}
                                  alt={detailData.title}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              </div>
                            )}

                            <div className="p-5 space-y-4">
                              {/* Title */}
                              <h2 className="text-lg font-semibold text-white leading-snug">
                                {detailData.title}
                              </h2>

                              {/* Description */}
                              {detailData.description && (
                                <p className="text-sm text-gray-400 leading-relaxed">
                                  {detailData.description}
                                </p>
                              )}

                              {/* Download links */}
                              {detailData.downloadLinks.length > 0 ? (
                                <div className="space-y-2">
                                  <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Download Links
                                  </h3>
                                  <div className="grid grid-cols-2 gap-2">
                                    {detailData.downloadLinks.map((link, i) => (
                                      <DownloadButton
                                        key={i}
                                        link={link}
                                        isClicked={clickedUrls[link.url]}
                                        onClick={handleDownloadClick}
                                      />
                                    ))}
                                  </div>
                                  <button
                                    onClick={() => handlePinDownload(selectedItem, detailData)}
                                    className="mt-2 btn-ghost btn-xs gap-1.5 text-panel-400 hover:text-panel-300"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Pin these links
                                  </button>
                                </div>
                              ) : (
                                <p className="text-sm text-gray-600">No download links found.</p>
                              )}

                              {/* Footer actions */}
                              <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
                                <a
                                  href={selectedItem.detailUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn-ghost btn-sm gap-1.5 text-xs"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  View on site
                                </a>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}


            </div>
          )}
    </div>
  );
}

// ── Skeleton loading grid (extracted from component, avoids re-creation on every render) ──

function SkeletonGrid({ cols = "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" }: { cols?: string }) {
  return (
    <div className={`grid ${cols} gap-3`}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse bg-gray-800/50 rounded-xl aspect-[3/4]" />
      ))}
    </div>
  );
}

// ── Download button (memoized, avoids re-render when parent updates unrelated state) ──

const DownloadButton = React.memo(function DownloadButton({
  link,
  isClicked,
  onClick,
}: {
  link: { provider: string; url: string; className: string };
  isClicked?: boolean;
  onClick?: (link: { provider: string; url: string; className: string }) => void;
}) {
  const handleClick = () => {
    // Update parent state (clickedUrls, downloadedItems, downloadHistory)
    onClick?.(link);
    // Persist to localStorage as a fallback for cross-session tracking
    try {
      const stored = localStorage.getItem(CLICKED_URLS_KEY);
      const current = stored ? JSON.parse(stored) : {};
      current[link.url] = true;
      localStorage.setItem(CLICKED_URLS_KEY, JSON.stringify(current));
    } catch {}
  };

  return (
    <div className="relative">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          handleClick();
        }}
        className={`btn-secondary btn-xs gap-1.5 text-xs w-full justify-center ${
          isClicked ? "opacity-50" : ""
        } ${link.className || ""}`}
        title={`Download from ${link.provider}`}
      >
        <Download className="w-3 h-3" />
        {link.provider}
        {isClicked && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />}
        <ExternalLink className="w-2.5 h-2.5 text-gray-600 shrink-0" />
      </a>
    </div>
  );
});
