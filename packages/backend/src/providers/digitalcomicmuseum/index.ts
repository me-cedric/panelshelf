import * as cheerio from "cheerio";
import { request } from "undici";
import type {
  ProviderAdapter,
  ProviderInspectionResult,
  DownloadRequest,
  DownloadResult,
  NormalizedItem,
  NormalizedDownloadLink,
} from "../types";

const BASE_URL = "https://www.digitalcomicmuseum.com";

// ── Category cache ──

const CATEGORIES_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface DcmCategory {
  id: string;
  name: string;
}

let categoriesCache: { categories: DcmCategory[]; cachedAt: number } | null = null;

/**
 * Scrape the DCM homepage for all publisher categories (cid links).
 * Categories are listed in a <select> dropdown on the homepage.
 * Results are cached for 30 minutes.
 */
export async function scrapeDcmCategories(options?: { signal?: AbortSignal }): Promise<DcmCategory[]> {
  if (categoriesCache && Date.now() - categoriesCache.cachedAt < CATEGORIES_CACHE_TTL_MS) {
    return categoriesCache.categories;
  }

  const html = await fetchPage(BASE_URL, options);
  const $ = cheerio.load(html);

  const categories: DcmCategory[] = [];

  // Parse the <select> dropdown which lists all publisher categories
  // Format: <option value=/index.php?cid=98>Ace Magazines</option>
  $("select option").each((_, el) => {
    const $el = $(el);
    const value = $el.attr("value") || "";
    const cidMatch = value.match(/cid=(\d+)/);
    if (cidMatch) {
      categories.push({
        id: cidMatch[1],
        name: $el.text().trim(),
      });
    }
  });

  categoriesCache = { categories, cachedAt: Date.now() };
  return categories;
}

/** Clear cached categories (e.g., on source refresh). */
export function clearDcmCategoryCache(): void {
  categoriesCache = null;
}

// ── Search ──

/** Number of concurrent detail-page fetches when enriching search results with covers. */
const SEARCH_COVER_CONCURRENCY = 8;

/** Maximum number of search results to enrich with covers (avoids excessive detail-page fetches). */
const SEARCH_COVER_MAX_ITEMS = 50;

/** Timeout per detail-page cover fetch (ms). */
const COVER_FETCH_TIMEOUT_MS = 5000;

/**
 * Extract a cover image URL from a detail page's already-loaded cheerio instance.
 * Shared by scrapeDetailPage and fetchCoverFromDetailPage.
 */
function extractCoverFromHtml($: cheerio.CheerioAPI): string | undefined {
  // Primary: look for the cover image inside tr.mainrow td
  const coverImg = $("tr.mainrow td img").first();
  if (coverImg.length && coverImg.attr("src")) {
    const src = coverImg.attr("src")!;
    if (!src.includes("go.gif") && !src.includes("spacer") && !src.includes("folder")) {
      return src.startsWith("http") ? src : `${BASE_URL}${src}`;
    }
  }

  // Fallback: any substantial image with a real image extension
  let fallback: string | undefined;
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && !src.includes("go.gif") && !src.includes("spacer") && src.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
      fallback = src.startsWith("http") ? src : `${BASE_URL}${src}`;
      return false;
    }
  });
  return fallback;
}

/**
 * Fetch just the cover image URL from a DCM detail page.
 * Uses the shared extractCoverFromHtml helper (same logic as scrapeDetailPage).
 */
