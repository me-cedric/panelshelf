import type {
  CatalogItemWithLinks,
  Source,
  Download,
  SavedSearch,
  SuccessResponse,
  SuccessWithMessageResponse,
  QueuedRefreshResponse,
  EnqueueDownloadResponse,
  FilterValuesResponse,
  LiveSearchResult,
  DetailLinksResult,
  ProvidersResponse,
  ToggleProviderResult,
  CatalogItem,
} from "../types/index.ts";
import { validateResponse } from "./validation.ts";
import {
  catalogItemWithLinksShape,
  savedSearchShape,
  successShape,
  successWithMessageShape,
  queuedRefreshShape,
  downloadsResponseShape,
  enqueueDownloadShape,
  liveSearchShape,
  detailLinksShape,
  filterValuesShape,
  toggleProviderShape,
  catalogResponseShape,
} from "../types/schemas.ts";
import type { CatalogFilters } from "../types/index.ts";

// Detect if running inside Tauri desktop app.
// In Tauri mode, the frontend is served from the filesystem but API calls
// need to reach the backend server running on a local port (default 3001).
// In browser mode, the Vite dev server proxies /api to the backend.
const isTauri =
  typeof window !== "undefined" &&
  (window as any).__TAURI_INTERNALS__ !== undefined;

const API_BASE = isTauri ? "http://127.0.0.1:3001/api" : "/api";

async function fetchJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  const hasBody = !!(options?.body && typeof options.body === "string" && options.body.length > 0);
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Catalog
export function fetchCatalogItem(id: string): Promise<CatalogItemWithLinks> {
  return fetchJson(`/catalog/${id}`).then((data) =>
    validateResponse(data, catalogItemWithLinksShape, `GET /catalog/${id}`)
  );
}

export function fetchFilterValues(column: string): Promise<FilterValuesResponse> {
  return fetchJson(`/catalog/filters/${column}`).then((data) =>
    validateResponse(data, filterValuesShape, `GET /catalog/filters/${column}`)
  );
}

// Sources
export function fetchSources(): Promise<{ sources: Source[] }> {
  return fetchJson("/sources").then((data) =>
    validateResponse(data, { sources: ["arr"] }, "GET /sources")
  );
}

export function refreshSource(id: string): Promise<QueuedRefreshResponse> {
  return fetchJson(`/sources/${id}/refresh`, { method: "POST" }).then((data) =>
    validateResponse(data, queuedRefreshShape, `POST /sources/${id}/refresh`)
  );
}

// Downloads
export function fetchDownloads(params?: {
  status?: string;
}): Promise<{ items: Download[]; total: number }> {
  const query = params?.status ? `?status=${params.status}` : "";
  return fetchJson(`/downloads${query}`).then((data) =>
    validateResponse(data, downloadsResponseShape, `GET /downloads${query}`)
  );
}

export function enqueueDownload(
  downloadLinkId: string
): Promise<EnqueueDownloadResponse> {
  return fetchJson("/downloads", {
    method: "POST",
    body: JSON.stringify({ downloadLinkId }),
  }).then((data) =>
    validateResponse(data, enqueueDownloadShape, "POST /downloads")
  );
}

export function pauseDownload(id: string): Promise<SuccessResponse> {
  return fetchJson(`/downloads/${id}/pause`, { method: "POST" }).then((data) =>
    validateResponse(data, successShape, `POST /downloads/${id}/pause`)
  );
}

export function resumeDownload(id: string): Promise<SuccessResponse> {
  return fetchJson(`/downloads/${id}/resume`, { method: "POST" }).then((data) =>
    validateResponse(data, successShape, `POST /downloads/${id}/resume`)
  );
}

export function retryDownload(id: string): Promise<SuccessResponse> {
  return fetchJson(`/downloads/${id}/retry`, { method: "POST" }).then((data) =>
    validateResponse(data, successShape, `POST /downloads/${id}/retry`)
  );
}

export function cancelDownload(id: string): Promise<SuccessResponse> {
  return fetchJson(`/downloads/${id}/cancel`, { method: "POST" }).then((data) =>
    validateResponse(data, successShape, `POST /downloads/${id}/cancel`)
  );
}

// Saved Searches
export function fetchSavedSearches(): Promise<{ searches: SavedSearch[] }> {
  return fetchJson("/saved-searches").then((data) =>
    validateResponse(data, { searches: ["arr"] }, "GET /saved-searches")
  );
}

