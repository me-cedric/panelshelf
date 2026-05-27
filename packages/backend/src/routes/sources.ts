import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import { eq, sql } from "drizzle-orm";
import { request } from "undici";
import { getDb } from "../db/index";
import { sources } from "../db/schema";
import { refreshSource } from "../services/catalog";
import { clearFeedUrlCache } from "./catalog";

export function sourceRoutes(app: FastifyInstance) {
  // List sources
  app.get("/api/sources", {
    schema: {
      tags: ["Sources"],
      summary: "List all sources",
      description: "Returns all configured catalog sources, ordered by name.",
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
                  type: { type: "string", enum: ["rss", "json-api", "static-index", "local-folder", "manual-url"] },
                  baseUrl: { type: "string" },
                  enabled: { type: "boolean" },
                  refreshIntervalMin: { type: "integer" },
                  headers: { type: "string" },
                  rateLimitMs: { type: "integer" },
                  lastFetchedAt: { type: "string" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  }, async (_req, _reply) => {
    const db = getDb();
    const all = db.select().from(sources).orderBy(sources.name).all();
    return { sources: all };
  });

  // Create source
  app.post("/api/sources", {
    schema: {
      tags: ["Sources"],
      summary: "Create a new source",
      description: "Creates a new catalog source with the specified type (rss, json-api, static-index, local-folder, manual-url).",
      body: {
        type: "object",
        required: ["name", "type", "baseUrl"],
        properties: {
          name: { type: "string", minLength: 1, description: "Display name for the source" },
          type: { type: "string", enum: ["rss", "json-api", "static-index", "local-folder", "manual-url"] },
          baseUrl: { type: "string", minLength: 1, description: "URL or path for the source" },
          enabled: { type: "boolean", description: "Whether the source is active" },
          refreshIntervalMin: { type: "integer", minimum: 1, description: "Refresh interval in minutes" },
          headers: { type: "object", description: "Optional HTTP headers as key-value pairs" },
          rateLimitMs: { type: "integer", minimum: 0, description: "Rate limit between requests in ms" },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          required: ["source"],
          properties: {
            source: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                type: { type: "string" },
                baseUrl: { type: "string" },
                enabled: { type: "boolean" },
                refreshIntervalMin: { type: "integer" },
                headers: { type: "string" },
                rateLimitMs: { type: "integer" },
                lastFetchedAt: { type: "string" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    const db = getDb();
    const id = uuid();

    db.insert(sources)
      .values({
        id,
        name: body.name,
        type: body.type,
        baseUrl: body.baseUrl,
        enabled: body.enabled ?? true,
        refreshIntervalMin: body.refreshIntervalMin ?? 60,
        headers: body.headers ? JSON.stringify(body.headers) : null,
        rateLimitMs: body.rateLimitMs ?? null,
      })
      .run();

    const source = db.select().from(sources).where(eq(sources.id, id)).get();
    return { source };
  });

  // Update source
  app.put("/api/sources/:id", {
    schema: {
      tags: ["Sources"],
      summary: "Update a source",
      description: "Updates an existing source's properties (name, type, baseUrl, etc.). Only provided fields are updated.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Source ID" },
        },
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          type: { type: "string", enum: ["rss", "json-api", "static-index", "local-folder", "manual-url"] },
          baseUrl: { type: "string", minLength: 1 },
          enabled: { type: "boolean" },
          refreshIntervalMin: { type: "integer", minimum: 1 },
          headers: { type: "object" },
          rateLimitMs: { type: "integer", minimum: 0 },
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
                type: { type: "string" },
                baseUrl: { type: "string" },
                enabled: { type: "boolean" },
                refreshIntervalMin: { type: "integer" },
                headers: { type: "string" },
                rateLimitMs: { type: "integer" },
                lastFetchedAt: { type: "string" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
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
    const body = req.body as any;
    const db = getDb();

    // Only update fields that are present in the request body
    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.baseUrl !== undefined) updateData.baseUrl = body.baseUrl;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;
    if (body.refreshIntervalMin !== undefined) updateData.refreshIntervalMin = body.refreshIntervalMin;
    if (body.headers !== undefined) {
      updateData.headers = body.headers ? JSON.stringify(body.headers) : null;
    }
    if (body.rateLimitMs !== undefined) {
      updateData.rateLimitMs = body.rateLimitMs ?? null;
    }
    updateData.updatedAt = sql`(datetime('now'))`;

    db.update(sources)
      .set(updateData)
      .where(eq(sources.id, id))
      .run();

    const source = db.select().from(sources).where(eq(sources.id, id)).get();
    if (!source) return reply.status(404).send({ error: "Source not found" });

    // Invalidate feed URL cache in case the source's baseUrl changed
    clearFeedUrlCache(id);

    return { source };
  });

  // Delete source
  app.delete("/api/sources/:id", {
    schema: {
      tags: ["Sources"],
      summary: "Delete a source",
      description: "Permanently removes a source and all associated catalog items and download links.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Source ID" },
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
    db.delete(sources).where(eq(sources.id, id)).run();
    return { success: true };
  });

  // Refresh source
  app.post("/api/sources/:id/refresh", {
    schema: {
      tags: ["Sources"],
      summary: "Refresh a source",
      description: "Triggers a catalog refresh for the specified source, fetching new items from the source's feed or API.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Source ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            queued: { type: "boolean" },
            sourceId: { type: "string" },
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
      const result = await refreshSource(id);
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Auto-detect source type from URL
  app.post("/api/sources/auto-detect", {
    schema: {
      tags: ["Sources"],
      summary: "Auto-detect source type",
      description: "Probes a URL and auto-detects the best source type configuration (RSS, JSON API, static index, etc.) by analyzing Content-Type and response body.",
      body: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 1, format: "uri", description: "URL to probe for source type detection" },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          properties: {
            type: { type: "string" },
            name: { type: "string" },
            url: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            description: { type: "string" },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        422: {
          type: "object",
          properties: {
            error: { type: "string" },
            type: { type: "string" },
            name: { type: "string" },
            url: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { url } = req.body as { url: string };
    if (!url) return reply.status(400).send({ error: "URL is required" });

    try {
      const result = await autoDetectSource(url);
      return result;
    } catch (err: any) {
      const safeHostname = parseHostname(url) || "unknown";
      return reply.status(422).send({
        error: err.message,
        type: "static-index",
        name: safeHostname,
        url,
        confidence: 0,
      });
    }
  });

  // Get available types
  app.get("/api/sources/types", {
    schema: {
      tags: ["Sources"],
      summary: "Get available source types",
      description: "Returns the list of supported source types (rss, json-api, static-index, local-folder, manual-url) with descriptions.",
      response: {
        200: {
          type: "object",
          properties: {
            types: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  requiresAuth: { type: "boolean" },
                  localOnly: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    return {
      types: [
        { id: "rss", name: "RSS/Atom Feed", description: "Fetch items from an RSS or Atom feed" },
        {
          id: "json-api",
          name: "JSON API",
          description: "Fetch items from a JSON API endpoint",
          requiresAuth: false,
        },
        {
          id: "static-index",
          name: "Static Public Index",
          description: "Scrape a static HTML page for comic listings",
        },
        {
          id: "local-folder",
          name: "Local Folder Import",
          description: "Import comic files from a local directory",
          localOnly: true,
        },
        {
          id: "manual-url",
          name: "Manual URL Entry",
          description: "Add a single URL manually for inspection and download",
        },
      ],
    };
  });
}

/**
 * Parse the hostname from a URL safely, returning null on failure.
 */
function parseHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Validate that a URL is safe to fetch (SSRF protection).
 * Blocks private/reserved IP ranges and non-HTTP(S) schemes.
 */
function isValidFetchUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only allow http and https schemes
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  // Block private and reserved hostnames/IPs
  const hostname = parsed.hostname.toLowerCase();
  const blockedPatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^fd[0-9a-f]{2}:/i,
    /^fe8[0-9a-f]:/i,
    /\.local$/i,
    /\.internal$/i,
    /\.lan$/i,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(hostname)) return false;
  }

  return true;
}

/**
 * Get the MIME type from a Content-Type header, stripping parameters.
 */
function getMimeType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/**
 * Probe a URL and auto-detect the best source type configuration.
 * Fetches the URL and analyzes Content-Type + response body to determine
 * whether it's an RSS/Atom feed, JSON API, known provider site, or generic HTML page.
 */
async function autoDetectSource(url: string): Promise<{
  type: string;
  name: string;
  url: string;
  confidence: number;
  description: string;
}> {
  // SSRF protection: validate the URL is safe to fetch
  if (!isValidFetchUrl(url)) {
    throw new Error("Invalid or blocked URL — only public HTTP(S) URLs are allowed");
  }

  const safeHostname = parseHostname(url) || "unknown";

  // Step 1: Quick URL pattern check for known providers
  const urlLower = url.toLowerCase();
  if (urlLower.includes("getcomics.org")) {
    return {
      type: "rss",
      name: "GetComics",
      url,
      confidence: 1,
      description: "Detected GetComics.org — uses the built-in GetComics scraper provider",
    };
  }

  // Step 2: Fetch the URL and analyze response (10s timeout to prevent hanging)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let resp;
  try {
    resp = await request(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml,application/json;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  const rawContentType = Array.isArray(resp.headers["content-type"])
    ? resp.headers["content-type"][0]
    : (resp.headers["content-type"] as string) || "";
  const mimeType = getMimeType(rawContentType);
  const body = await resp.body.text();
  const trimmed = body.trim();

  // Step 3: Check for RSS/Atom feed by Content-Type
  if (mimeType === "application/rss+xml" ||
      mimeType === "application/atom+xml" ||
      mimeType === "application/xml" ||
      mimeType === "text/xml") {
    // Extract feed title from XML
    const titleMatch =
      trimmed.match(/<title[^>]*>([^<]+)<\/title>/i) ||
      trimmed.match(/<feed[^>]*>([\s\S]*?)<\/feed>/i);
    const title = titleMatch?.[1]?.trim() || safeHostname;
    return {
      type: "rss",
      name: title.slice(0, 100),
      url,
      confidence: 0.95,
      description: "Detected RSS/Atom feed via Content-Type header",
    };
  }

  // Step 4: Check if body looks like RSS/Atom XML (starts with <rss or <feed)
  if (trimmed.startsWith("<rss") || trimmed.startsWith("<feed")) {
    const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || safeHostname;
    return {
      type: "rss",
      name: title.slice(0, 100),
      url,
      confidence: 0.9,
      description: "Detected RSS/Atom feed by XML structure",
    };
  }

  // Step 5: Check for JSON API
  if (mimeType === "application/json" || mimeType.endsWith("+json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      // Try to extract a name/title from the JSON response
      let name =
        parsed?.title ||
        parsed?.name ||
        parsed?.app ||
        parsed?.application ||
        parsed?.site;
      if (typeof name !== "string") name = safeHostname;
      const itemCount = Array.isArray(parsed) ? `${parsed.length} items` : Object.keys(parsed).length + " keys";
      return {
        type: "json-api",
        name: name.slice(0, 100),
        url,
        confidence: 0.85,
        description: `Detected JSON API — response has ${itemCount}`,
      };
    } catch {
      // Not valid JSON despite looking like it — fall through
    }
  }

  // Step 6: Check for known comic/WordPress site patterns
  if (mimeType === "text/html" || mimeType === "application/xhtml+xml") {
    // Known provider patterns (checked first for higher confidence)
    if (urlLower.includes("archive.org")) {
      return {
        type: "static-index",
        name: "Internet Archive",
        url,
        confidence: 1,
        description: "Detected Internet Archive — uses the built-in IA API provider",
      };
    }
    if (urlLower.includes("digitalcomicmuseum.com")) {
      return {
        type: "static-index",
        name: "Digital Comic Museum",
        url,
        confidence: 1,
        description: "Detected Digital Comic Museum — uses the built-in DCM scraper provider",
      };
    }
    if (urlLower.includes("zipcomic.com")) {
      return {
        type: "static-index",
        name: "ZipComic",
        url,
        confidence: 0.9,
        description: "Detected ZipComic — uses the built-in ZipComic scraper provider (may be behind Cloudflare)",
      };
    }
    if (urlLower.includes("readcomics") || urlLower.includes("comicextra")) {
      return {
        type: "static-index",
        name: safeHostname.replace(/^www\./, ""),
        url,
        confidence: 0.8,
        description: "Detected comic listing site — uses static HTML scraping",
      };
    }

    // Try to extract page title for the source name
    const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch?.[1]?.trim() || safeHostname;

    return {
      type: "static-index",
      name: pageTitle.slice(0, 100),
      url,
      confidence: 0.6,
      description: "Detected HTML page — will be scraped as a static index",
    };
  }

  // Step 7: Check for direct download URL (file extension)
  const fileExt = url.split(".").pop()?.toLowerCase() || "";
  if (["pdf", "cbr", "cbz", "zip", "rar", "epub", "mobi"].includes(fileExt)) {
    return {
      type: "manual-url",
      name: url.split("/").pop() || "Direct Download",
      url,
      confidence: 0.75,
      description: `Detected direct download link (.${fileExt} file)`,
    };
  }

  // Step 8: Fallback — treat as a static HTML page
  return {
    type: "static-index",
    name: safeHostname.replace(/^www\./, ""),
    url,
    confidence: 0.3,
    description: "Unknown source type — will attempt generic HTML scraping",
  };
}