async function fetchCoverFromDetailPage(dlid: string): Promise<string | undefined> {
  const url = `${BASE_URL}/index.php?dlid=${dlid}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COVER_FETCH_TIMEOUT_MS);

    const resp = await request(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timeout);

    const html = await resp.body.text();
    const $ = cheerio.load(html);
    return extractCoverFromHtml($);
  } catch (err) {
    // Individual cover fetch failure is non-fatal — return undefined
    return undefined;
  }
}

/**
 * Fetch covers concurrently for up to SEARCH_COVER_MAX_ITEMS items.
 * Mutates each item's coverUrl in place. Uses a worker pool with SEARCH_COVER_CONCURRENCY workers.
 */
async function enrichItemsWithCovers(items: NormalizedItem[]): Promise<void> {
  if (items.length === 0) return;

  // Cap to avoid excessive detail-page fetches for large result sets
  const queue = items.slice(0, SEARCH_COVER_MAX_ITEMS);

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()!;
      // Extract dlid from the detailUrl (e.g., ".../index.php?dlid=7737")
      const dlidMatch = item.detailUrl?.match(/dlid=(\d+)/);
      if (dlidMatch) {
        const coverUrl = await fetchCoverFromDetailPage(dlidMatch[1]);
        if (coverUrl) {
          item.coverUrl = coverUrl;
        }
      }
    }
  }

  // Spin up workers up to concurrency limit
  const workers = Array.from({ length: Math.min(SEARCH_COVER_CONCURRENCY, queue.length) }, () => worker());
  await Promise.all(workers);
}

/**
 * Search DCM by posting to the internal search endpoint.
 * DCM uses: POST index.php?ACT=dosearch with a `terms` field.
 * Results are returned as an HTML table with rows containing:
 *   <td><a href='index.php?dlid=X'>Title</a></td>
 *   <td><div align='center'>Publisher</div></td>
 *
 * Cover thumbnails are not included in search results — we fetch them
 * from each comic's detail page concurrently (up to 8 at a time).
 */
export async function searchDcm(terms: string): Promise<NormalizedItem[]> {
  const resp = await request(`${BASE_URL}/index.php?ACT=dosearch`, {
    method: "POST",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    body: new URLSearchParams({ terms }).toString(),
  });

  const html = await resp.body.text();
  const $ = cheerio.load(html);

  const items: NormalizedItem[] = [];
  const seenDlids = new Set<string>();

  // Search results are in a <tbody> with <tr> rows, each containing:
  //   <td><a href='index.php?dlid=X'>Title</a></td>
  //   <td><div align='center'>Publisher</div></td>
  $("tbody tr").each((_, row) => {
    const $row = $(row);
    const linkCell = $row.find("td").first();
    const link = linkCell.find("a[href*='dlid=']");
    if (!link.length) return;

    const href = link.attr("href") || "";
    const title = link.text().trim();
    if (!title || title.length < 2) return;

    const dlidMatch = href.match(/[?&]dlid=(\d+)/);
    if (!dlidMatch) return;
    const dlid = dlidMatch[1];
    if (seenDlids.has(dlid)) return;
    seenDlids.add(dlid);

    // Publisher is in the second column
    const pubCell = $row.find("td").eq(1);
    const publisher = pubCell.text().trim() || undefined;

    // Upload date is in the fourth column
    const dateCell = $row.find("td").eq(3);
    const dateText = dateCell.text().trim();
    let releaseDate: string | undefined;
    if (dateText) {
      // Format: "30-January-2007 10:10 am"
      const parsed = Date.parse(dateText);
      if (!isNaN(parsed)) {
        releaseDate = new Date(parsed).toISOString().split("T")[0];
      }
    }

    items.push({
      sourceId: "digitalcomicmuseum",
      title,
      detailUrl: `https://www.digitalcomicmuseum.com/index.php?dlid=${dlid}`,
      publisher,
      releaseDate,
      downloadLinks: [],
    });
  });

  // Enrich results with cover thumbnails from detail pages
  if (items.length > 0) {
    await enrichItemsWithCovers(items);
  }

  return items;
}

