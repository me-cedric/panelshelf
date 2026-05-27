import type { FastifyInstance } from "fastify";
import { getCatalogItems, getCatalogItemWithLinks, getDistinctValues, normalizeSearchTerm } from "../services/catalog";
import { eq } from "drizzle-orm";
import * as cheerio from "cheerio";
import { getDb } from "../db/index";
import { catalogItems } from "../db/schema";
import { v4 as uuid } from "uuid";
import { savedSearches, downloads, sources } from "../db/schema";
import { sql } from "drizzle-orm";
import { request } from "undici";
import Parser from "rss-parser";
import { extractImage } from "../providers/rss/index";
import { findProviderForUrl } from "../providers/registry";
import { scrapeDcmCategories, searchDcm } from "../providers/digitalcomicmuseum/index";
import type { ProviderAdapter } from "../providers/types";

const liveSearchParser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
});

// ── Feed URL cache ──
// Caches the resolved RSS/Atom feed URL per source so resolveFeedUrl
// doesn't re-fetch the HTML page on every live search.
const FEED_URL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface FeedUrlCacheEntry {
  url: string | null;
  cachedAt: number;
}

const feedUrlCache = new Map<string, FeedUrlCacheEntry>();

/**
 * Get the resolved feed URL for a source, using cache if available.
 * Returns null if the source's feed URL couldn't be resolved.
 */
async function getCachedFeedUrl(
  sourceId: string,
  baseUrl: string
): Promise<string | null> {
  const cached = feedUrlCache.get(sourceId);
  if (cached && Date.now() - cached.cachedAt < FEED_URL_CACHE_TTL_MS) {
    return cached.url;
  }

  const url = await resolveFeedUrl(baseUrl);
  feedUrlCache.set(sourceId, { url, cachedAt: Date.now() });
  return url;
}

/** Clear the cached feed URL for a source (e.g., after source update). */
export function clearFeedUrlCache(sourceId: string): void {
  feedUrlCache.delete(sourceId);
}

/** Clear ALL in-memory caches (feed URLs, search results, total pages). */
export function clearAllCaches(): void {
  feedUrlCache.clear();
  searchResultsCache.clear();
  totalPagesCache.clear();
}

/** Clear cache entries for a specific source (by sourceId prefix). */
export function clearProviderCache(sourceId: string): void {
  feedUrlCache.delete(sourceId);

  // Clear search results cache entries matching this sourceId
  for (const key of searchResultsCache.keys()) {
    if (key.startsWith(sourceId + ":")) {
      searchResultsCache.delete(key);
    }
  }

  // Clear total pages cache entries matching this sourceId's baseUrl
  // totalPagesCache keys are `${baseUrl}:${query}`, not sourceId-based
  // so we skip it here — will naturally expire.
}

// ── Search results cache ──
// Caches scraped search results per page so repeat queries are instant.
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface LiveSearchCacheEntry {
  items: LiveSearchItem[];
  cachedAt: number;
}

interface TotalPagesCacheEntry {
  totalPages: number;
  cachedAt: number;
}

const searchResultsCache = new Map<string, LiveSearchCacheEntry>();
const totalPagesCache = new Map<string, TotalPagesCacheEntry>();

type LiveSearchItem = {
  id: string;
  title: string;
  description: string;
  detailUrl: string;
  coverUrl?: string;
  releaseDate: string | null;
  source: string;
  sourceId: string;
  live: true;
};

