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
import { fetchViaFlareSolverr, isFlareSolverrConfigured } from "../flaresolverr";
import { fetchViaPlaywright } from "../playwright-bypass";
import { fetchViaCurlCffi, isCurlCffiConfigured } from "../curl-cffi";

const BASE_URL = "https://zipcomic.com";

export const zipcomicProvider: ProviderAdapter = {
  id: "zipcomic",
  name: "ZipComic",
  canHandle(url: string) {
    return url.includes("zipcomic.com");
  },

  async inspect(
    url: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string> }
  ): Promise<ProviderInspectionResult> {
    try {
      let html = await fetchPage(url, options);

      // Check if Cloudflare is blocking us
      const isCloudflareBlocked = isCloudflareChallenge(html);

      if (isCloudflareBlocked) {
        // Layer 1: curl_cffi sidecar — lightweight TLS fingerprint impersonation.
        // This is preferred because it's fast and doesn't require a full browser.
        if (isCurlCffiConfigured()) {
          const curlCffiHtml = await fetchViaCurlCffi(url, { signal: options?.signal });
          if (curlCffiHtml && !isCloudflareChallenge(curlCffiHtml)) {
            html = curlCffiHtml;
          }
        }

        if (isCloudflareChallenge(html)) {
          // Layer 2: Playwright — full headless browser with stealth plugin.
          // This runs JS and can solve Turnstile challenges.
          const playwrightHtml = await fetchViaPlaywright(url, { signal: options?.signal });
          if (playwrightHtml && !isCloudflareChallenge(playwrightHtml)) {
            html = playwrightHtml;
          } else if (isFlareSolverrConfigured()) {
            // Layer 3: FlareSolverr — headless browser proxy (heavy, Docker-only).
            const solved = await fetchViaFlareSolverr(url, { signal: options?.signal });
            if (!solved) {
              return {
                title: "ZipComic",
                items: [],
                error: "Neither curl_cffi, Playwright, nor FlareSolverr could solve the Cloudflare challenge for ZipComic.",
              };
            }
            html = solved;
          } else {
            return {
              title: "ZipComic",
              items: [],
              error:
                "ZipComic is behind Cloudflare protection. " +
                "curl_cffi and Playwright both failed — set FLARESOLVERR_URL for an additional fallback " +
                "(see docker-compose.yml), or open the site in your browser to browse manually.",
            };
          }
        }
      }

      const isDetailPage = html.includes("dlid=") || html.includes("download") || !html.includes("class='tableborder'");

      if (isDetailPage || url.includes("dlid=") || url.includes("/comic/")) {
        return scrapeDetailPage(url, html, options);
      }
      return scrapeListingPage(url, html, options);
    } catch (err: any) {
      return {
        title: "ZipComic",
        items: [],
        error: `Failed to fetch ZipComic: ${err.message}. The site may be behind Cloudflare.`,
      };
    }
  },

  async download(_downloadReq: DownloadRequest): Promise<DownloadResult> {
    return {
      success: false,
      error:
        "ZipComic downloads require manual interaction in the browser — open the comic page to download manually.",
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
 * Scrape a listing page (homepage, category, or search results).
 */
/** Detect Cloudflare challenge pages as defense-in-depth (top-level check in inspect() should catch these). */
function isCloudflareChallenge(html: string): boolean {
  return (
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("__cf_chl") ||
    html.length < 500
  );
}

async function scrapeListingPage(
  url: string,
  html: string,
  _options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  // Defense-in-depth: reject CF challenge pages even if top-level check missed them
  if (isCloudflareChallenge(html)) {
    return {
      title: "ZipComic",
      items: [],
      error: "ZipComic is behind Cloudflare protection. Set FLARESOLVERR_URL to enable bypass.",
    };
  }

  const $ = cheerio.load(html);
  const items: NormalizedItem[] = [];
  const seenUrls = new Set<string>();

  // Try multiple common listing patterns
  // Pattern 1: Article/grid entries (common in WordPress-like themes)
  $("article, .post, .entry, .comic-item, .comic-grid-item, li > a[href]").each((_, el) => {
    const $el = $(el);
    const link = $el.is("a") ? $el : $el.find("a[href]").first();
    const href = link.attr("href");
    if (!href) return;

    const title =
      $el.find("h2, h3, h4, .title, .post-title, .entry-title").first().text().trim() ||
      link.text().trim() ||
      link.attr("title") ||
      "";

    if (!title || title.length < 3 || seenUrls.has(href)) return;
    seenUrls.add(href);

    const coverUrl =
      $el.find("img").first().attr("src") ||
      $el.find("img").first().attr("data-src") ||
      $el.find("img").first().attr("data-lazy-src");

    // Skip non-comic links (nav, tags, etc.)
    if (href.includes("/tag/") || href.includes("/category/") || href === "/") return;

    items.push({
      sourceId: "zipcomic",
      title,
      detailUrl: href.startsWith("http") ? href : `https://zipcomic.com${href.startsWith("/") ? href : `/${href}`}`,
      coverUrl: coverUrl
        ? coverUrl.startsWith("http")
          ? coverUrl
          : `https://zipcomic.com${coverUrl.startsWith("/") ? coverUrl : `/${coverUrl}`}`
        : undefined,
      downloadLinks: [],
    });
  });

  // Pattern 2: Simple link listings (table-based or list-based)
  if (items.length === 0) {
    $("a[href]").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const text = $el.text().trim();

      if (!text || text.length < 5 || seenUrls.has(href)) return;

      // Skip navigation links
      if (
        href === "/" ||
        href.includes("/page/") ||
        href.includes("/tag/") ||
        href.includes("/category/") ||
        href.startsWith("#")
      )
        return;

      // Only include links that look like comic entries (not menu items)
      const parent = $el.parent();
      const inList = parent.is("li") || parent.is("td");
      if (!inList && items.length === 0) {
        // If not in a list, still include it if it has substantial text
        const grandparent = parent.parent();
        if (!grandparent.is("ul") && !grandparent.is("ol") && !grandparent.is("table")) return;
      }

      seenUrls.add(href);

      const coverImg = $el.closest("li, td, div").find("img").first();
      const coverUrl = coverImg.attr("src") || coverImg.attr("data-src");

      items.push({
        sourceId: "zipcomic",
        title: text,
        detailUrl: href.startsWith("http") ? href : `https://zipcomic.com${href.startsWith("/") ? href : `/${href}`}`,
        coverUrl: coverUrl
          ? coverUrl.startsWith("http")
            ? coverUrl
            : `https://zipcomic.com${coverUrl.startsWith("/") ? coverUrl : `/${coverUrl}`}`
          : undefined,
        downloadLinks: [],
      });
    });
  }

  return {
    title: `ZipComic - ${url.split("/").pop() || "home"}`,
    items,
  };
}