export const digitalComicMuseumProvider: ProviderAdapter = {
  id: "digitalcomicmuseum",
  name: "Digital Comic Museum",
  canHandle(url: string) {
    return url.includes("digitalcomicmuseum.com");
  },

  async inspect(
    url: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string>; maxPages?: number }
  ): Promise<ProviderInspectionResult> {
    const hasDlid = /[?&]dlid=/i.test(url);
    const hasCid = /[?&]cid=/i.test(url);
    const isHomepage =
      !hasDlid && !hasCid && (url === BASE_URL || url === `${BASE_URL}/` || url === `${BASE_URL}/index.php`);

    if (hasDlid) {
      return scrapeDetailPage(url, options);
    }
    // Use paginated (multi-category) fetch during refresh when maxPages > 1
    if (options?.maxPages && options.maxPages > 1 && (hasCid || isHomepage)) {
      return scrapeDcmListingPaginated(url, options);
    }
    if (hasCid || isHomepage) {
      return scrapeListingPage(url, options);
    }
    // Treat as listing page by default
    return scrapeListingPage(url, options);
  },

  async download(_downloadReq: DownloadRequest): Promise<DownloadResult> {
    return {
      success: false,
      error: "Digital Comic Museum requires a registered account for direct downloads — open the detail page in your browser to download manually.",
    };
  },
};

async function fetchPage(url: string, options?: { signal?: AbortSignal; headers?: Record<string, string> }) {
  const resp = await request(url, {
    method: "GET",
    signal: options?.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...options?.headers,
    },
  });
  return await resp.body.text();
}

/**
 * Paginate through multiple DCM categories during source refresh.
 * DCM doesn't have page-based pagination per category — each category
 * page shows ALL items for that publisher. To ingest more than ~50 items
 * (the homepage limit), we scrape the homepage first, then iterate through
 * additional publisher categories discovered from the dropdown.
 *
 * With maxPages=5: homepage + 4 publisher categories = potentially hundreds of items.
 */
async function scrapeDcmListingPaginated(
  url: string,
  options?: { signal?: AbortSignal; headers?: Record<string, string>; maxPages?: number }
): Promise<ProviderInspectionResult> {
  const maxCategories = options?.maxPages ?? 1;
  if (maxCategories < 1) {
    return { title: "Digital Comic Museum", items: [] };
  }

  // Step 1: Scrape the homepage (or provided URL) first
  const homeResult = await scrapeListingPage(url, options);
  const allItems: NormalizedItem[] = [...homeResult.items];
  let lastError = homeResult.error;

  // Step 2: If maxPages > 1, discover all category IDs and scrape additional categories
  if (maxCategories > 1 && !options?.signal?.aborted) {
    try {
      const categories = await scrapeDcmCategories({ signal: options?.signal });
      const extraCategories = Math.min(categories.length, maxCategories - 1);

      for (let i = 0; i < extraCategories; i++) {
        if (options?.signal?.aborted) break;

        const cat = categories[i];
        try {
          const catUrl = `${BASE_URL}/index.php?cid=${cat.id}`;
          const result = await scrapeListingPage(catUrl, options);
          allItems.push(...result.items);

          // Rate-limit between categories to be polite to the server
          if (i < extraCategories - 1) {
            await new Promise((r) => setTimeout(r, 500));
          }
        } catch (err: any) {
          console.error(`[DCM] Error fetching category "${cat.name}" (cid=${cat.id}):`, err.message);
          lastError = `Failed to fetch category ${cat.name}: ${err.message}`;
          // Continue with next category on error
        }
      }
    } catch (err: any) {
      console.error(`[DCM] Error discovering categories:`, err.message);
      lastError = `Category discovery failed: ${err.message}`;
    }
  }

  return {
    title: homeResult.title,
    items: allItems,
    error: lastError,
  };
}

/**
 * Scrape a listing page (category or homepage) for comic entries.
 *
 * Handles both:
 * - Category pages (index.php?cid=X) — full listing with covers
 * - Homepage — latest uploads block
 */