export function catalogRoutes(app: FastifyInstance) {
  // List/search catalog items
  app.get("/api/catalog", {
    schema: {
      tags: ["Catalog"],
      summary: "List/search catalog items",
      description: "Search and filter the catalog of comic items with pagination, sorting, and multiple filter dimensions (publisher, series, language, format, source, date range, etc.).",
      querystring: {
        type: "object",
        properties: {
          search: { type: "string", description: "Full-text search query" },
          publisher: { type: "string", description: "Filter by publisher" },
          series: { type: "string", description: "Filter by series" },
          language: { type: "string", description: "Filter by language code" },
          format: { type: "string", description: "Filter by file format" },
          sourceId: { type: "string", format: "uuid", description: "Filter by source ID" },
          downloadAvailable: { type: "string", enum: ["true", "false"], description: "Filter by download availability" },
          tags: { type: "string", description: "Filter by tags (comma-separated)" },
          dateFrom: { type: "string", description: "Release date lower bound (ISO" },
          dateTo: { type: "string", description: "Release date upper bound (ISO" },
          addedFrom: { type: "string", description: "Added date lower bound (ISO" },
          addedTo: { type: "string", description: "Added date upper bound (ISO" },
          sortBy: { type: "string", enum: ["releaseDate", "title", "addedAt", "publisher"], default: "releaseDate" },
          sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
          limit: { type: "string", pattern: "^\\d+$", default: "50", description: "Items per page" },
          offset: { type: "string", pattern: "^\\d+$", default: "0", description: "Page offset" },
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
      search?: string;
      publisher?: string;
      series?: string;
      language?: string;
      format?: string;
      sourceId?: string;
      downloadAvailable?: string;
      tags?: string;
      dateFrom?: string;
      dateTo?: string;
      addedFrom?: string;
      addedTo?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      limit?: string;
      offset?: string;
    };

    return getCatalogItems({
      search: query.search,
      publisher: query.publisher,
      series: query.series,
      language: query.language,
      format: query.format,
      sourceId: query.sourceId,
      downloadAvailable: query.downloadAvailable === "true" ? true : query.downloadAvailable === "false" ? false : undefined,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      addedFrom: query.addedFrom,
      addedTo: query.addedTo,
      sortBy: query.sortBy || "releaseDate",
      sortOrder: query.sortOrder || "desc",
      limit: parseInt(query.limit || "50", 10),
      offset: parseInt(query.offset || "0", 10),
    });
  });

  // Get single catalog item with download links
  app.get("/api/catalog/:id", {
    schema: {
      tags: ["Catalog"],
      summary: "Get catalog item details",
      description: "Returns a single catalog item with all associated download links by its ID.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Catalog item ID" },
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
                sourceId: { type: "string" },
                title: { type: "string" },
                series: { type: "string" },
                issueNumber: { type: "string" },
                volume: { type: "string" },
                publisher: { type: "string" },
                releaseDate: { type: "string" },
                addedAt: { type: "string" },
                language: { type: "string" },
                format: { type: "string" },
                fileSize: { type: "string" },
                fileSizeBytes: { type: "integer" },
                tags: { type: "string" },
                description: { type: "string" },
                coverUrl: { type: "string" },
                detailUrl: { type: "string" },
                stableHash: { type: "string" },
                downloadAvailable: { type: "boolean" },
              },
            },
            links: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  catalogItemId: { type: "string" },
                  provider: { type: "string" },
                  fileName: { type: "string" },
                  size: { type: "string" },
                  url: { type: "string" },
                  linkType: { type: "string" },
                  directDownloadCapable: { type: "boolean" },
                  manualActionRequired: { type: "boolean" },
                },
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
    const result = await getCatalogItemWithLinks(id);
    if (!result) return reply.status(404).send({ error: "Item not found" });
    return result;
  });

  // Get distinct filter values
  app.get("/api/catalog/filters/:column", {
    schema: {
      tags: ["Catalog"],
      summary: "Get distinct filter values",
      description: "Returns all distinct values for a given catalog column (publisher, series, format, or language) for building filter dropdowns.",
      params: {
        type: "object",
        required: ["column"],
        properties: {
          column: { type: "string", enum: ["publisher", "series", "format", "language"] },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            column: { type: "string" },
            values: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
  }, async (req) => {
    const { column } = req.params as { column: "publisher" | "series" | "format" | "language" };
    const values = await getDistinctValues(column);
    return { column, values };
  });

  // Saved searches
  app.get("/api/saved-searches", {
    schema: {
      tags: ["Saved Searches"],
      summary: "List saved searches",
      description: "Returns all saved search queries, ordered by creation date.",
      response: {
        200: {
          type: "object",
          properties: {
            searches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  query: { type: "string" },
                  filters: { type: "string" },
                  sortBy: { type: "string" },
                  sortOrder: { type: "string" },
                  createdAt: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const db = getDb();
    const searches = db.select().from(savedSearches).orderBy(savedSearches.createdAt).all();
    return { searches };
  });

  app.post("/api/saved-searches", {
    schema: {
      tags: ["Saved Searches"],
      summary: "Save a search query",
      description: "Saves a search query with optional filters, sort settings, and a display name for later reuse.",
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, description: "Display name for the saved search" },
          query: { type: "string", description: "Search text" },
          filters: { type: "object", description: "Filter state as key-value pairs" },
          sortBy: { type: "string", description: "Column to sort by" },
          sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          properties: {
            search: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                query: { type: "string" },
                filters: { type: "string" },
                sortBy: { type: "string" },
                sortOrder: { type: "string" },
                createdAt: { type: "string" },
              },
            },
          },
        },
      },
    },
  }, async (req) => {
    const body = req.body as any;
    const db = getDb();
    const id = uuid();

    db.insert(savedSearches)
      .values({
        id,
        name: body.name,
        query: body.query,
        filters: body.filters ? JSON.stringify(body.filters) : null,
        sortBy: body.sortBy,
        sortOrder: body.sortOrder || "desc",
      })
      .run();

    const search = db.select().from(savedSearches).where(eq(savedSearches.id, id)).get();
    return { search };
  });

  app.delete("/api/saved-searches/:id", {
    schema: {
      tags: ["Saved Searches"],
      summary: "Delete a saved search",
      description: "Permanently removes a saved search query by its ID.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Saved search ID" },
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
  }, async (req) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    db.delete(savedSearches).where(eq(savedSearches.id, id)).run();
    return { success: true };
  });

  // Live search: proxy search to the source's feed URL in real-time
  // Supports pagination via `page` parameter for progressive loading.
  // When `fresh=true`, bypasses all caches and fetches directly from source.
  // Response includes `cached` to indicate if data came from cache.
  app.get("/api/catalog/live-search", {
    schema: {
      tags: ["Live Search"],
      summary: "Live search source feed",
      description: "Proxies a search query to the source's live feed or scraper in real-time. Supports pagination via `page` parameter. Use `fresh=true` to bypass caches. Returns `cached` flag to indicate cache source.",
      querystring: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search query" },
          sourceId: { type: "string", format: "uuid", description: "Source ID to search within" },
          cid: { type: "string", description: "Category ID for provider-specific category browsing (e.g., DCM publisher cid)" },
          page: { type: "string", pattern: "^\\d+$", default: "1", description: "Page number for pagination" },
          fresh: { type: "string", enum: ["true", "false"], description: "Set to 'true' to bypass caches" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            items: { type: "array" },
            page: { type: "integer" },
            totalPages: { type: "integer" },
            hasMore: { type: "boolean" },
            cached: { type: "boolean" },
          },
        },
      },
    },
  }, async (req, reply) => {
    console.log('[LIVE-SEARCH HANDLER] ENTERED with query:', JSON.stringify(req.query));
    const { q, sourceId, cid, page: pageStr, fresh } = req.query as {
      q?: string;
      sourceId?: string;
      cid?: string;
      page?: string;
      fresh?: string;
    };
    const isFresh = fresh === "true";

    if (!sourceId) {
      return { items: [], page: 0, totalPages: 0, hasMore: false };
    }

    const db = getDb();
    const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();
    if (!source || !source.enabled) {
      return { items: [], page: 0, totalPages: 0, hasMore: false };
    }

    // For RSS feeds, use the specialized feed+WordPress pipeline
    // For other source types, fall back to provider-based scraping

    const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);

    if (source.type === "rss") {
      return handleRssLiveSearch(sourceId, source, q, page, isFresh);
    }

    // For non-RSS sources, use the provider's inspect method for browsing
    // This scrapes the source's base URL (typically a listing page)
    const provider = findProviderForUrl(source.baseUrl);
    if (!provider) {
      return { items: [], page: 0, totalPages: 0, hasMore: false, cached: false };
    }

    return handleProviderLiveSearch(sourceId, source.baseUrl, provider, page, isFresh, cid, q);
  });

  // List categories for a provider source (e.g., DCM publisher categories)
  app.get("/api/catalog/live-search/categories", {
    schema: {
      tags: ["Live Search"],
      summary: "List provider categories",
      description: "Returns a list of browseable categories for a given source's provider. Currently supports DCM publisher categories (cid links) scraped from the homepage.",
      querystring: {
        type: "object",
        required: ["sourceId"],
        properties: {
          sourceId: { type: "string", format: "uuid", description: "Source ID to fetch categories for" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                },
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
    const { sourceId } = req.query as { sourceId?: string };
    if (!sourceId) {
      return reply.status(400).send({ error: "Missing sourceId parameter" });
    }

    const db = getDb();
    const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();
    if (!source || !source.enabled) {
      return reply.status(404).send({ error: "Source not found or disabled" });
    }

    const provider = findProviderForUrl(source.baseUrl);
    if (!provider) {
      return reply.status(404).send({ error: "No provider found for source URL" });
    }

    // Currently only DCM provides category browsing
    if (provider.id === "digitalcomicmuseum") {
      const categories = await scrapeDcmCategories();
      return { categories };
    }

    return { categories: [] };
  });

  // Live detail: scrape download links from a detail page URL
  app.get("/api/catalog/live-detail", {
    schema: {
      tags: ["Live Search"],
      summary: "Scrape detail page",
      description: "Fetches and scrapes a detail page URL in real-time, extracting title, cover image, description, and download links from the HTML.",
      querystring: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 1, format: "uri", description: "Detail page URL to scrape" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            title: { type: "string" },
            coverUrl: { type: "string" },
            description: { type: "string" },
            downloadLinks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  provider: { type: "string" },
                  url: { type: "string" },
                  className: { type: "string" },
                },
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
        502: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { url } = req.query as { url?: string };
    if (!url) {
      return reply.status(400).send({ error: "Missing url parameter" });
    }

    // Try provider-based scraping first (handles DCM, ZipComic, etc.)
    const provider = findProviderForUrl(url);
    if (provider) {
      try {
        const result = await provider.inspect(url);
        if (result.error) {
          // Provider returned an explicit error (e.g., Cloudflare block) —
          // return it to the frontend so the user can see what's wrong
          return reply.status(502).send({ error: result.error });
        }
        if (result.items.length > 0) {
          const item = result.items[0];
          // Map provider download links to live-detail format
          const downloadLinks = (item.downloadLinks || []).map((link) => ({
            provider: link.provider || "Unknown",
            url: link.url,
            className: link.linkType || "",
          }));
          return {
            title: item.title || "",
            coverUrl: item.coverUrl,
            description: item.description || "",
            downloadLinks,
          };
        }
        // Provider returned 0 items with no error —
        // no need to fall through to WordPress scraper; return empty result
        return {
          title: "",
          downloadLinks: [],
        };
      } catch (err: any) {
        console.error(`[live-detail] Provider error for ${url}:`, err);
        // Provider threw unexpectedly — fall through to WordPress generic scraper
      }
    }

    // Fallback: generic WordPress/HTML scraping
    try {
      const html = await fetchPageContent(url);
      const $ = cheerio.load(html);

      // Extract cover image (first significant image in post content)
      const $content = $(".entry-content, .post-content, .entry, article").first();
      let coverUrl: string | undefined;
      $content.find("img").each((_, el) => {
        const src = $(el).attr("src");
        if (src && !coverUrl) {
          // Skip small icons, avatars, etc.
          const w = parseInt($(el).attr("width") || "0", 10);
          if (w > 100) coverUrl = src;
        }
      });
      if (!coverUrl) {
        coverUrl = $(".wp-post-image, .attachment-full, .post-thumbnail img").first().attr("src");
      }

      // Extract description (first substantial paragraph)
      let description = "";
      $content.find("p").each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 50 && !text.toLowerCase().includes("download")) {
          description = text;
          return false; // break
        }
      });

      // Extract download links — look for links with class starting with "aio-"
      // or links containing provider names in text/title
      const downloadLinks: Array<{
        provider: string;
        url: string;
        className: string;
      }> = [];

      $content.find("a").each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href");
        if (!href) return;

        const cls = $el.attr("class") || "";
        const title = ($el.attr("title") || "").trim();
        const text = $el.text().trim();

        // Match: aio-* classes (download buttons) or provider name in text/title
        const isDownloadBtn =
          cls.startsWith("aio-") ||
          /^(download now|terabox|rootz|vikingfile|pixeldrain|datanodes|read online)$/i.test(text) ||
          /^(download now|terabox|rootz|vikingfile|pixeldrain|datanodes|read online)$/i.test(title);

        if (!isDownloadBtn) return;

        const providerName = title || text || "Download";

        downloadLinks.push({
          provider: providerName,
          url: href,
          className: cls,
        });
      });

      return {
        title: $("h1, .entry-title, .post-title").first().text().trim(),
        coverUrl,
        description,
        downloadLinks,
      };
    } catch (err: any) {
      console.error("[live-detail] Error scraping", url, err);
      return reply.status(502).send({ error: `Failed to fetch detail page: ${err.message}` });
    }
  });

  // Resolve a download URL through redirect chains and intermediate pages
  // Follows HTTP redirects, parses HTML meta-refresh, iframe, and JS redirect patterns
  // to find the actual downloadable file URL.
  app.get("/api/catalog/resolve-download", {
    schema: {
      tags: ["Live Search"],
      summary: "Resolve download URL",
      description: "Follows HTTP redirects and parses intermediate pages (meta-refresh, iframes, JS redirects) to resolve the actual downloadable file URL from a download link.",
      querystring: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 1, format: "uri", description: "Download URL to resolve" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            originalUrl: { type: "string" },
            resolvedUrl: { type: "string" },
            isResolved: { type: "boolean" },
            error: { type: "string" },
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
    const { url } = req.query as { url?: string };
    if (!url) {
      return reply.status(400).send({ error: "Missing url parameter" });
    }

    try {
      const resolvedUrl = await resolveDownloadUrl(url, 0);
      return {
        originalUrl: url,
        resolvedUrl,
        isResolved: resolvedUrl !== url && resolvedUrl !== "",
      };
    } catch (err: any) {
      console.error("[resolve-download] Error resolving", url, err);
      return {
        originalUrl: url,
        resolvedUrl: url,
        isResolved: false,
        error: err.message,
      };
    }
  });

  // Stats endpoint
  app.get("/api/stats", {
    schema: {
      tags: ["System"],
      summary: "Get system stats",
      description: "Returns aggregate statistics about the catalog, including total items, sources, and downloads.",
      response: {
        200: {
          type: "object",
          properties: {
            totalItems: { type: "integer" },
            totalDownloads: { type: "integer" },
            totalSources: { type: "integer" },
          },
        },
      },
    },
  }, async () => {
    const db = getDb();
    const totalItems = db.select({ count: sql<number>`count(*)` }).from(catalogItems).get();
    const totalDownloads = db.select({ count: sql<number>`count(*)` }).from(downloads).get();
    const totalSources = db.select({ count: sql<number>`count(*)` }).from(sources).get();
    return {
      totalItems: totalItems?.count || 0,
      totalDownloads: totalDownloads?.count || 0,
      totalSources: totalSources?.count || 0,
    };
  });
}

