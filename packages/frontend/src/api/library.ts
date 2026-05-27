import type {
  LibrarySource,
  LibraryItem,
  LibraryItemsResponse,
  ReadingProgress,
  ScanResult,
} from "../types/index.ts";
import { validateResponse } from "./validation.ts";
import {
  librarySourceShape,
  libraryItemShape,
  readingProgressShape,
  scanResultShape,
  libraryStatsShape,
  libraryItemsResponseShape,
  successShape,
  successWithDeletedShape,
} from "../types/schemas.ts";

const isTauri =
  typeof window !== "undefined" &&
  (window as any).__TAURI_INTERNALS__ !== undefined;

const API_BASE = isTauri ? "http://127.0.0.1:3001/api" : "/api";

async function fetchJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  const hasBody = !!(
    options?.body &&
    typeof options.body === "string" &&
    options.body.length > 0
  );
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

// ── Library Sources ──

export function fetchLibrarySources(): Promise<{ sources: LibrarySource[] }> {
  return fetchJson("/library/sources").then((data) =>
    validateResponse(data, { sources: ["arr"] }, "GET /library/sources")
  );
}

export function createLibrarySource(data: {
  name?: string;
  path: string;
  enabled?: boolean;
  scanRecursive?: boolean;
}): Promise<{ source: LibrarySource }> {
  return fetchJson("/library/sources", {
    method: "POST",
    body: JSON.stringify(data),
  }).then((data) =>
    validateResponse(
      data,
      { source: ["obj", librarySourceShape] },
      "POST /library/sources"
    )
  );
}

export function deleteLibrarySource(
  id: string
): Promise<{ success: boolean }> {
  return fetchJson(`/library/sources/${id}`, { method: "DELETE" }).then((data) =>
    validateResponse(data, successShape, `DELETE /library/sources/${id}`)
  );
}

export function scanLibrarySource(
  id: string
): Promise<ScanResult> {
  return fetchJson(`/library/sources/${id}/scan`, { method: "POST" }).then((data) =>
    validateResponse(data, scanResultShape, `POST /library/sources/${id}/scan`)
  );
}

export function clearAllLibrarySources(): Promise<{ success: boolean; deletedItems: number }> {
  return fetchJson("/library/clear", { method: "POST" }).then((data) =>
    validateResponse(data, successWithDeletedShape, "POST /library/clear")
  );
}

export function touchScanAllTimestamp(): Promise<{ success: boolean }> {
  return fetchJson("/library/touch-scan-all", { method: "POST" }).then((data) =>
    validateResponse(data, successShape, "POST /library/touch-scan-all")
  );
}

export function clearLibrarySource(
  sourceId: string
): Promise<{ success: boolean; deletedItems: number }> {
  return fetchJson(`/library/clear/${sourceId}`, { method: "POST" }).then((data) =>
    validateResponse(
      data,
      successWithDeletedShape,
      `POST /library/clear/${sourceId}`
    )
  );
}

// ── Library Stats ──

export function fetchLibraryStats(): Promise<{
  totalSources: number;
  totalItems: number;
  completedCount: number;
  inProgressCount: number;
  unreadCount: number;
  lastScanAllAt: string | null;
}> {
  return fetchJson("/library/stats").then((data) =>
    validateResponse(data, libraryStatsShape, "GET /library/stats")
  );
}

// ── Library Items ──

export function fetchLibraryItems(params?: {
  sourceId?: string;
  search?: string;
  format?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}): Promise<LibraryItemsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.sourceId) searchParams.set("sourceId", params.sourceId);
  if (params?.search) searchParams.set("search", params.search);
  if (params?.format) searchParams.set("format", params.format);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);
  const qs = searchParams.toString();
  return fetchJson(`/library/items${qs ? `?${qs}` : ""}`).then((data) =>
    validateResponse(data, libraryItemsResponseShape, "GET /library/items")
  );
}

export function fetchLibraryItem(
  id: string
): Promise<{ item: LibraryItem; progress: ReadingProgress | null }> {
  return fetchJson(`/library/items/${id}`).then((data) =>
    validateResponse(
      data,
      {
        item: ["obj", libraryItemShape],
        "?progress": "any",
      },
      `GET /library/items/${id}`
    )
  );
}

// ── Comic Reading ──

/**
 * Get the cover image URL for a library item (served via backend).
 */
export function getCoverUrl(id: string): string {
  return `${API_BASE}/library/items/${id}/cover`;
}

/**
 * Get a specific page image URL from a library item.
 */
export function getPageUrl(id: string, pageNum: number): string {
  return `${API_BASE}/library/items/${id}/page/${pageNum}`;
}

// ── Reading Progress ──

export function fetchReadingProgress(
  id: string
): Promise<{ progress: ReadingProgress }> {
  return fetchJson(`/library/items/${id}/progress`).then((data) =>
    validateResponse(
      data,
      { progress: ["obj", readingProgressShape] },
      `GET /library/items/${id}/progress`
    )
  );
}

export function updateReadingProgress(
  id: string,
  data: { currentPage?: number; completed?: boolean }
): Promise<{ progress: ReadingProgress }> {
  return fetchJson(`/library/items/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  }).then((data) =>
    validateResponse(
      data,
      { progress: ["obj", readingProgressShape] },
      `PUT /library/items/${id}/progress`
    )
  );
}
