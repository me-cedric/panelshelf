import { v4 as uuid } from "uuid";
import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../db/index";
import { catalogItems, downloadLinks, sources } from "../db/schema";
import type { NormalizedItem, NormalizedDownloadLink } from "../providers/types";
import { createStableHash } from "../providers/types";
import { findProviderForUrl } from "../providers/registry";
import { queue } from "../queue/index";

/** Characters to strip when normalizing text for search. */
const SPECIAL_CHARS = ["-", "'", '"', ".", ":", ";", ",", "!", "?", "(", ")", "[", "]", "{", "}", "#", "_"] as const;

/**
 * Build a normalized SQL column expression that strips special chars
 * and lowercases, so search is case-insensitive and ignores punctuation.
 * Returns a SQL fragment like `LOWER(REPLACE(REPLACE(col, '-', ''), ...))`.
 */
function normalizedColSql(col: any): any {
  let expr: any = sql`${col}`;
  for (const ch of SPECIAL_CHARS) {
    expr = sql`REPLACE(${expr}, ${ch}, '')`;
  }
  return sql`LOWER(${expr})`;
}

/** Normalize a search term: lowercase, strip non-alphanumeric (keep spaces). */
export function normalizeSearchTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


// Helper to work around Drizzle ORM v0.40 type inference gap for SQLite insert
// values with enum/text columns. The `as any` cast in `values()` is necessary
// because Drizzle's $inferInsert excludes certain column types from the insert
// schema even when they're valid at runtime.
function insertDownloadLink(
  db: ReturnType<typeof getDb>,
  values: {
    id: string;
    catalogItemId: string;
    provider: string;
    fileName: string | null;
    size: string | null;
    url: string;
    linkType: "direct" | "redirect" | "manual" | "unknown";
    directDownloadCapable: number;
    manualActionRequired: number;
  }
) {
  db.insert(downloadLinks).values(values as any).run();
}

export interface CatalogItemWithLinks {
  item: typeof catalogItems.$inferSelect;
  links: (typeof downloadLinks.$inferSelect)[];
}

export async function ingestItems(sourceId: string, normalizedItems: NormalizedItem[]) {
  const db = getDb();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of normalizedItems) {
    const stableHash = createStableHash({
      title: item.title,
      issueNumber: item.issueNumber,
      publisher: item.publisher,
      releaseDate: item.releaseDate,
      sourceId,
    });

    const existing = db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.stableHash, stableHash))
      .get();

    if (existing) {
      // Update existing
      db.update(catalogItems)
        .set({
          title: item.title,
          series: item.series ?? existing.series,
          issueNumber: item.issueNumber ?? existing.issueNumber,
          volume: item.volume ?? existing.volume,
          publisher: item.publisher ?? existing.publisher,
          releaseDate: item.releaseDate ?? existing.releaseDate,
          format: item.format ?? existing.format,
          fileSize: item.fileSize ?? existing.fileSize,
          fileSizeBytes: item.fileSizeBytes ?? existing.fileSizeBytes,
          tags: item.tags ? JSON.stringify(item.tags) : existing.tags,
          description: item.description ?? existing.description,
          coverUrl: item.coverUrl ?? existing.coverUrl,
          detailUrl: item.detailUrl ?? existing.detailUrl,
          downloadAvailable: item.downloadLinks.length > 0,
        })
        .where(eq(catalogItems.stableHash, stableHash))
        .run();
      updated++;

      // Replace links
      db.delete(downloadLinks)
        .where(eq(downloadLinks.catalogItemId, existing.id))
        .run();

      for (const link of item.downloadLinks) {
        insertDownloadLink(db, {
          id: uuid(),
          catalogItemId: existing.id,
          provider: link.provider,
          fileName: link.fileName ?? null,
          size: link.size ?? null,
          url: link.url,
          linkType: link.linkType,
          directDownloadCapable: link.directDownloadCapable ? 1 : 0,
          manualActionRequired: link.manualActionRequired ? 1 : 0,
        });
      }
    } else {
      // Insert new
      const itemId = uuid();
      db.insert(catalogItems)
        .values({
          id: itemId,
          sourceId,
          title: item.title,
          series: item.series,
          issueNumber: item.issueNumber,
          volume: item.volume,
          publisher: item.publisher,
          releaseDate: item.releaseDate,
          format: item.format,
          fileSize: item.fileSize,
          fileSizeBytes: item.fileSizeBytes,
          tags: item.tags ? JSON.stringify(item.tags) : null,
          description: item.description,
          coverUrl: item.coverUrl,
          detailUrl: item.detailUrl,
          stableHash,
          downloadAvailable: item.downloadLinks.length > 0,
        })
        .run();
      added++;

      for (const link of item.downloadLinks) {
        insertDownloadLink(db, {
          id: uuid(),
          catalogItemId: itemId,
          provider: link.provider,
          fileName: link.fileName ?? null,
          size: link.size ?? null,
          url: link.url,
          linkType: link.linkType,
          directDownloadCapable: link.directDownloadCapable ? 1 : 0,
          manualActionRequired: link.manualActionRequired ? 1 : 0,
        });
      }
    }
  }

  // Update last fetched timestamp
  db.update(sources)
    .set({ lastFetchedAt: sql`(datetime('now'))`, updatedAt: sql`(datetime('now'))` })
    .where(eq(sources.id, sourceId))
    .run();

  return { added, updated, skipped };
}

