import Parser from "rss-parser";
import { request } from "undici";
import type {
  ProviderAdapter,
  ProviderInspectionResult,
  DownloadRequest,
  DownloadResult,
  NormalizedItem,
  NormalizedDownloadLink,
} from "../types";

const parser = new Parser({
  timeout: 30000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
});

/** Find a `<link rel="next" href="..." />` or `<atom:link rel="next" href="..." />` in raw XML */
function findNextLink(xml: string): string | null {
  // Match atom:link with rel="next" and extract href
  const atomMatch = xml.match(/<atom:link[^>]*rel="next"[^>]*href="([^"]+)"/i);
  if (atomMatch) return atomMatch[1];

  // Match atom:link with rel='next' and extract href
  const atomMatch2 = xml.match(/<atom:link[^>]*rel='next'[^>]*href='([^']+)'/i);
  if (atomMatch2) return atomMatch2[1];

  // Match standard <link> with rel="next" RSS 2.0 style: <link rel="next">URL</link>
  const rssMatch = xml.match(/<link[^>]*rel="next"[^>]*>([^<]+)<\/link>/i);
  if (rssMatch) return rssMatch[1];

  // Match <link> with rel="next" and href (XHTML style)
  const rssMatch2 = xml.match(/<link[^>]*rel='next'[^>]*>([^<]+)<\/link>/i);
  if (rssMatch2) return rssMatch2[1];

  // Match self-closing <link rel="next" href="..." />
  const selfClosing = xml.match(/<link[^>]*rel="next"[^>]*href="([^"]+)"[^>]*\/?>/i);
  if (selfClosing) return selfClosing[1];

  return null;
}

/** Fetch a single RSS/Atom feed page and return parsed items + pagination info */
async function fetchFeedPage(
  url: string,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<{ items: NormalizedItem[]; title: string; nextUrl: string | null }> {
  const resp = await request(url, {
    method: "GET",
    signal: options?.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      ...options?.headers,
    },
  });

  const xml = await resp.body.text();
  const feed = await parser.parseString(xml);

  // Follow explicit <link rel="next"> if present
  const nextUrl: string | null = findNextLink(xml);

  const items: NormalizedItem[] = feed.items.map((item) => {
    const title = item.title || "Untitled";
    const content = item.content || item.contentSnippet || item.summary || "";

    // Try to extract useful metadata from content
    const sizeMatch = content.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB))/i);
    const publisherMatch = content.match(
      /(DC|Marvel|Image|Dark\s*Horse|Boom|IDW|Dynamite|Valiant|Vertigo|Rebellion|Aftershock|Vault|Abstract)/i
    );

    // Extract links from content
    const downloadLinks: NormalizedDownloadLink[] = [];
    const linkMatch = content.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g);
    for (const match of linkMatch) {
      const linkUrl = match[1];
      const linkText = match[2].trim();
      if (
        linkUrl.match(/mega\.nz|mediafire|zippyshare|dropbox|google/i) ||
        linkText.toLowerCase().includes("download")
      ) {
        const urlLower = linkUrl.toLowerCase();
        let provider = "Unknown";
        if (urlLower.includes("mega.nz")) provider = "Mega";
        else if (urlLower.includes("mediafire")) provider = "MediaFire";
        else if (urlLower.includes("zippyshare")) provider = "ZippyShare";
        else if (urlLower.includes("dropbox")) provider = "Dropbox";
        else provider = "Direct Link";

        downloadLinks.push({
          provider,
          fileName: linkText.length <= 100 ? linkText : undefined,
          url: linkUrl,
          linkType: "redirect",
          directDownloadCapable: urlLower.includes("mega.nz") || urlLower.includes("dropbox"),
          manualActionRequired: !urlLower.includes("mega.nz") && !urlLower.includes("dropbox"),
        });
      }
    }

    return {
      sourceId: "rss",
      title,
      description: content.slice(0, 1000),
      detailUrl: item.link || url,
      coverUrl: extractImage(item["content:encoded"] || item.content || ""),
      releaseDate: item.isoDate || item.pubDate,
      publisher: publisherMatch?.[1],
      fileSize: sizeMatch?.[1],
      downloadLinks,
    };
  });

  return {
    items,
    title: feed.title || "RSS Feed",
    nextUrl,
  };
}

export const rssProvider: ProviderAdapter = {
  id: "rss",
  name: "RSS/Atom Feed",
  canHandle(_url: string) {
    return true; // Handles any URL that might be a feed
  },

  async inspect(url: string, options?: { signal?: AbortSignal; maxPages?: number; headers?: Record<string, string> }): Promise<ProviderInspectionResult> {
    const maxPages = options?.maxPages ?? 10;
    let currentUrl: string | null = url;
    let pageCount = 0;
    let feedTitle = "RSS Feed";
    const allItems: NormalizedItem[] = [];

    while (currentUrl && pageCount < maxPages) {
      pageCount++;
      const result = await fetchFeedPage(currentUrl, options);

      if (pageCount === 1) feedTitle = result.title;
      allItems.push(...result.items);

      // Stop if no more pages
      currentUrl = result.nextUrl;

      // If the current page had no items, don't bother fetching more
      if (result.items.length === 0) break;
    }

    return {
      title: feedTitle,
      items: allItems,
    };
  },

  async download(_request: DownloadRequest): Promise<DownloadResult> {
    return { success: false, error: "RSS provider does not support direct downloads" };
  },
};

export function extractImage(content: string): string | undefined {
  const match = content.match(/<img[^>]+src="([^"]+)"/);
  return match?.[1] || undefined;
}