async function scrapeListingPage(
  url: string,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  const html = await fetchPage(url, options);
  const $ = cheerio.load(html);

  // Extract title from breadcrumb or page heading
  let title = "Digital Comic Museum";
  const catName = $("div#catname").first().text().trim();
  if (catName) title = catName;

  const items: NormalizedItem[] = [];
  const seenDlids = new Set<string>();

  // Strategy 1: Scrape comic entries from category listing pages
  // Entries are in <div class='tableborder'> with a cover image and title
  $("div.tableborder").each((_, section) => {
    const $section = $(section);

    // Try to find a cover thumbnail — DCM uses class "thumb" inside a div with numeric ID
    const coverImg = $section.find("img.thumb").first();
    const coverUrl = coverImg.attr("src")
      ? coverImg.attr("src")!.startsWith("http")
        ? coverImg.attr("src")!
        : `https://www.digitalcomicmuseum.com${coverImg.attr("src")!}`
      : undefined;

    // Look for title links inside the section
    $section.find("a[href*='dlid=']").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const text = $el.text().trim();
      if (!text || text.length < 2) return;

      // Extract dlid
      const dlidMatch = href.match(/[?&]dlid=(\d+)/);
      if (!dlidMatch) return;
      const dlid = dlidMatch[1];
      if (seenDlids.has(dlid)) return;
      seenDlids.add(dlid);

      const detailUrl = `https://www.digitalcomicmuseum.com/index.php?dlid=${dlid}`;

      // Try to find a cover specific to this entry
      // Covers are in sibling divs with numeric IDs
      let entryCover = coverUrl;
      if (!entryCover) {
        // Look for img.thumb in the same tableborder
        const sectionCover = $section.find("img.thumb").first().attr("src");
        if (sectionCover) {
          entryCover = sectionCover.startsWith("http")
            ? sectionCover
            : `https://www.digitalcomicmuseum.com${sectionCover}`;
        }
      }

      items.push({
        sourceId: "digitalcomicmuseum",
        title: text,
        detailUrl,
        coverUrl: entryCover,
        downloadLinks: [],
      });
    });
  });

  // Strategy 2: If no entries found with tableborder pattern, look for latest uploads on homepage
  if (items.length === 0) {
    // Look for links in the latest uploads tables
    $("a[href*='dlid=']").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const text = $el.text().trim();
      if (!text || text.length < 2) return;

      const dlidMatch = href.match(/[?&]dlid=(\d+)/);
      if (!dlidMatch) return;
      const dlid = dlidMatch[1];
      if (seenDlids.has(dlid)) return;
      seenDlids.add(dlid);

      const detailUrl = `https://www.digitalcomicmuseum.com/index.php?dlid=${dlid}`;

      // Try to find a nearby cover image
      let entryCover: string | undefined;
      const parentCell = $el.closest("td");
      const img = parentCell.find("img").first();
      if (img.length && img.attr("src") && !img.attr("src")?.includes("go.gif") && !img.attr("src")?.includes("folder")) {
        const src = img.attr("src")!;
        entryCover = src.startsWith("http") ? src : `https://www.digitalcomicmuseum.com${src}`;
      }

      items.push({
        sourceId: "digitalcomicmuseum",
        title: text,
        detailUrl,
        coverUrl: entryCover,
        downloadLinks: [],
      });
    });
  }

  return {
    title: title || "Digital Comic Museum",
    items,
  };
}

/**
 * Scrape a detail page (index.php?dlid=X) for full comic metadata and download links.
 */
