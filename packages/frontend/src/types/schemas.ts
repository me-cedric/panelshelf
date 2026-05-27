/**
 * Zod schemas for API response types.
 *
 * Each domain type has a zod schema that mirrors its TypeScript interface.
 * Pre-computed shapes are exported so API functions can use them
 * instead of manually duplicating field definitions.
 *
 * The `shapeOf()` helper introspects a zod schema at runtime and
 * produces the lightweight Shape format used by validateResponse().
 * This gives us a single source of truth — update the zod schema,
 * and both the TypeScript type (via z.infer/z.output) and the
 * runtime validation shape stay in sync automatically.
 */

import { z } from "zod";
import type { Shape } from "../api/validation.ts";

// ── Introspection helper ──

function zodToShape(schema: z.ZodType): any {
  const ctor = schema.constructor.name;

  switch (ctor) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodEnum":
      return "string";

    case "ZodLiteral": {
      // This Zod build stores the value in _def.values array instead of _def.value
      const vals = (schema as any)._def?.values;
      const val = Array.isArray(vals) ? vals[0] : undefined;
      if (typeof val === "string") return "string";
      if (typeof val === "number") return "number";
      if (typeof val === "boolean") return "boolean";
      return "any";
    }

    case "ZodAny":
    case "ZodNull":
    case "ZodUndefined":
      return "any";

    // Optional → unwrap and recurse (the shape's "?" prefix is handled at the object level)
    case "ZodOptional":
      return zodToShape((schema as any).unwrap());

    // Nullable → unwrap and recurse (null is already accepted by validateResponse for any field)
    case "ZodNullable":
      return zodToShape((schema as any).unwrap());

    // Default → unwrap and recurse (behaves like optional at runtime)
    case "ZodDefault":
      return zodToShape((schema as any)._def?.innerType ?? (schema as any).unwrap());

    case "ZodArray": {
      const element = (schema as any).element;
      if (element?.constructor?.name === "ZodObject") {
        return ["arr", zodToShape(element)];
      }
      return ["arr"];
    }

    case "ZodObject": {
      const shape: Shape = {};
      for (const [key, field] of Object.entries((schema as any).shape)) {
        const fieldSchema = field as z.ZodType;
        const fieldCtor = fieldSchema.constructor.name;

        let isOptional = false;
        let inner = fieldSchema;

        // Unwrap Optional / Default (field becomes optional — "?" prefix)
        if (fieldCtor === "ZodOptional") {
          isOptional = true;
          inner = (fieldSchema as any).unwrap();
        } else if (fieldCtor === "ZodDefault") {
          isOptional = true;
          inner = (fieldSchema as any)._def?.innerType ?? (fieldSchema as any).unwrap();
        }

        const shapeKey = isOptional ? `?${key}` : key;

        // Unwrap Nullable to reach the underlying type
        let actual = inner;
        let actualCtor = actual.constructor.name;
        if (actualCtor === "ZodNullable") {
          actual = (actual as any).unwrap();
          actualCtor = actual.constructor.name;
        }

        // Nested object fields need ["obj", Shape] format so checkShape
        // can recurse into them instead of treating the shape dict as a type string.
        if (actualCtor === "ZodObject" || actualCtor === "ZodRecord" || actualCtor === "ZodDiscriminatedUnion") {
          shape[shapeKey] = ["obj", zodToShape(actual)];
        } else {
          // Primitives, arrays, enums, and other wrappers — delegate to zodToShape
          shape[shapeKey] = zodToShape(fieldSchema);
        }
      }
      return shape;
    }

    default:
      return "any";
  }
}

/**
 * Convert a zod object schema to a pre-computed Shape.
 */
export function shapeOf<T extends z.ZodType>(schema: T): Shape {
  return zodToShape(schema) as Shape;
}

// ── Domain schemas ──
// Mirrors the interfaces in types/index.ts

export const librarySourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  enabled: z.boolean(),
  scanRecursive: z.boolean(),
  lastScannedAt: z.string().nullable(),
  itemCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const libraryItemSchema = z.object({
  id: z.string(),
  librarySourceId: z.string(),
  title: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  format: z.string(),
  fileSizeBytes: z.number().nullable(),
  pageCount: z.number().nullable(),
  coverCached: z.boolean(),
  addedAt: z.string(),
  // Reading progress join (nullable)
  currentPage: z.number().nullable(),
  totalPages: z.number().nullable(),
  completed: z.boolean().nullable(),
  lastReadAt: z.string().nullable(),
});

export const readingProgressSchema = z.object({
  id: z.string(),
  libraryItemId: z.string(),
  currentPage: z.number(),
  totalPages: z.number().nullable(),
  completed: z.boolean(),
  lastReadAt: z.string(),
});

export const scanResultSchema = z.object({
  added: z.number(),
  skipped: z.number(),
  total: z.number(),
  errors: z.array(z.string()),
});

export const libraryStatsSchema = z.object({
  totalSources: z.number(),
  totalItems: z.number(),
  completedCount: z.number(),
  inProgressCount: z.number(),
  unreadCount: z.number(),
  lastScanAllAt: z.string().nullable(),
});

