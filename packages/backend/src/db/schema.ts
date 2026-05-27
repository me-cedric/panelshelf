import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ── Sources ──
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["rss", "json-api", "static-index", "local-folder", "manual-url"],
  }).notNull(),
  baseUrl: text("base_url").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  refreshIntervalMin: integer("refresh_interval_min").notNull().default(60),
  headers: text("headers"), // JSON string of key-value headers
  rateLimitMs: integer("rate_limit_ms"),
  lastFetchedAt: text("last_fetched_at"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// ── Catalog Items ──
export const catalogItems = sqliteTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    series: text("series"),
    issueNumber: text("issue_number"),
    volume: text("volume"),
    publisher: text("publisher"),
    releaseDate: text("release_date"),
    addedAt: text("added_at").notNull().default("(datetime('now'))"),
    language: text("language").default("en"),
    format: text("format"), // e.g. "CBR", "CBZ", "PDF", "Digital Comic"
    fileSize: text("file_size"), // human-readable size string
    fileSizeBytes: integer("file_size_bytes"),
    tags: text("tags"), // JSON array string
    description: text("description"),
    coverUrl: text("cover_url"),
    detailUrl: text("detail_url"),
    stableHash: text("stable_hash").notNull(),
    // Denormalized download info
    downloadAvailable: integer("download_available", { mode: "boolean" }).notNull().default(false),
  },
  (table) => ({
    stableHashIdx: uniqueIndex("stable_hash_idx").on(table.stableHash),
    sourceIdx: index("catalog_source_idx").on(table.sourceId),
    publisherIdx: index("catalog_publisher_idx").on(table.publisher),
    seriesIdx: index("catalog_series_idx").on(table.series),
    releaseDateIdx: index("catalog_release_date_idx").on(table.releaseDate),
    titleIdx: index("catalog_title_idx").on(table.title),
    addedAtIdx: index("catalog_added_at_idx").on(table.addedAt),
  })
);

// ── Download Links ──
export const downloadLinks = sqliteTable("download_links", {
  id: text("id").primaryKey(),
  catalogItemId: text("catalog_item_id")
    .notNull()
    .references(() => catalogItems.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // e.g. "Mega", "MediaFire", "Direct"
  fileName: text("file_name"),
  size: text("size"),
  url: text("url").notNull(),
  linkType: text("link_type", { enum: ["direct", "redirect", "manual", "unknown"] })
    .notNull()
    .default("unknown"),
  directDownloadCapable: integer("direct_download_capable", { mode: "boolean" }).default(false),
  manualActionRequired: integer("manual_action_required", { mode: "boolean" }).default(true),
});

// ── Saved Searches ──
export const savedSearches = sqliteTable("saved_searches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  query: text("query"), // search text
  filters: text("filters"), // JSON of filter state
  sortBy: text("sort_by"),
  sortOrder: text("sort_order", { enum: ["asc", "desc"] }).default("desc"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ── Downloads ──
export const downloads = sqliteTable("downloads", {
  id: text("id").primaryKey(),
  catalogItemId: text("catalog_item_id").references(() => catalogItems.id, {
    onDelete: "set null",
  }),
  downloadLinkId: text("download_link_id").references(() => downloadLinks.id, {
    onDelete: "set null",
  }),
  url: text("url").notNull(),
  fileName: text("file_name"),
  destinationPath: text("destination_path"),
  status: text("status", {
    enum: ["pending", "running", "paused", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  progress: real("progress").notNull().default(0), // 0-100
  speed: real("speed"), // bytes per second
  eta: real("eta"), // seconds
  totalBytes: integer("total_bytes"),
  downloadedBytes: integer("downloaded_bytes").default(0),
  errorLog: text("error_log"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  completedAt: text("completed_at"),
});

// ── Library Sources (scanned folders) ──
export const librarySources = sqliteTable("library_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  scanRecursive: integer("scan_recursive", { mode: "boolean" }).notNull().default(true),
  lastScannedAt: text("last_scanned_at"),
  itemCount: integer("item_count").notNull().default(0),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// ── Library Items (individual comic files) ──
export const libraryItems = sqliteTable(
  "library_items",
  {
    id: text("id").primaryKey(),
    librarySourceId: text("library_source_id")
      .notNull()
      .references(() => librarySources.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    filePath: text("file_path").notNull().unique(),
    format: text("format").notNull(), // "CBR", "CBZ", "PDF"
    fileSizeBytes: integer("file_size_bytes"),
    pageCount: integer("page_count"),
    coverCached: integer("cover_cached", { mode: "boolean" }).notNull().default(false),
    addedAt: text("added_at").notNull().default("(datetime('now'))"),
  },
  (table) => ({
    libSourceIdx: index("lib_items_source_idx").on(table.librarySourceId),
    filePathUniq: uniqueIndex("lib_file_path_idx").on(table.filePath),
  })
);

// ── Reading Progress ──
export const readingProgress = sqliteTable(
  "reading_progress",
  {
    id: text("id").primaryKey(),
    libraryItemId: text("library_item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" })
      .unique(),
    currentPage: integer("current_page").notNull().default(1),
    totalPages: integer("total_pages"),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    lastReadAt: text("last_read_at").notNull().default("(datetime('now'))"),
  },
  (table) => ({
    libItemIdx: index("reading_progress_item_idx").on(table.libraryItemId),
  })
);

// ── Settings ──
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