async function scrapeDetailPage(
  url: string,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  const html = await fetchPage(url, options);
  const $ = cheerio.load(html);

  // Title
  const title = $("div#catname").first().text().trim() || "Digital Comic Museum Detail";

  // Cover image — uses shared extraction helper
  const coverUrl = extractCoverFromHtml($);

  // Extract metadata from mainrow tables
  const metadata: Record<string, string> = {};
  $("tr.mainrow").each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");
    if (cells.length >= 2) {
      const label = $(cells[0]).text().trim().replace(/:$/, "").toLowerCase();
      const value = $(cells[1]).text().trim();
      if (label && value && !label.includes("&nbsp")) {
        metadata[label] = value;
      }
    }
  });

  const fileSize = metadata["filesize"] || undefined;

  // Extract description
  let description = "";
  $("div#catname").each((_, el) => {
    const $el = $(el);
    if ($el.text().trim() === "Description") {
      // The description content is in the next sibling table
      const descTable = $el.next("table");
      if (descTable.length) {
        description = descTable.text().trim().slice(0, 1000);
      }
    }
  });

  // Extract GCD (Grand Comics Database) information for publisher/year/series
  let publisher: string | undefined;
  let releaseDate: string | undefined;
  let series: string | undefined;

  $("div#catname").each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text.includes("Grand Comic Database") || text.includes("GCD")) {
      // Next sibling table has GCD info
      const gcdTable = $el.next("table");
      if (gcdTable.length) {
        const gcdText = gcdTable.text();
        // Extract publisher
        const pubMatch = gcdText.match(/Publisher\s*[:\s]+([^\n]+)/i);
        if (pubMatch) publisher = pubMatch[1].trim();

        // Extract year from date
        const dateMatch = gcdText.match(/(?:Published|Date)\s*[:\s]+([^\n]+)/i);
        if (dateMatch) {
          const yearMatch = dateMatch[1].match(/(\d{4})/);
          if (yearMatch) releaseDate = yearMatch[1];
        }

        // Extract series/issue
        const seriesMatch = gcdText.match(/Series\s*[:\s]+([^\n]+)/i);
        if (seriesMatch) series = seriesMatch[1].trim();
      }
    }
  });

  // Fallback: try to extract publisher from category breadcrumbs
  if (!publisher) {
    const navText = $("span.nav").text();
    // Look for known publisher patterns in breadcrumbs
    const knownPublishers = [
      "Ace Magazines", "Archie", "Avon Periodicals", "Better Publications",
      "Charlton Comics", "Columbia Comics", "DC Comics", "Dell Comics",
      "Eastern Color", "EC Comics", "Fawcett Comics", "Fox Comics",
      "Gillmor Magazines", "Gold Key", "Harvey Comics", "Hillman Periodicals",
      "Holyoke Publishing", "I. W. Publications", "Lev Gleason", "Marvel Comics",
      "Mainline Publications", "National Comics", "Nedor Comics", "Novelty Press",
      "Prize Publications", "Quality Comics", "Standard Comics", "St. John Publications",
      "Street and Smith", "Timely Comics", "Toby Press", "United Feature Syndicate",
      "Victor Publications", "Western Publishing", "Ziff-Davis",
    ];
    for (const pub of knownPublishers) {
      if (navText.includes(pub)) {
        publisher = pub;
        break;
      }
    }
  }

  // Extract format from title or details
  let format: string | undefined;
  const titleLower = title.toLowerCase();
  if (titleLower.includes("cbr") || titleLower.endsWith(".cbr")) format = "CBR";
  else if (titleLower.includes("cbz") || titleLower.endsWith(".cbz")) format = "CBZ";
  else if (titleLower.includes("pdf") || titleLower.endsWith(".pdf")) format = "PDF";

  // Extract tags
  const tags: string[] = [];
  if (publisher) tags.push(publisher);

  // Look for download links
  const downloadLinks: NormalizedDownloadLink[] = [];

  // Check if download is available (guest or member)
  const guestImg = $("img[src*='download_guest']");
  if (guestImg.length > 0) {
    // Guest users see a "login required" image instead of download link
    // Provide the detail page URL so users can open it in browser
    downloadLinks.push({
      provider: "DCM (Login Required)",
      fileName: `${title}.cbr`,
      url,
      linkType: "manual",
      directDownloadCapable: false,
      manualActionRequired: true,
    });
  }

  // Look for actual download links (for authenticated users)
  $("a[href*='download.php'], a[href*='dld=$']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const text = $el.text().trim();

    let fileUrl = href;
    if (!fileUrl.startsWith("http")) {
      fileUrl = `https://www.digitalcomicmuseum.com/${fileUrl.replace(/^\//, "")}`;
    }

    downloadLinks.push({
      provider: "DCM Direct",
      fileName: text || undefined,
      url: fileUrl,
      linkType: "direct",
      directDownloadCapable: true,
      manualActionRequired: false,
    });
  });

  const item: NormalizedItem = {
    sourceId: "digitalcomicmuseum",
    title,
    series,
    publisher,
    releaseDate,
    format,
    fileSize,
    description: description || undefined,
    coverUrl,
    detailUrl: url,
    tags: tags.length > 0 ? tags : undefined,
    downloadLinks,
  };

  return {
    title,
    items: [item],
  };
}
