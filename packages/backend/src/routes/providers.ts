import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { sources } from "../db/schema";
import { getAllProviders } from "../providers/registry";
import { clearProviderCache } from "./catalog";

/**
 * Map provider IDs to the source configuration needed when creating
 * a DB source record. Only site-specific providers have pre-configured
 * source settings — generic handlers (rss, manual-url) are always available.
 */
const PROVIDER_SOURCE_CONFIG: Record<
  string,
  { type: string; baseUrl: string } | null
> = {
  getcomics: { type: "rss", baseUrl: "https://getcomics.org" },
  digitalcomicmuseum: {
    type: "static-index",
    baseUrl: "https://www.digitalcomicmuseum.com",
  },
  zipcomic: { type: "static-index", baseUrl: "https://zipcomic.com" },
  internetarchive: { type: "static-index", baseUrl: "https://archive.org" },
  // Generic handlers — always available, no pre-configured source
  rss: null,
  "manual-url": null,
};

export function providerRoutes(app: FastifyInstance) {
  // List all providers with their enabled status
  app.get("/api/providers", {
    schema: {
      tags: ["Providers"],
      summary: "List all providers",
      description: "Returns all registered providers with their enabled/disabled status, source associations, and last fetch times.",
      response: {
        200: {
          type: "object",
          properties: {
            providers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  configurable: { type: "boolean" },
                  enabled: { type: "boolean" },
                  sourceId: { type: "string" },
                  sourceName: { type: "string" },
                  lastFetchedAt: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const db = getDb();
    const allSources = db.select().from(sources).all();
    const all = getAllProviders();

    const providers = all.map((p) => {
      const config = PROVIDER_SOURCE_CONFIG[p.id];
      const isConfigurable = config !== null;

      // Find the corresponding source record (if any)
      const source = isConfigurable
        ? allSources.find(
            (s) =>
              s.baseUrl === config!.baseUrl && s.type === config!.type
          )
        : undefined;

      return {
        id: p.id,
        name: p.name,
        configurable: isConfigurable,
        enabled: source ? source.enabled : false,
        sourceId: source ? source.id : null,
        sourceName: source ? source.name : null,
        lastFetchedAt: source ? source.lastFetchedAt : null,
      };
    });

    return { providers };
  });

  // Toggle a provider on/off
  app.post("/api/providers/:id/toggle", {
    schema: {
      tags: ["Providers"],
      summary: "Toggle a provider",
      description: "Enables or disables a site-specific provider (getcomics, digitalcomicmuseum, zipcomic, internetarchive). Creates or toggles the underlying source record.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", enum: ["getcomics", "digitalcomicmuseum", "zipcomic", "internetarchive"], description: "Provider ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            provider: {
              type: "object",
              properties: {
                id: { type: "string" },
                enabled: { type: "boolean" },
                sourceId: { type: "string" },
                sourceName: { type: "string" },
                lastFetchedAt: { type: "string" },
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
    const { id } = req.params as { id: string };
    const config = PROVIDER_SOURCE_CONFIG[id];

    if (!config) {
      return reply.status(400).send({
        error: `Provider "${id}" cannot be toggled — it is a generic handler and is always available`,
      });
    }

    const db = getDb();

    // Find existing source for this provider
    const existing = db
      .select()
      .from(sources)
      .where(
        eq(sources.baseUrl, config.baseUrl)
      )
      .get();

    if (existing) {
      // Toggle: disable if enabled, enable if disabled
      // If disabling, we set enabled=false. If enabling and it was disabled, set enabled=true.
      // If the source was deleted somehow, create a new one.
      db.update(sources)
        .set({ enabled: existing.enabled ? false : true })
        .where(eq(sources.id, existing.id))
        .run();
    } else {
      // Create a new source for this provider
      const sourceId = uuid();
      const name =
        id === "getcomics"
          ? "GetComics"
          : id === "digitalcomicmuseum"
            ? "Digital Comic Museum"
            : id === "zipcomic"
              ? "ZipComic"
              : id === "internetarchive"
                ? "Internet Archive"
                : id;

      db.insert(sources)
        .values({
          id: sourceId,
          name,
          type: config.type as any,
          baseUrl: config.baseUrl,
          enabled: true,
          refreshIntervalMin: 60,
        })
        .run();
    }

    // Reload and return updated state
    const allSources = db.select().from(sources).all();
    const updatedSource = allSources.find(
      (s) => s.baseUrl === config.baseUrl
    );

    return {
      provider: {
        id,
        enabled: updatedSource ? updatedSource.enabled : false,
        sourceId: updatedSource ? updatedSource.id : null,
        sourceName: updatedSource ? updatedSource.name : null,
        lastFetchedAt: updatedSource ? updatedSource.lastFetchedAt : null,
      },
    };
  });

  // Clear cache for a specific provider
  app.post("/api/providers/:id/clear-cache", {
    schema: {
      tags: ["Providers"],
      summary: "Clear provider cache",
      description: "Clears the in-memory cache entries (feed URLs, search results) for a specific provider.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Provider ID (e.g., getcomics, internetarchive, or _all)" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
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
    const config = PROVIDER_SOURCE_CONFIG[id];

    if (!config) {
      return reply.status(400).send({
        error: `Provider "${id}" has no configurable source to clear cache for`,
      });
    }

    // Find the source for this provider and clear its cache entries
    const db = getDb();
    const source = db
      .select()
      .from(sources)
      .where(eq(sources.baseUrl, config.baseUrl))
      .get();

    if (source) {
      clearProviderCache(source.id);
    }

    return {
      success: true,
      message: id === "_all"
        ? "All provider caches cleared"
        : `Cache cleared for ${id}`,
    };
  });
}