export async function refreshSource(sourceId: string) {
  const db = getDb();
  const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();

  if (!source) throw new Error(`Source not found: ${sourceId}`);
  if (!source.enabled) throw new Error(`Source is disabled: ${sourceId}`);

  const provider = findProviderForUrl(source.baseUrl);
  if (!provider) throw new Error(`No provider found for URL: ${source.baseUrl}`);

  const headers = source.headers ? JSON.parse(source.headers) : undefined;

  queue.add(
    "refresh-source",
    { sourceId, url: source.baseUrl, headers },
    async (job) => {
      const result = await provider.inspect(job.data.url, {
        headers: job.data.headers,
        maxPages: 5,
      });
      const stats = await ingestItems(job.data.sourceId, result.items);
      // stats is logged but not returned (QueueJob expects void return)
    }
  );

  return { queued: true, sourceId };
}

export async function getCatalogItems(options: {
  search?: string;
  publisher?: string;
  series?: string;
  language?: string;
  format?: string;
  sourceId?: string;
  downloadAvailable?: boolean;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  addedFrom?: string;
  addedTo?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const conditions: any[] = [];

  if (options.search) {
    const normalized = normalizeSearchTerm(options.search);
    // If the search term is entirely special characters, skip search
    if (normalized.length === 0) {
      conditions.push(sql`1=0`); // no results
    } else {
      const pattern = `%${normalized}%`;
      const normTitle = normalizedColSql(catalogItems.title);
      const normDesc = normalizedColSql(catalogItems.description);
      const normSeries = normalizedColSql(catalogItems.series);
      const normPub = normalizedColSql(catalogItems.publisher);
      const normTags = normalizedColSql(catalogItems.tags);
      conditions.push(
        sql`(
          ${normTitle} LIKE ${pattern}
          OR ${normDesc} LIKE ${pattern}
          OR ${normSeries} LIKE ${pattern}
          OR ${normPub} LIKE ${pattern}
          OR ${normTags} LIKE ${pattern}
        )`
      );
    }
  }
  if (options.publisher) conditions.push(eq(catalogItems.publisher, options.publisher));
  if (options.series) conditions.push(sql`${catalogItems.series} LIKE ${"%" + options.series + "%"}`);
  if (options.language) conditions.push(eq(catalogItems.language, options.language));
  if (options.format) conditions.push(eq(catalogItems.format, options.format));
  if (options.sourceId) conditions.push(eq(catalogItems.sourceId, options.sourceId));
  if (options.downloadAvailable !== undefined) {
    conditions.push(eq(catalogItems.downloadAvailable, options.downloadAvailable));
  }
  if (options.dateFrom) conditions.push(sql`${catalogItems.releaseDate} >= ${options.dateFrom}`);
  if (options.dateTo) conditions.push(sql`${catalogItems.releaseDate} <= ${options.dateTo}`);
  if (options.addedFrom) conditions.push(sql`${catalogItems.addedAt} >= ${options.addedFrom}`);
  if (options.addedTo) conditions.push(sql`${catalogItems.addedAt} <= ${options.addedTo}`);

  // Sort
  const sortBy = options.sortBy || "releaseDate";
  const sortColumnMap: Record<string, string> = {
    addedAt: "added_at",
    title: "title",
    publisher: "publisher",
    fileSizeBytes: "file_size_bytes",
    releaseDate: "release_date",
  };
  const columnName = sortColumnMap[sortBy] || "release_date";
  const orderDirection = options.sortOrder === "asc" ? "ASC" : "DESC";

  const query = db
    .select()
    .from(catalogItems)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql.raw(`${columnName} ${orderDirection}`))
    .limit(options.limit || 50)
    .offset(options.offset || 0);

  const items = query.all();

  // Get total count
  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(catalogItems)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .get();

  return {
    items,
    total: countResult?.count || 0,
    limit: options.limit || 50,
    offset: options.offset || 0,
  };
}

export async function getCatalogItemWithLinks(id: string): Promise<CatalogItemWithLinks | null> {
  const db = getDb();
  const item = db.select().from(catalogItems).where(eq(catalogItems.id, id)).get();
  if (!item) return null;

  const links = db
    .select()
    .from(downloadLinks)
    .where(eq(downloadLinks.catalogItemId, id))
    .all();

  return { item, links };
}

export async function getDistinctValues(column: "publisher" | "series" | "format" | "language") {
  const db = getDb();

  const colMap = {
    publisher: catalogItems.publisher,
    series: catalogItems.series,
    format: catalogItems.format,
    language: catalogItems.language,
  };

  const results = db
    .select({ value: colMap[column] })
    .from(catalogItems)
    .where(sql`${colMap[column]} IS NOT NULL`)
    .groupBy(colMap[column])
    .orderBy(colMap[column])
    .all();

  return results.map((r) => r.value).filter(Boolean);
}
