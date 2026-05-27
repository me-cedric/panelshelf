import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/index";
import { librarySources, libraryItems, readingProgress, settings } from "../db/schema";
import { scanLibrarySource, scanAllSources, extractCoverPage, extractPages } from "../services/library-scanner";

const CACHE_DIR = "library-cache";
export const LAST_SCAN_ALL_KEY = "library_last_scan_all_at";

function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  const db = getDb();
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();
  if (existing) {
    if (value === null) {
      db.delete(settings).where(eq(settings.key, key)).run();
    } else {
      db.update(settings).set({ value }).where(eq(settings.key, key)).run();
    }
  } else if (value !== null) {
    db.insert(settings).values({ key, value }).run();
  }
}

export function libraryRoutes(app: FastifyInstance) {
  // ── Library Sources ──

  // List all library sources
  app.get("/api/library/sources", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "List library sources",
      description: "Returns all local library folder sources, ordered by name.",
      response: {
        200: {
          type: "object",
          properties: {
            sources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  path: { type: "string" },
                  enabled: { type: "boolean" },
                  scanRecursive: { type: "boolean" },
                  lastScannedAt: { type: "string" },
                  itemCount: { type: "integer" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const db = getDb();
    const sources = db.select().from(librarySources).orderBy(librarySources.name).all();
    return { sources };
  });

  // Create a library source
  app.post("/api/library/sources", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "Create a library source",
      description: "Adds a local folder path as a library source. The path must exist on disk.",
      body: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", minLength: 1, description: "Absolute filesystem path to the folder" },
          name: { type: "string", description: "Display name (defaults to folder basename)" },
          enabled: { type: "boolean", default: true },
          scanRecursive: { type: "boolean", default: true, description: "Whether to scan subdirectories" },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          properties: {
            source: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                path: { type: "string" },
                enabled: { type: "boolean" },
                scanRecursive: { type: "boolean" },
                lastScannedAt: { type: "string" },
                itemCount: { type: "integer" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    if (!body.path) return reply.status(400).send({ error: "Path is required" });
    if (!fs.existsSync(body.path)) return reply.status(400).send({ error: `Directory not found: ${body.path}` });

    const db = getDb();
    const id = uuid();
    const name = body.name || path.basename(body.path);

    db.insert(librarySources)
      .values({
        id,
        name,
        path: body.path,
        enabled: body.enabled ?? true,
        scanRecursive: body.scanRecursive ?? true,
      })
      .run();

    const source = db.select().from(librarySources).where(eq(librarySources.id, id)).get();
    return { source };
  });

  // Update a library source
  app.put("/api/library/sources/:id", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "Update a library source",
      description: "Updates a library source's properties (name, path, enabled, scanRecursive).",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library source ID" },
        },
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          path: { type: "string", minLength: 1, description: "Absolute filesystem path" },
          enabled: { type: "boolean" },
          scanRecursive: { type: "boolean" },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          properties: {
            source: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                path: { type: "string" },
                enabled: { type: "boolean" },
                scanRecursive: { type: "boolean" },
                lastScannedAt: { type: "string" },
                itemCount: { type: "integer" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const db = getDb();

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;
    if (body.scanRecursive !== undefined) updateData.scanRecursive = body.scanRecursive;
    if (body.path !== undefined) {
      if (!fs.existsSync(body.path)) return reply.status(400).send({ error: `Directory not found: ${body.path}` });
      updateData.path = body.path;
    }
    updateData.updatedAt = sql`(datetime('now'))`;

    db.update(librarySources)
      .set(updateData)
      .where(eq(librarySources.id, id))
      .run();

    const source = db.select().from(librarySources).where(eq(librarySources.id, id)).get();
    if (!source) return reply.status(404).send({ error: "Library source not found" });
    return { source };
  });

  // Delete a library source (cascades to items and progress)
  app.delete("/api/library/sources/:id", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "Delete a library source",
      description: "Removes a library source and all associated items and reading progress (cascading delete).",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library source ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    // Clean up cached cover images
    const items = db.select().from(libraryItems).where(eq(libraryItems.librarySourceId, id)).all();
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    for (const item of items) {
      const coverPath = path.join(dataDir, CACHE_DIR, `${item.id}.jpg`);
      if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
    }

    db.delete(librarySources).where(eq(librarySources.id, id)).run();
    return { success: true };
  });

  // Scan a library source for comic files
  app.post("/api/library/sources/:id/scan", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "Scan a library source",
      description: "Scans a library source directory for comic files (CBZ, CBR, PDF, etc.) and imports new items. Returns counts of added, skipped, and errored files.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library source ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            added: { type: "integer" },
            skipped: { type: "integer" },
            total: { type: "integer" },
            errors: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await scanLibrarySource(id);
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Clear all library items and reading progress, then reset source counts
  app.post("/api/library/clear", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "Clear all library items",
      description: "Deletes all library items, reading progress, and cached cover/page images. Resets source item counts to 0. Does not delete library sources themselves.",
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            deletedItems: { type: "integer" },
          },
        },
      },
    },
  }, async () => {
    const db = getDb();
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    const cacheDir = path.join(dataDir, CACHE_DIR);

    // Get all items to clean up cached covers
    const items = db.select({ id: libraryItems.id }).from(libraryItems).all();

    // Delete cached cover images and page cache directory
    for (const item of items) {
      const coverPath = path.join(cacheDir, `${item.id}.jpg`);
      if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
    }
    const pagesDir = path.join(cacheDir, "pages");
    if (fs.existsSync(pagesDir)) {
      fs.rmSync(pagesDir, { recursive: true, force: true });
    }

    // Delete all library items (cascades to reading_progress)
    const deleteResult = db.delete(libraryItems).run();
    const deletedCount = deleteResult.changes || items.length;

    // Reset all source item counts and scan timestamps
    db.update(librarySources)
      .set({
        itemCount: 0,
        lastScannedAt: null,
        updatedAt: sql`(datetime('now'))`,
      })
      .run();

    // Reset the scan-all timestamp
    setSetting(LAST_SCAN_ALL_KEY, null);

    return { success: true, deletedItems: deletedCount };
  });

  // Clear items for a single library source
  app.post("/api/library/clear/:sourceId", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "Clear items for a library source",
      description: "Deletes all items and reading progress for a single library source. Resets its item count to 0 and clears cached cover/page images. Does not delete the source itself.",
      params: {
        type: "object",
        required: ["sourceId"],
        properties: {
          sourceId: { type: "string", format: "uuid", description: "Library source ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            deletedItems: { type: "integer" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };
    const db = getDb();

    // Verify source exists
    const source = db.select().from(librarySources).where(eq(librarySources.id, sourceId)).get();
    if (!source) return reply.status(404).send({ error: "Library source not found" });

    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    const cacheDir = path.join(dataDir, CACHE_DIR);

    // Get items for this source to clean up cached covers
    const items = db.select({ id: libraryItems.id }).from(libraryItems).where(eq(libraryItems.librarySourceId, sourceId)).all();

    // Delete cached cover images
    for (const item of items) {
      const coverPath = path.join(cacheDir, `${item.id}.jpg`);
      if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
    }

    // Delete all items for this source (cascades to reading_progress)
    const deleteResult = db.delete(libraryItems).where(eq(libraryItems.librarySourceId, sourceId)).run();
    const deletedCount = deleteResult.changes || items.length;

    // Reset the source's item count and scan timestamp
    db.update(librarySources)
      .set({
        itemCount: 0,
        lastScannedAt: null,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(librarySources.id, sourceId))
      .run();

    return { success: true, deletedItems: deletedCount };
  });

  // Touch the scan-all timestamp (lightweight — called by frontend after per-source scan loop)
  app.post("/api/library/touch-scan-all", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "Update scan-all timestamp",
      description: "Updates the lastScanAllAt timestamp without re-scanning. Called by the frontend after its per-source scan loop completes.",
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
  }, async () => {
    setSetting(LAST_SCAN_ALL_KEY, new Date().toISOString());
    return { success: true };
  });

  // Scan all library sources
  app.post("/api/library/scan-all", {
    schema: {
      tags: ["Library", "Sources"],
      summary: "Scan all library sources",
      description: "Scans every enabled library source for new comic files in sequence.",
      response: {
        200: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sourceId: { type: "string" },
                  name: { type: "string" },
                  added: { type: "integer" },
                  skipped: { type: "integer" },
                  errors: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const result = await scanAllSources();
    // Persist the scan-all timestamp independently of individual source timestamps
    setSetting(LAST_SCAN_ALL_KEY, new Date().toISOString());
    return result;
  });

  // ── Library Items ──

  // List library items with optional filters
  app.get("/api/library/items", {
    schema: {
      tags: ["Library", "Items"],
      summary: "List library items",
      description: "Returns library comic items with optional filtering by source, search query, and format. Includes reading progress via a left join. Supports sorting and pagination.",
      querystring: {
        type: "object",
        properties: {
          sourceId: { type: "string", format: "uuid", description: "Filter by library source ID" },
          search: { type: "string", description: "Full-text search on title" },
          format: { type: "string", description: "Filter by file format (CBZ, CBR, PDF)" },
          limit: { type: "string", pattern: "^\\d+$", default: "50", description: "Items per page" },
          offset: { type: "string", pattern: "^\\d+$", default: "0", description: "Page offset" },
          sortBy: { type: "string", enum: ["title", "addedAt", "fileSizeBytes", "format", "pageCount"], default: "title" },
          sortOrder: { type: "string", enum: ["asc", "desc"], default: "asc" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            items: { type: "array" },
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
        },
      },
    },
  }, async (req) => {
    const query = req.query as {
      sourceId?: string;
      search?: string;
      format?: string;
      limit?: string;
      offset?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    };
    const db = getDb();

    const conditions: any[] = [];
    if (query.sourceId) conditions.push(eq(libraryItems.librarySourceId, query.sourceId));
    if (query.format) conditions.push(eq(libraryItems.format, query.format));
    if (query.search) {
      conditions.push(sql`${libraryItems.title} LIKE ${"%"+query.search+"%"}`);
    }

    const whereClause = conditions.length > 0
      ? (conditions.length === 1 ? conditions[0] : conditions.reduce((a, b) => sql`${a} AND ${b}`))
      : undefined;

    // Build sort order
    const sortBy = query.sortBy || "title";
    const sortOrder = query.sortOrder || "asc";
    const sortColumn =
      sortBy === "addedAt"
        ? libraryItems.addedAt
        : sortBy === "fileSizeBytes"
          ? libraryItems.fileSizeBytes
          : sortBy === "format"
            ? libraryItems.format
            : sortBy === "pageCount"
              ? libraryItems.pageCount
              : libraryItems.title;
    const orderFn = sortOrder === "desc" ? sql`${sortColumn} DESC` : sql`${sortColumn} ASC`;

    // Include reading progress via a subquery or join
    const items = db
      .select({
        id: libraryItems.id,
        librarySourceId: libraryItems.librarySourceId,
        title: libraryItems.title,
        fileName: libraryItems.fileName,
        filePath: libraryItems.filePath,
        format: libraryItems.format,
        fileSizeBytes: libraryItems.fileSizeBytes,
        pageCount: libraryItems.pageCount,
        coverCached: libraryItems.coverCached,
        addedAt: libraryItems.addedAt,
        currentPage: readingProgress.currentPage,
        totalPages: readingProgress.totalPages,
        completed: readingProgress.completed,
        lastReadAt: readingProgress.lastReadAt,
      })
      .from(libraryItems)
      .leftJoin(readingProgress, eq(libraryItems.id, readingProgress.libraryItemId))
      .where(whereClause)
      .orderBy(orderFn)
      .limit(parseInt(query.limit || "50", 10))
      .offset(parseInt(query.offset || "0", 10))
      .all();

    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(libraryItems)
      .where(whereClause)
      .get();

    return {
      items,
      total: countResult?.count || 0,
      limit: parseInt(query.limit || "50", 10),
      offset: parseInt(query.offset || "0", 10),
    };
  });

  // Get single library item with reading progress
  app.get("/api/library/items/:id", {
    schema: {
      tags: ["Library", "Items"],
      summary: "Get library item",
      description: "Returns a single library item by ID, including its reading progress if available.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library item ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            item: {
              type: "object",
              properties: {
                id: { type: "string" },
                librarySourceId: { type: "string" },
                title: { type: "string" },
                fileName: { type: "string" },
                filePath: { type: "string" },
                format: { type: "string" },
                fileSizeBytes: { type: "integer" },
                pageCount: { type: "integer" },
                coverCached: { type: "boolean" },
                addedAt: { type: "string" },
              },
            },
            progress: {
              type: "object",
              properties: {
                id: { type: "string" },
                libraryItemId: { type: "string" },
                currentPage: { type: "integer" },
                totalPages: { type: "integer" },
                completed: { type: "boolean" },
                lastReadAt: { type: "string" },
              },
            },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    const item = db
      .select({
        id: libraryItems.id,
        librarySourceId: libraryItems.librarySourceId,
        title: libraryItems.title,
        fileName: libraryItems.fileName,
        filePath: libraryItems.filePath,
        format: libraryItems.format,
        fileSizeBytes: libraryItems.fileSizeBytes,
        pageCount: libraryItems.pageCount,
        coverCached: libraryItems.coverCached,
        addedAt: libraryItems.addedAt,
      })
      .from(libraryItems)
      .where(eq(libraryItems.id, id))
      .get();

    if (!item) return reply.status(404).send({ error: "Item not found" });

    const progress = db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.libraryItemId, id))
      .get();

    return { item, progress };
  });

  // Delete a library item
  app.delete("/api/library/items/:id", {
    schema: {
      tags: ["Library", "Items"],
      summary: "Delete a library item",
      description: "Permanently removes a library item and its cached cover image.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library item ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    // Clean up cached cover
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    const coverPath = path.join(dataDir, CACHE_DIR, `${id}.jpg`);
    if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);

    db.delete(libraryItems).where(eq(libraryItems.id, id)).run();
    return { success: true };
  });

  // ── Library Stats ──

  // Get aggregate library statistics
  app.get("/api/library/stats", {
    schema: {
      tags: ["Library", "Stats"],
      summary: "Get library stats",
      description: "Returns aggregate library statistics: total items, sources, completed/in-progress/unread counts.",
      response: {
        200: {
          type: "object",
          properties: {
            totalSources: { type: "integer" },
            totalItems: { type: "integer" },
            completedCount: { type: "integer" },
            inProgressCount: { type: "integer" },
            unreadCount: { type: "integer" },
            lastScanAllAt: { type: "string" },
          },
        },
      },
    },
  }, async () => {
    const db = getDb();

    const totalItems = db
      .select({ count: sql<number>`count(*)` })
      .from(libraryItems)
      .get();

    const totalSources = db
      .select({ count: sql<number>`count(*)` })
      .from(librarySources)
      .get();

    const progressRows = db
      .select({
        completed: readingProgress.completed,
        count: sql<number>`count(*)`,
      })
      .from(readingProgress)
      .groupBy(readingProgress.completed)
      .all();

    let completedCount = 0;
    let inProgressCount = 0;
    for (const row of progressRows) {
      if (row.completed) {
        completedCount = row.count;
      } else {
        inProgressCount = row.count;
      }
    }

    const unreadCount = (totalItems?.count || 0) - completedCount - inProgressCount;
    const lastScanAllAt = getSetting(LAST_SCAN_ALL_KEY);

    return {
      totalSources: totalSources?.count || 0,
      totalItems: totalItems?.count || 0,
      completedCount,
      inProgressCount,
      unreadCount: Math.max(0, unreadCount),
      lastScanAllAt,
    };
  });

  // ── Comic Reading ──

  // Serve a cover image for a library item
  app.get("/api/library/items/:id/cover", {
    schema: {
      tags: ["Library", "Items"],
      summary: "Get item cover image",
      description: "Serves a cached JPEG cover image for a library item. Extracts and caches the first page on first request.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library item ID" },
        },
      },
      response: {
        200: {
          type: "string",
          format: "binary",
          description: "JPEG image data",
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    const item = db.select().from(libraryItems).where(eq(libraryItems.id, id)).get();
    if (!item) return reply.status(404).send({ error: "Item not found" });

    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    const coverDir = path.join(dataDir, CACHE_DIR);
    fs.mkdirSync(coverDir, { recursive: true });
    const coverPath = path.join(coverDir, `${id}.jpg`);

    // Return cached cover if available
    if (fs.existsSync(coverPath)) {
      reply.header("Content-Type", "image/jpeg");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(fs.readFileSync(coverPath));
    }

    // Extract and cache the first page
    try {
      const buffer = await extractCoverPage(item.filePath, item.format);
      if (!buffer) return reply.status(404).send({ error: "No cover available" });

      fs.writeFileSync(coverPath, buffer);

      // Mark cover as cached
      db.update(libraryItems)
        .set({ coverCached: true })
        .where(eq(libraryItems.id, id))
        .run();

      reply.header("Content-Type", "image/jpeg");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(buffer);
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to extract cover: ${err.message}` });
    }
  });

  // Serve a specific page from a library item
  app.get("/api/library/items/:id/page/:page", {
    schema: {
      tags: ["Library", "Items"],
      summary: "Get a page image",
      description: "Serves a specific page image (JPEG) from a library comic item. Pages are extracted and cached on first access.",
      params: {
        type: "object",
        required: ["id", "page"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library item ID" },
          page: { type: "string", pattern: "^\\d+$", description: "Page number (1-indexed)" },
        },
      },
      response: {
        200: {
          type: "string",
          format: "binary",
          description: "JPEG page image data",
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id, page: pageStr } = req.params as { id: string; page: string };
    const pageNum = parseInt(pageStr, 10);
    if (isNaN(pageNum) || pageNum < 1) return reply.status(400).send({ error: "Invalid page number" });

    const db = getDb();
    const item = db.select().from(libraryItems).where(eq(libraryItems.id, id)).get();
    if (!item) return reply.status(404).send({ error: "Item not found" });

    // Check for cached page
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    const pageCacheDir = path.join(dataDir, CACHE_DIR, "pages");
    fs.mkdirSync(pageCacheDir, { recursive: true });
    const pagePath = path.join(pageCacheDir, `${id}_${pageNum}.jpg`);

    if (fs.existsSync(pagePath)) {
      reply.header("Content-Type", "image/jpeg");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(fs.readFileSync(pagePath));
    }

    // Extract the page
    try {
      const buffers = await extractPages(item.filePath, item.format, pageNum, 1);
      if (buffers.length === 0) return reply.status(404).send({ error: "Page not found" });

      fs.writeFileSync(pagePath, buffers[0]);

      reply.header("Content-Type", "image/jpeg");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(buffers[0]);
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to extract page: ${err.message}` });
    }
  });

  // ── Reading Progress ──

  // Get reading progress for an item
  app.get("/api/library/items/:id/progress", {
    schema: {
      tags: ["Library", "Progress"],
      summary: "Get reading progress",
      description: "Returns reading progress for a library item. Auto-creates a progress entry with default values if none exists.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library item ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            progress: {
              type: "object",
              properties: {
                id: { type: "string" },
                libraryItemId: { type: "string" },
                currentPage: { type: "integer" },
                totalPages: { type: "integer" },
                completed: { type: "boolean" },
                lastReadAt: { type: "string" },
              },
            },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    let progress = db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.libraryItemId, id))
      .get();

    if (!progress) {
      // Auto-create progress entry
      const item = db.select().from(libraryItems).where(eq(libraryItems.id, id)).get();
      if (!item) return reply.status(404).send({ error: "Item not found" });

      const progressId = uuid();
      db.insert(readingProgress)
        .values({
          id: progressId,
          libraryItemId: id,
          currentPage: 1,
          totalPages: item.pageCount,
        })
        .run();

      progress = db.select().from(readingProgress).where(eq(readingProgress.libraryItemId, id)).get();
    }

    return { progress };
  });

  // Update reading progress for an item
  app.put("/api/library/items/:id/progress", {
    schema: {
      tags: ["Library", "Progress"],
      summary: "Update reading progress",
      description: "Updates or creates reading progress for a library item. Supports setting current page and/or marking as completed.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Library item ID" },
        },
      },
      body: {
        type: "object",
        properties: {
          currentPage: { type: "integer", minimum: 1, description: "Current page number" },
          completed: { type: "boolean", description: "Mark as completed" },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          properties: {
            progress: {
              type: "object",
              properties: {
                id: { type: "string" },
                libraryItemId: { type: "string" },
                currentPage: { type: "integer" },
                totalPages: { type: "integer" },
                completed: { type: "boolean" },
                lastReadAt: { type: "string" },
              },
            },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { currentPage?: number; completed?: boolean };
    const db = getDb();

    const item = db.select().from(libraryItems).where(eq(libraryItems.id, id)).get();
    if (!item) return reply.status(404).send({ error: "Item not found" });

    // Upsert reading progress
    const existing = db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.libraryItemId, id))
      .get();

    const updateData: Record<string, any> = {
      lastReadAt: sql`(datetime('now'))`,
    };
    if (body.currentPage !== undefined) {
      updateData.currentPage = Math.max(1, body.currentPage);
      if (item.pageCount && body.currentPage >= item.pageCount) {
        updateData.completed = true;
      }
    }
    if (body.completed !== undefined) updateData.completed = body.completed;

    if (existing) {
      db.update(readingProgress)
        .set(updateData)
        .where(eq(readingProgress.libraryItemId, id))
        .run();
    } else {
      const progressId = uuid();
      db.insert(readingProgress)
        .values({
          id: progressId,
          libraryItemId: id,
          currentPage: body.currentPage || 1,
          totalPages: item.pageCount,
          completed: body.completed || false,
        })
        .run();
    }

    const progress = db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.libraryItemId, id))
      .get();

    return { progress };
  });
}