export function createSavedSearch(
  data: Partial<SavedSearch>
): Promise<{ search: SavedSearch }> {
  return fetchJson("/saved-searches", {
    method: "POST",
    body: JSON.stringify(data),
  }).then((data) =>
    validateResponse(
      data,
      { search: ["obj", savedSearchShape] },
      "POST /saved-searches"
    )
  );
}

export function deleteSavedSearch(id: string): Promise<SuccessResponse> {
  return fetchJson(`/saved-searches/${id}`, { method: "DELETE" }).then((data) =>
    validateResponse(data, successShape, `DELETE /saved-searches/${id}`)
  );
}

// Live search: proxy search to the source's feed in real-time
// Supports progressive pagination via `page` parameter.
// When `fresh=true`, bypasses backend cache and fetches directly from source.
// Response includes `cached` to indicate if the data came from cache.
export function liveSearchCatalog(
  sourceId: string,
  q: string,
  page: number = 1,
  fresh: boolean = false
): Promise<LiveSearchResult> {
  const params = new URLSearchParams({
    sourceId,
    q,
    page: String(page),
  });
  if (fresh) {
    params.set("fresh", "true");
  }
  return fetchJson(`/catalog/live-search?${params.toString()}`).then((data) =>
    validateResponse(data, liveSearchShape, "GET /catalog/live-search")
  );
}

// Live detail: fetch download links from a detail page URL
// Used to get download links for live search results.
export function fetchDetailLinks(
  url: string
): Promise<DetailLinksResult> {
  return fetchJson(`/catalog/live-detail?url=${encodeURIComponent(url)}`).then((data) =>
    validateResponse(data, detailLinksShape, "GET /catalog/live-detail")
  );
}

// ── Providers ──

export function fetchProviders(): Promise<ProvidersResponse> {
  return fetchJson("/providers").then((data) =>
    validateResponse(data, { providers: ["arr"] }, "GET /providers")
  );
}

export function toggleProvider(id: string): Promise<ToggleProviderResult> {
  return fetchJson(`/providers/${id}/toggle`, { method: "POST" }).then((data) =>
    validateResponse(data, toggleProviderShape, `POST /providers/${id}/toggle`)
  );
}

export function clearProviderCache(id: string): Promise<SuccessWithMessageResponse> {
  return fetchJson(`/providers/${id}/clear-cache`, { method: "POST" }).then((data) =>
    validateResponse(data, successWithMessageShape, `POST /providers/${id}/clear-cache`)
  );
}

// Catalog database query (GET /api/catalog) — for non-RSS sources and ingested items
export interface CatalogResponse {
  items: CatalogItem[];
  total: number;
  limit: number;
  offset: number;
}

export function fetchCatalogItems(
  filters: CatalogFilters = {}
): Promise<CatalogResponse> {
  const params = new URLSearchParams();

  if (filters.search) params.set("search", filters.search);
  if (filters.publisher) params.set("publisher", filters.publisher);
  if (filters.series) params.set("series", filters.series);
  if (filters.language) params.set("language", filters.language);
  if (filters.format) params.set("format", filters.format);
  if (filters.sourceId) params.set("sourceId", filters.sourceId);
  if (filters.downloadAvailable !== undefined) params.set("downloadAvailable", String(filters.downloadAvailable));
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.addedFrom) params.set("addedFrom", filters.addedFrom);
  if (filters.addedTo) params.set("addedTo", filters.addedTo);
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);
  params.set("limit", String(filters.limit || 50));
  params.set("offset", String(filters.offset || 0));

  const qs = params.toString();
  return fetchJson(`/catalog${qs ? `?${qs}` : ""}`).then((data) =>
    validateResponse(data, catalogResponseShape, "GET /catalog")
  );
}

// ── Settings ──

export function fetchSettings(): Promise<{ settings: Record<string, unknown> }> {
  return fetchJson("/settings").then((data) =>
    validateResponse(data, { settings: ["obj"] }, "GET /settings")
  );
}

export function updateSettings(
  updates: Record<string, unknown>
): Promise<{ settings: Record<string, unknown> }> {
  return fetchJson("/settings", {
    method: "POST",
    body: JSON.stringify(updates),
  }).then((data) =>
    validateResponse(data, { settings: ["obj"] }, "POST /settings")
  );
}

// Cache
export function clearCache(): Promise<SuccessWithMessageResponse> {
  return fetchJson("/cache/clear", { method: "POST" }).then((data) =>
    validateResponse(data, successWithMessageShape, "POST /cache/clear")
  );
}