export const libraryItemsResponseSchema = z.object({
  items: z.array(libraryItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// ── Catalog types ──

export const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["rss", "json-api", "static-index", "local-folder", "manual-url"]),
  baseUrl: z.string(),
  enabled: z.boolean(),
  refreshIntervalMin: z.number(),
  headers: z.string().nullable(),
  rateLimitMs: z.number().nullable(),
  lastFetchedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const catalogItemSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  title: z.string(),
  series: z.string().nullable(),
  issueNumber: z.string().nullable(),
  volume: z.string().nullable(),
  publisher: z.string().nullable(),
  releaseDate: z.string().nullable(),
  addedAt: z.string(),
  language: z.string().nullable(),
  format: z.string().nullable(),
  fileSize: z.string().nullable(),
  fileSizeBytes: z.number().nullable(),
  tags: z.string().nullable(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  detailUrl: z.string().nullable(),
  stableHash: z.string(),
  downloadAvailable: z.boolean(),
});

export const savedSearchSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string().nullable(),
  filters: z.string().nullable(),
  sortBy: z.string().nullable(),
  sortOrder: z.enum(["asc", "desc"]).nullable(),
  createdAt: z.string(),
});

// ── Download types ──

export const downloadLinkSchema = z.object({
  id: z.string(),
  catalogItemId: z.string(),
  provider: z.string(),
  fileName: z.string().nullable(),
  size: z.string().nullable(),
  url: z.string(),
  linkType: z.enum(["direct", "redirect", "manual", "unknown"]),
  directDownloadCapable: z.boolean(),
  manualActionRequired: z.boolean(),
});

export const downloadSchema = z.object({
  id: z.string(),
  catalogItemId: z.string().nullable(),
  downloadLinkId: z.string().nullable(),
  url: z.string(),
  fileName: z.string().nullable(),
  destinationPath: z.string().nullable(),
  status: z.enum(["pending", "running", "paused", "completed", "failed"]),
  progress: z.number(),
  speed: z.number().nullable(),
  eta: z.number().nullable(),
  totalBytes: z.number().nullable(),
  downloadedBytes: z.number().nullable(),
  errorLog: z.string().nullable(),
  retryCount: z.number(),
  maxRetries: z.number(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

// ── Catalog item with links ──

export const catalogItemWithLinksSchema = z.object({
  item: catalogItemSchema,
  links: z.array(downloadLinkSchema),
});

// ── Pre-computed shapes ──

export const librarySourceShape = shapeOf(librarySourceSchema);
export const libraryItemShape = shapeOf(libraryItemSchema);
export const readingProgressShape = shapeOf(readingProgressSchema);
export const scanResultShape = shapeOf(scanResultSchema);
export const libraryStatsShape = shapeOf(libraryStatsSchema);
export const libraryItemsResponseShape = shapeOf(libraryItemsResponseSchema);
export const savedSearchShape = shapeOf(savedSearchSchema);
export const catalogItemWithLinksShape = shapeOf(catalogItemWithLinksSchema);

// ── Lightweight response schemas ──
// For simple API responses. Schemas are the single source of truth:
// they produce both TypeScript types (via z.output) and runtime validation shapes.

export const successResponseSchema = z.object({
  success: z.boolean(),
});

export const successWithMessageResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const queuedRefreshResponseSchema = z.object({
  queued: z.boolean(),
  sourceId: z.string(),
});

export const enqueueDownloadResponseSchema = z.object({
  downloadId: z.string(),
});

export const filterValuesResponseSchema = z.object({
  column: z.string(),
  values: z.array(z.string()),
});

// ── Catalog response schema (GET /api/catalog) ──
// Maps catalog items to a format compatible with the live-search UI
export const catalogResponseSchema = z.object({
  items: z.array(catalogItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// ── Live search schemas ──

export const liveSearchItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  detailUrl: z.string(),
  coverUrl: z.string().optional(),
  releaseDate: z.string().nullable(),
  source: z.string(),
  sourceId: z.string(),
  live: z.literal(true),
});

export const liveSearchResultSchema = z.object({
  items: z.array(liveSearchItemSchema),
  page: z.number(),
  totalPages: z.number(),
  hasMore: z.boolean(),
  cached: z.boolean(),
});

export const detailLinkSchema = z.object({
  provider: z.string(),
  url: z.string(),
  className: z.string(),
});

export const detailLinksResultSchema = z.object({
  title: z.string(),
  coverUrl: z.string().optional(),
  description: z.string(),
  downloadLinks: z.array(detailLinkSchema),
});

// ── Provider schemas ──

export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  configurable: z.boolean(),
  enabled: z.boolean(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  lastFetchedAt: z.string().nullable(),
});

export const providersResponseSchema = z.object({
  providers: z.array(providerSchema),
});

export const toggleProviderResultSchema = z.object({
  provider: z.object({
    id: z.string(),
    enabled: z.boolean(),
    sourceId: z.string().nullable(),
    sourceName: z.string().nullable(),
    lastFetchedAt: z.string().nullable(),
  }),
});

// ── Stats schemas ──

// ── Lightweight response shapes (derived from schemas) ──

export const catalogResponseShape = shapeOf(catalogResponseSchema);

export const successShape = shapeOf(successResponseSchema);
export const successWithDeletedShape: Shape = {
  success: "boolean",
  deletedItems: "number",
};
export const successWithMessageShape = shapeOf(successWithMessageResponseSchema);
export const queuedRefreshShape = shapeOf(queuedRefreshResponseSchema);
export const paginatedItemsShape: Shape = {
  items: ["arr"],
  total: "number",
  limit: "number",
  offset: "number",
};
export const downloadsResponseShape: Shape = {
  items: ["arr"],
  total: "number",
};
export const enqueueDownloadShape = shapeOf(enqueueDownloadResponseSchema);
export const liveSearchShape = shapeOf(liveSearchResultSchema);
export const detailLinksShape = shapeOf(detailLinksResultSchema);
export const filterValuesShape = shapeOf(filterValuesResponseSchema);
export const toggleProviderShape = shapeOf(toggleProviderResultSchema);
