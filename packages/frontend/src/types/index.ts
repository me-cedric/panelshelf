// Types derived from Zod schemas — edit the schema in schemas.ts, and the type updates here automatically.
// Types without a corresponding schema are hand-written.

import type { z } from "zod";
import type {
  sourceSchema,
  catalogItemSchema,
  savedSearchSchema,
  librarySourceSchema,
  libraryItemSchema,
  readingProgressSchema,
  scanResultSchema,
  libraryStatsSchema,
  libraryItemsResponseSchema,
  downloadLinkSchema,
  downloadSchema,
  catalogItemWithLinksSchema,
  successResponseSchema,
  successWithMessageResponseSchema,
  queuedRefreshResponseSchema,
  enqueueDownloadResponseSchema,
  filterValuesResponseSchema,
  liveSearchResultSchema,
  detailLinksResultSchema,
  providersResponseSchema,
  toggleProviderResultSchema,
} from "./schemas.ts";

export type Source = z.output<typeof sourceSchema>;
export type CatalogItem = z.output<typeof catalogItemSchema>;
export type SavedSearch = z.output<typeof savedSearchSchema>;
export type LibrarySource = z.output<typeof librarySourceSchema>;
export type LibraryItem = z.output<typeof libraryItemSchema>;
export type ReadingProgress = z.output<typeof readingProgressSchema>;
export type ScanResult = z.output<typeof scanResultSchema>;
export type LibraryStats = z.output<typeof libraryStatsSchema>;
export type LibraryItemsResponse = z.output<typeof libraryItemsResponseSchema>;
export type DownloadLink = z.output<typeof downloadLinkSchema>;
export type Download = z.output<typeof downloadSchema>;
export type CatalogItemWithLinks = z.output<typeof catalogItemWithLinksSchema>;

// ── Lightweight response types ──

export type SuccessResponse = z.output<typeof successResponseSchema>;
export type SuccessWithMessageResponse = z.output<typeof successWithMessageResponseSchema>;
export type QueuedRefreshResponse = z.output<typeof queuedRefreshResponseSchema>;
export type EnqueueDownloadResponse = z.output<typeof enqueueDownloadResponseSchema>;
export type FilterValuesResponse = z.output<typeof filterValuesResponseSchema>;
export type LiveSearchResult = z.output<typeof liveSearchResultSchema>;
export type DetailLinksResult = z.output<typeof detailLinksResultSchema>;
export type ProvidersResponse = z.output<typeof providersResponseSchema>;
export type ToggleProviderResult = z.output<typeof toggleProviderResultSchema>;

// ── Hand-written types (no zod schema) ──

export interface CatalogFilters {
  search?: string;
  publisher?: string;
  series?: string;
  language?: string;
  format?: string;
  sourceId?: string;
  downloadAvailable?: boolean;
  dateFrom?: string;
  dateTo?: string;
  addedFrom?: string;
  addedTo?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}