/**
 * Try to resolve an RSS/Atom feed URL from a source base URL.
 * If the URL already returns XML, it's used directly.
 * If it returns HTML, we try to detect the feed URL from <link> tags
 * or fall back to common feed paths.
 */
async function resolveFeedUrl(url: string): Promise<string | null> {
  // First, try the URL with HEAD to check content-type without downloading the body
  const checkResp = await request(url, {
    method: "HEAD",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const rawContentType = Array.isArray(checkResp.headers["content-type"])
    ? checkResp.headers["content-type"][0]
    : (checkResp.headers["content-type"] as string) || "";
  const mimeType = rawContentType.split(";")[0].trim().toLowerCase();

  // If the response is XML, return the URL directly
  if (
    mimeType === "application/rss+xml" ||
    mimeType === "application/atom+xml" ||
    mimeType === "application/xml" ||
    mimeType === "text/xml"
  ) {
    return url;
  }

  // If it's HTML, make a GET request to read the body for feed link detection
  if (mimeType === "text/html" || mimeType === "application/xhtml+xml") {
    const htmlResp = await request(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const body = await htmlResp.body.text();

    // Look for <link rel="alternate" type="application/rss+xml" href="..." />
    const rssMatch = body.match(
      /<link[^>]*rel="alternate"[^>]*type="application\/rss\+xml"[^>]*href="([^"]+)"[^>]*\/?>/i
    );
    if (rssMatch) {
      return resolveRelativeUrl(url, rssMatch[1]);
    }

    const rssMatch2 = body.match(
      /<link[^>]*type="application\/rss\+xml"[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*\/?>/i
    );
    if (rssMatch2) {
      return resolveRelativeUrl(url, rssMatch2[1]);
    }

    // Look for <link rel="alternate" type="application/atom+xml" href="..." />
    const atomMatch = body.match(
      /<link[^>]*rel="alternate"[^>]*type="application\/atom\+xml"[^>]*href="([^"]+)"[^>]*\/?>/i
    );
    if (atomMatch) {
      return resolveRelativeUrl(url, atomMatch[1]);
    }

    const atomMatch2 = body.match(
      /<link[^>]*type="application\/atom\+xml"[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*\/?>/i
    );
    if (atomMatch2) {
      return resolveRelativeUrl(url, atomMatch2[1]);
    }

    // Fall back to common feed paths
    const baseUrl = url.replace(/\/?$/, "");
    const commonPaths = ["/feed", "/feed/", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml"];
    for (const path of commonPaths) {
      try {
        const testUrl = `${baseUrl}${path}`;
        const testResp = await request(testUrl, {
          method: "HEAD",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        const testContentType = Array.isArray(testResp.headers["content-type"])
          ? testResp.headers["content-type"][0]
          : (testResp.headers["content-type"] as string) || "";
        const testMime = testContentType.split(";")[0].trim().toLowerCase();
        if (
          testMime === "application/rss+xml" ||
          testMime === "application/atom+xml" ||
          testMime === "application/xml" ||
          testMime === "text/xml"
        ) {
          return testUrl;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  return null;
}

/** Resolve a possibly-relative URL against a base URL */
function resolveRelativeUrl(base: string, relative: string): string {
  if (relative.startsWith("http://") || relative.startsWith("https://")) {
    return relative;
  }
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

/**
 * Resolve a download URL by following redirects and parsing intermediate pages.
 *
 * Strategy:
 * 1. Fetch with undici
 * 2. If HTTP 3xx, follow the Location header and recurse
 * 3. If the response is not HTML, we've reached a downloadable file — return the URL
 * 4. If HTML, parse for meta-refresh redirects, iframe redirects, and JS redirects
 * 5. Recursively resolve up to MAX_DEPTH hops
 */
async function resolveDownloadUrl(
  url: string,
  depth: number = 0
): Promise<string> {
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) return url;

  try {
    const resp = await request(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // undici.request() does NOT auto-follow redirects — handle 3xx manually
    const statusCode = resp.statusCode;
    if (statusCode >= 300 && statusCode < 400) {
      const locationRaw = resp.headers.location;
      const location = Array.isArray(locationRaw) ? locationRaw[0] : (locationRaw as string | undefined);
      if (location) {
        return resolveDownloadUrl(resolveRelativeUrl(url, location), depth + 1);
      }
    }

    const rawContentType = Array.isArray(resp.headers["content-type"])
      ? resp.headers["content-type"][0]
      : (resp.headers["content-type"] as string) || "";
    const mimeType = rawContentType.split(";")[0].trim().toLowerCase();

    // Not HTML — likely a direct file download
    if (
      mimeType &&
      mimeType !== "text/html" &&
      mimeType !== "application/xhtml+xml"
    ) {
      return url;
    }

    const body = await resp.body.text();
    if (!body) return url;

    // Strategy 1: Meta refresh redirect
    // e.g. <meta http-equiv="refresh" content="0; url=https://example.com/file" />
    const metaRefreshMatch = body.match(
      /<meta[^>]*http-equiv=[\"']refresh[\"'][^>]*content=[\"']\d*;\s*url=([^\"']+)[\"']/i
    );
    if (metaRefreshMatch) {
      const redirectUrl = metaRefreshMatch[1].trim();
      if (redirectUrl && !redirectUrl.includes("javascript:void")) {
        return resolveDownloadUrl(resolveRelativeUrl(url, redirectUrl), depth + 1);
      }
    }

    // Strategy 2: Meta refresh (attribute order swapped)
    // e.g. <meta content="0; url=..." http-equiv="refresh" />
    const metaRefreshMatch2 = body.match(
      /<meta[^>]*content=[\"']\d*;\s*url=([^\"']+)[\"'][^>]*http-equiv=[\"']refresh[\"']/i
    );
    if (metaRefreshMatch2) {
      const redirectUrl = metaRefreshMatch2[1].trim();
      if (redirectUrl && !redirectUrl.includes("javascript:void")) {
        return resolveDownloadUrl(resolveRelativeUrl(url, redirectUrl), depth + 1);
      }
    }

    // Strategy 3: Iframe pointing to known file hosts
    const $ = cheerio.load(body);
    const knownHosts = [
      "mega.nz", "mediafire", "dropbox", "google", "pixeldrain",
      "1fichier", "terabox", "datanodes", "vikingfile",
    ];
    const iframeSrc = $("iframe").map((_, el) => $(el).attr("src")).get().find((src) =>
      src && knownHosts.some((host) => src.toLowerCase().includes(host))
    );
    if (iframeSrc) {
      return resolveDownloadUrl(resolveRelativeUrl(url, iframeSrc), depth + 1);
    }

    // Strategy 4: JavaScript window.location redirect
    // Patterns: window.location.href = "...", location.replace("..."), etc.
    const jsRedirectPatterns = [
      /window\.location\.href\s*=\s*[\"']([^\"']+)[\"']/i,
      /window\.location\s*=\s*[\"']([^\"']+)[\"']/i,
      /location\.href\s*=\s*[\"']([^\"']+)[\"']/i,
      /top\.location\s*=\s*[\"']([^\"']+)[\"']/i,
      /document\.location\s*=\s*[\"']([^\"']+)[\"']/i,
      /window\.open\([\"']([^\"']+)[\"']/i,
      // location.replace() — used by ad gateways to silently redirect
      /(?:window\.|top\.|self\.)?location\.replace\s*\(\s*[\"']([^\"']+)[\"']\s*\)/i,
    ];
    for (const pattern of jsRedirectPatterns) {
      const jsMatch = body.match(pattern);
      if (jsMatch) {
        const jsUrl = jsMatch[1].trim();
        if (
          jsUrl &&
          !jsUrl.startsWith("#") &&
          !jsUrl.includes("javascript:void") &&
          !jsUrl.startsWith("/page/") // Skip WordPress pagination links
        ) {
          return resolveDownloadUrl(resolveRelativeUrl(url, jsUrl), depth + 1);
        }
      }
    }

    // Strategy 5: Check for safelinkreview.com / ad gateway pages
    // These usually have a "Skip Ad" link or a countdown timer followed by a redirect link
    const skipLink = $("a").map((_, el) => $(el)).get().find((el) => {
      const text = el.text().trim().toLowerCase();
      const href = el.attr("href") || "";
      return (
        href &&
        !href.startsWith("#") &&
        !href.includes("javascript") &&
        (text.includes("skip") || text.includes("continue") || text.includes("proceed"))
      );
    });
    if (skipLink) {
      const skipUrl = skipLink.attr("href")!;
      return resolveDownloadUrl(resolveRelativeUrl(url, skipUrl), depth + 1);
    }

    // Strategy 6: Look for any link to known file hosts in the page
    const hostLink = $("a").map((_, el) => $(el)).get().find((el) => {
      const href = el.attr("href") || "";
      return knownHosts.some((host) => href.toLowerCase().includes(host));
    });
    if (hostLink) {
      const hostUrl = hostLink.attr("href")!;
      return resolveDownloadUrl(resolveRelativeUrl(url, hostUrl), depth + 1);
    }

    return url;
  } catch {
    return url;
  }
}

/** Fetch a page's HTML content with appropriate headers and timeout. */
async function fetchPageContent(url: string, signal?: AbortSignal): Promise<string> {
  const resp = await request(url, {
    method: "GET",
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  return await resp.body.text();
}

/** Decode HTML entities in a string (e.g., `&amp;` → `&`, `&#8217;` → `'`). */
function decodeHtmlEntities(text: string): string {
  // Handle named entities first
  let result = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, "\u00A0")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&hellip;/g, "\u2026")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&prime;/g, "\u2032")
    .replace(/&Prime;/g, "\u2033")
    .replace(/&laquo;/g, "\u00AB")
    .replace(/&raquo;/g, "\u00BB")
    .replace(/&copy;/g, "\u00A9")
    .replace(/&reg;/g, "\u00AE")
    .replace(/&trade;/g, "\u2122");

  // Handle numeric entities (decimal and hex)
  result = result.replace(/&#(\d+);/g, (_match, code) =>
    String.fromCharCode(parseInt(code, 10))
  );
  result = result.replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
    String.fromCharCode(parseInt(code, 16))
  );

  return result;
}

// ── Live search implementations ──

/** Search the RSS/Atom feed for items matching the query. */
async function searchFeed(
  sourceId: string,
  baseUrl: string,
  query: string
): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    detailUrl: string;
    coverUrl?: string;
    releaseDate: string | null;
    source: string;
    sourceId: string;
    live: true;
  }>
> {
  try {
    const feedUrl = await getCachedFeedUrl(sourceId, baseUrl);
    if (!feedUrl) return [];

    const feedResp = await request(feedUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
    });
    const xml = await feedResp.body.text();
    const feed = await liveSearchParser.parseString(xml);

    const q = normalizeSearchTerm(query);
    return feed.items
      .filter((item) => {
        const title = normalizeSearchTerm(item.title || "");
        const content = normalizeSearchTerm(
          item.content || item.contentSnippet || item.summary || ""
        );
        return title.includes(q) || content.includes(q);
      })
      .map((item) => ({
        id: item.guid || item.link || "",
        title: item.title || "Untitled",
        description: (item.content || item.contentSnippet || item.summary || "").slice(0, 500),
        detailUrl: item.link || baseUrl,
        coverUrl: extractImage(item["content:encoded"] || item.content || ""),
        releaseDate: item.isoDate || item.pubDate || null,
        source: feed.title || "RSS Feed",
        sourceId,
        live: true,
      }));
  } catch (err) {
    console.error(`[searchFeed] Error searching feed ${baseUrl}:`, err);
    return [];
  }
}

/**
 * Scrape a single WordPress search result page and extract article items.
 */
async function scrapeSearchPage(
  sourceId: string,
  baseUrl: string,
  url: string,
  signal: AbortSignal
): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    detailUrl: string;
    coverUrl?: string;
    releaseDate: string | null;
    source: string;
    sourceId: string;
    live: true;
  }>
> {
  const resp = await request(url, {
    method: "GET",
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await resp.body.text();

  const items: Array<{
    id: string;
    title: string;
    description: string;
    detailUrl: string;
    coverUrl?: string;
    releaseDate: string | null;
    source: string;
    sourceId: string;
    live: true;
  }> = [];

  const articleRegex = /<article[^>]*id="post-([^"]+)"[^>]*>([\s\S]*?)<\/article>/gi;
  let articleMatch: RegExpExecArray | null;
  while ((articleMatch = articleRegex.exec(html)) !== null) {
    const postId = articleMatch[1];
    const articleHtml = articleMatch[2];

    const titleMatch = articleHtml.match(
      /<h1 class="post-title"><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h1>/i
    );
    if (!titleMatch) continue;
    const detailUrl = titleMatch[1];
    const title = decodeHtmlEntities(
      titleMatch[2].replace(/<[^>]*>/g, "").trim()
    );

    const imgMatch = articleHtml.match(/<img[^>]*src="([^"]+)"[^>]*>/i);
    const coverUrl = imgMatch?.[1] ? imgMatch[1].replace(/\?.*$/, "") : undefined;

    const excerptMatch = articleHtml.match(/<p class="post-excerpt">([\s\S]*?)<\/p>/i);
    const description = excerptMatch
      ? decodeHtmlEntities(excerptMatch[1].replace(/<[^>]*>/g, "").trim().slice(0, 500))
      : "";

    const dateMatch = articleHtml.match(
      /<time[^>]*datetime="([^"]+)"/i
    );
    const releaseDate = dateMatch?.[1] || null;

    const catMatch = articleHtml.match(/<a[^>]*class="post-category[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const source = catMatch
      ? decodeHtmlEntities(catMatch[1].trim())
      : new URL(baseUrl).hostname;

    items.push({
      id: postId,
      title,
      description,
      detailUrl,
      coverUrl,
      releaseDate,
      source,
      sourceId,
      live: true,
    });
  }

  return items;
}

/**
 * Fetch a single page of WordPress search results (or main site page for browse-all)
 * and extract article items.
 */
async function searchWordPressSite(
  sourceId: string,
  baseUrl: string,
  query: string,
  page: number
): Promise<LiveSearchItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const cleanBase = baseUrl.replace(/\/?$/, "");

    // When query is empty, browse all posts via the main site pagination
    // e.g., getcomics.org/page/2/
    let url: string;
    if (!query) {
      url = page === 1 ? `${cleanBase}/` : `${cleanBase}/page/${page}/`;
    } else {
      const encodedQuery = encodeURIComponent(query);
      url =
        page === 1
          ? `${cleanBase}/?s=${encodedQuery}`
          : `${cleanBase}/page/${page}/?s=${encodedQuery}`;
    }

    return await scrapeSearchPage(sourceId, baseUrl, url, controller.signal);
  } catch (err) {
    console.error(`[searchWordPressSite] Error searching ${baseUrl} page ${page}:`, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ── RSS live search handler ──

/**
 * Handle live search for an RSS source type.
 * First tries the feed, then falls back to WordPress-style page scraping.
 */
async function handleRssLiveSearch(
  sourceId: string,
  source: { baseUrl: string; name: string },
  query: string | undefined,
  page: number,
  isFresh: boolean
): Promise<{
  items: LiveSearchItem[];
  page: number;
  totalPages: number;
  hasMore: boolean;
  cached: boolean;
}> {
  const q = (query || "").trim();

  // Try feed-based search first
  if (q) {
    const cacheKey = `${sourceId}:feed:${q}:${page}`;
    if (!isFresh) {
      const cached = searchResultsCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
        return {
          items: cached.items,
          page,
          totalPages: 1,
          hasMore: false,
          cached: true,
        };
      }
    }

    const feedItems = await searchFeed(sourceId, source.baseUrl, q);
    if (feedItems.length > 0) {
      searchResultsCache.set(cacheKey, { items: feedItems, cachedAt: Date.now() });
      return {
        items: feedItems,
        page,
        totalPages: 1,
        hasMore: false,
        cached: false,
      };
    }
  }

  // Fallback: scrape WordPress-style pages
  const cacheKey = `${sourceId}:wp:${q || "__all__"}:${page}`;
  if (!isFresh) {
    const cached = searchResultsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
      // Look up totalPages from the separate cache (computed on page 1 by detectTotalPages)
      const totalPagesCacheKey = `${source.baseUrl}:${q || "__all__"}`;
      const cachedTotalPages = totalPagesCache.get(totalPagesCacheKey);
      const totalPages = cachedTotalPages ? cachedTotalPages.totalPages : 1;
      const hasMore = page < totalPages;
      return {
        items: cached.items,
        page,
        totalPages,
        hasMore,
        cached: true,
      };
    }
  }

  // Detect total pages on first page load;
  // for subsequent pages, look up the cached total from page 1.
  let totalPages = 1;
  if (page === 1) {
    totalPages = await detectTotalPages(source.baseUrl, q);
  } else {
    const totalPagesCacheKey = `${source.baseUrl}:${q || "__all__"}`;
    const cachedTotalPages = totalPagesCache.get(totalPagesCacheKey);
    if (cachedTotalPages && Date.now() - cachedTotalPages.cachedAt < SEARCH_CACHE_TTL_MS) {
      totalPages = cachedTotalPages.totalPages;
    }
  }

  // Clear stale cache for this page when doing a fresh fetch,
  // so that Phase 1's subsequent stale request gets a cache miss
  // and fetches live data instead of returning stale cached results.
  if (isFresh) {
    searchResultsCache.delete(cacheKey);
  }

  // Fetch the page
  const items = await searchWordPressSite(sourceId, source.baseUrl, q, page);
  const hasMore = page < totalPages;

  if (items.length > 0 && !isFresh) {
    searchResultsCache.set(cacheKey, { items, cachedAt: Date.now() });
  }

  return {
    items,
    page,
    totalPages,
    hasMore,
    cached: false,
  };
}

// ── Provider-based live search handler ──

/**
 * Handle DCM native search via POST to index.php?ACT=dosearch.
 * DCM search is single-page (no pagination support), so only page=1 is meaningful.
 */
async function handleDcmSearch(
  sourceId: string,
  query: string,
  page: number,
  isFresh: boolean
): Promise<{
  items: LiveSearchItem[];
  page: number;
  totalPages: number;
  hasMore: boolean;
  cached: boolean;
}> {
  const q = query.trim();
  if (!q) {
    return { items: [], page: 1, totalPages: 0, hasMore: false, cached: false };
  }

  const cacheKey = `${sourceId}:dcm-search:${q}`;
  if (!isFresh) {
    const cached = searchResultsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
      return {
        items: cached.items,
        page,
        totalPages: 1,
        hasMore: false,
        cached: true,
      };
    }
  }

  if (isFresh) {
    searchResultsCache.delete(cacheKey);
  }

  try {
    const rawItems = await searchDcm(q);

    const items: LiveSearchItem[] = rawItems.map((item) => ({
      id: item.detailUrl || item.title,
      title: item.title,
      description: "",
      detailUrl: item.detailUrl || "",
      coverUrl: item.coverUrl,
      releaseDate: item.releaseDate || null,
      source: "Digital Comic Museum",
      sourceId,
      live: true,
    }));

    if (items.length > 0 && !isFresh) {
      searchResultsCache.set(cacheKey, { items, cachedAt: Date.now() });
    }

    // DCM search is single-page — no pagination
    return {
      items,
      page,
      totalPages: 1,
      hasMore: false,
      cached: false,
    };
  } catch (err: any) {
    console.error(`[handleDcmSearch] Error searching DCM for "${q}":`, err);
    return {
      items: [],
      page,
      totalPages: 1,
      hasMore: false,
      cached: false,
    };
  }
}

/**
 * Handle live search for a non-RSS source using the provider's inspect method.
 * Scrapes listing pages of the source site.
 */
async function handleProviderLiveSearch(
  sourceId: string,
  baseUrl: string,
  provider: ProviderAdapter,
  page: number,
  isFresh: boolean,
  cid?: string,
  query?: string
): Promise<{
  items: LiveSearchItem[];
  page: number;
  totalPages: number;
  hasMore: boolean;
  cached: boolean;
}> {
  const q = (query || "").trim();

  // For providers that support native search, route to search
  if (q && provider.id === "digitalcomicmuseum") {
    return handleDcmSearch(sourceId, q, page, isFresh);
  }

  // Include query in cache key so different IA searches don't collide
  const cacheKey = `${sourceId}:provider:${q || cid || "__all__"}:${page}`;
  if (!isFresh) {
    const cached = searchResultsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
      return {
        items: cached.items,
        page,
        totalPages: 1,
        hasMore: false,
        cached: true,
      };
    }
  }

  try {
    // Clear stale cache for this page when doing a fresh fetch
    if (isFresh) {
      searchResultsCache.delete(cacheKey);
    }

    // Build the listing URL for the requested page
    // Most comic sites use /page/N/ or ?page=N pagination
    // DCM uses ?cid=X (+ ?page=N) on category pages, or ?page=N on the homepage
    // Internet Archive uses the Advanced Search API with ?q= and &page= params
    const cleanBase = baseUrl.replace(/\/?$/, "");
    let listingUrl: string;
    if (provider.id === "digitalcomicmuseum") {
      if (cid) {
        // Category browsing — DCM shows all items in a category
        // Category pages ignore ?page=N, so we always fetch page 1
        listingUrl = `${cleanBase}/index.php?cid=${cid}`;
      } else if (page === 1) {
        listingUrl = cleanBase;
      } else {
        listingUrl = `${cleanBase}/index.php?page=${page}`;
      }
    } else if (provider.id === "internetarchive" && q) {
      // IA search — use the Advanced Search API with query + page
      listingUrl = `${cleanBase}/advancedsearch.php?q=${encodeURIComponent(q)}&page=${page}`;
    } else if (page === 1) {
      listingUrl = cleanBase;
    } else {
      listingUrl = `${cleanBase}/page/${page}/`;
    }

    const result = await provider.inspect(listingUrl);

    console.log(`[handleProviderLiveSearch] provider=${provider.id} listingUrl=${listingUrl} items=${result.items.length} error=${result.error}`);
    if (result.items.length > 0) {
      console.log(`[handleProviderLiveSearch] first item: title="${result.items[0].title}" url="${result.items[0].detailUrl}"`);
    }

    if (result.error) {
      console.warn(`[handleProviderLiveSearch] Provider returned error for ${baseUrl}:`, result.error);
      return {
        items: [],
        page,
        totalPages: 1,
        hasMore: false,
        cached: false,
      };
    }

    // Map provider items to LiveSearchItems
    const items: LiveSearchItem[] = result.items.map((item) => ({
      id: item.id || item.detailUrl || item.title,
      title: item.title,
      description: item.description || "",
      detailUrl: item.detailUrl || baseUrl,
      coverUrl: item.coverUrl,
      releaseDate: item.releaseDate || null,
      source: result.title || provider.name || "Provider",
      sourceId,
      live: true,
    }));

    if (items.length > 0 && !isFresh) {
      searchResultsCache.set(cacheKey, { items, cachedAt: Date.now() });
    }

    // Determine pagination.
    // For IA, use totalResults from the API response for accurate page counts.
    // For other providers, assume more pages if we got a full page of results (≥10 items).
    const ITEMS_PER_IA_PAGE = 50;
    let hasMore: boolean;
    let totalPages: number;

    if (result.totalResults != null && provider.id === "internetarchive") {
      // Accurate pagination from IA's numFound
      totalPages = Math.ceil(result.totalResults / ITEMS_PER_IA_PAGE);
      hasMore = page < totalPages && items.length >= ITEMS_PER_IA_PAGE;
    } else {
      hasMore = items.length >= 10;
      totalPages = hasMore ? 99 : page; // 99 = "unknown, keep loading"
    }

    // Detect when a subsequent page returns the same items as page 1
    // Some providers (e.g., DCM) ignore ?page=N and always return the same listing.
    // This prevents the frontend from loading infinite duplicate pages.
    if (page > 1 && items.length > 0) {
      const page1CacheKey = `${sourceId}:provider:${cid || "__all__"}:1`;
      const page1Cached = searchResultsCache.get(page1CacheKey);
      if (page1Cached && page1Cached.items.length > 0) {
        const page1Ids = new Set(page1Cached.items.map(i => i.detailUrl || i.id));
        let overlapCount = 0;
        for (const item of items) {
          if (page1Ids.has(item.detailUrl || item.id)) overlapCount++;
        }
        if (overlapCount / items.length >= 0.8) {
          // Same items as page 1 — pagination is broken, stop here
          hasMore = false;
          totalPages = 1;
        }
      }
    }

    return {
      items,
      page,
      totalPages,
      hasMore,
      cached: false,
    };
  } catch (err: any) {
    console.error(`[handleProviderLiveSearch] Error for ${baseUrl}:`, err);
    return {
      items: [],
      page,
      totalPages: 1,
      hasMore: false,
      cached: false,
    };
  }
}

/**
 * Detect the total number of search result pages (or main site pages for browse-all)
 * from the WordPress pagination nav.
 * Parses "Page X of Y" text from the first page.
 */
async function detectTotalPages(
  baseUrl: string,
  query: string
): Promise<number> {
  const cacheKey = `${baseUrl}:${query || "__all__"}`;
  const cached = totalPagesCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
    return cached.totalPages;
  }

  try {
    const cleanBase = baseUrl.replace(/\/?$/, "");

    // When query is empty, scrape the main page for pagination
    // e.g., getcomics.org/ — looks for /page/ links in the pagination nav
    let url: string;
    if (!query) {
      url = `${cleanBase}/`;
    } else {
      const encodedQuery = encodeURIComponent(query);
      url = `${cleanBase}/?s=${encodedQuery}`;
    }

    const resp = await request(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await resp.body.text();

    // Look for "Page 1 of 191" or "Page X of Y" in pagination elements
    const pageOfMatch = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
    if (pageOfMatch) {
      const total = parseInt(pageOfMatch[1], 10);
      if (total > 0) {
        totalPagesCache.set(cacheKey, { totalPages: total, cachedAt: Date.now() });
        return total;
      }
    }

    // Fallback: look for page-number links to determine the last page
    // For search: /page/191/?s=batman
    // For browse-all: /page/191/ (no ?s=)
    const pagePattern = query ? /\/page\/(\d+)\/\?s=/gi : /<a[^>]*href="[^"]*\/page\/(\d+)\/"[^>]*>/gi;
    const pageLinks = html.match(pagePattern);
    if (pageLinks) {
      let maxPage = 0;
      for (const link of pageLinks) {
        const num = parseInt(link.match(/\/page\/(\d+)\//)?.[1] || "0", 10);
        if (num > maxPage) maxPage = num;
      }
      if (maxPage > 0) {
        totalPagesCache.set(cacheKey, { totalPages: maxPage, cachedAt: Date.now() });
        return maxPage;
      }
    }

    return 1;
  } catch (err) {
    console.error(`[detectTotalPages] Error detecting pages for ${baseUrl}:`, err);
    return 1;
  }
}