/**
 * Scrape a detail/comic page for full metadata.
 */
async function scrapeDetailPage(
  url: string,
  html: string,
  _options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  // Defense-in-depth: reject CF challenge pages even if top-level check missed them
  if (isCloudflareChallenge(html)) {
    return {
      title: "ZipComic",
      items: [],
      error: "ZipComic is behind Cloudflare protection. Set FLARESOLVERR_URL to enable bypass.",
    };
  }

  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $(".entry-title, .post-title, .comic-title").first().text().trim() ||
    $("title").text().trim() ||
    "ZipComic Detail";

  // Cover image
  let coverUrl: string | undefined;
  $("img").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");
    const cls = $el.attr("class") || "";
    const width = parseInt($el.attr("width") || "0", 10);
    if (
      src &&
      !src.includes("logo") &&
      !src.includes("banner") &&
      !src.includes("avatar") &&
      !src.includes("icon") &&
      (width > 100 || cls.includes("cover") || cls.includes("thumb") || cls.includes("poster"))
    ) {
      coverUrl = src.startsWith("http") ? src : `https://zipcomic.com${src}`;
      return false; // break
    }
  });

  // Description
  let description = "";
  $(".entry-content, .post-content, .comic-description, .description, article")
    .first()
    .find("p")
    .each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 30 && !text.toLowerCase().includes("download")) {
        description = text.slice(0, 500);
        return false; // break
      }
    });

  // Download links
  const downloadLinks: NormalizedDownloadLink[] = [];
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const text = $el.text().trim().toLowerCase();

    const isDownload =
      text.includes("download") ||
      text.includes("mega") ||
      text.includes("mediafire") ||
      text.includes("zippyshare") ||
      text.includes("dropbox") ||
      text.includes("pdf") ||
      text.includes("cbr") ||
      text.includes("cbz") ||
      href.includes("download") ||
      href.match(/mega\.nz|mediafire|zippyshare|dropbox|google/i) ||
      href.match(/\.(cbr|cbz|pdf|zip|rar)$/i);

    if (!isDownload) return;

    const urlLower = href.toLowerCase();
    let provider = "ZipComic";
    if (urlLower.includes("mega.nz")) provider = "Mega";
    else if (urlLower.includes("mediafire")) provider = "MediaFire";
    else if (urlLower.includes("zippyshare")) provider = "ZippyShare";
    else if (urlLower.includes("dropbox")) provider = "Dropbox";
    else if (urlLower.includes("google")) provider = "Google Drive";

    // Check if it's a direct file link
    const isDirectFile = !!href.match(/\.(cbr|cbz|pdf|zip|rar)(\?|$)/i);

    downloadLinks.push({
      provider,
      fileName: $el.text().trim() || undefined,
      url: href,
      linkType: isDirectFile ? "direct" : "redirect",
      directDownloadCapable: isDirectFile || urlLower.includes("mega.nz") || urlLower.includes("dropbox"),
      manualActionRequired: !isDirectFile && !urlLower.includes("mega.nz") && !urlLower.includes("dropbox"),
    });
  });

  const item: NormalizedItem = {
    sourceId: "zipcomic",
    title,
    description: description || undefined,
    coverUrl,
    detailUrl: url,
    downloadLinks,
  };

  return {
    title,
    items: [item],
  };
}
