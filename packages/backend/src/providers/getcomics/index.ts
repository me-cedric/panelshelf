import * as cheerio from "cheerio";
import { request } from "undici";
import { v4 as uuid } from "uuid";
import type {
  ProviderAdapter,
  ProviderInspectionResult,
  DownloadRequest,
  DownloadResult,
  NormalizedItem,
  NormalizedDownloadLink,
} from "../types";

const BASE_URL = "https://getcomics.org";

export const getcomicsProvider: ProviderAdapter = {
  id: "getcomics",
  name: "GetComics",
  canHandle(url: string) {
    return url.includes("getcomics.org");
  },

  async inspect(
    url: string,
    options?: { signal?: AbortSignal; rateLimitMs?: number; headers?: Record<string, string> }
  ): Promise<ProviderInspectionResult> {
    const isListPage =
      url === BASE_URL ||
      url === `${BASE_URL}/` ||
      url.includes("/page/") ||
      url.includes("/category/") ||
      url.includes("/tag/");

    if (isListPage) {
      return scrapeListPage(url, options);
    }
    return scrapeDetailPage(url, options);
  },

  async download(downloadReq: DownloadRequest): Promise<DownloadResult> {
    try {
      const resp = await request(downloadReq.url, {
        method: "GET",
        signal: downloadReq.signal,
      });

      const contentLength = resp.headers["content-length"];
      const totalBytes = contentLength ? parseInt(String(contentLength), 10) : undefined;

      // Stream to file
      const fs = await import("node:fs");
      const filePath = downloadReq.destinationPath;

      const writeStream = fs.createWriteStream(filePath);
      const reader = resp.body;

      let downloadedBytes = 0;

      for await (const chunk of reader) {
        writeStream.write(chunk);
        downloadedBytes += chunk.length;
        downloadReq.onProgress?.(downloadedBytes, totalBytes);
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end();
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      return { success: true, filePath, totalBytes };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return { success: false, error: "Download cancelled" };
      }
      return { success: false, error: err.message };
    }
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

function extractDownloadLinks($: cheerio.CheerioAPI, $content: cheerio.Cheerio<any>): NormalizedDownloadLink[] {
  const links: NormalizedDownloadLink[] = [];

  // Find download buttons/links - common patterns on getcomics
  $content.find("a").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;

    const text = $el.text().trim().toLowerCase();
    const classes = $el.attr("class") || "";
    const isDownload =
      text.includes("download") ||
      text.includes("mega") ||
      text.includes("mediafire") ||
      text.includes("zippyshare") ||
      text.includes("mirror") ||
      text.includes("get") ||
      classes.includes("download") ||
      $el.parent().text().toLowerCase().includes("download");

    if (!isDownload && !href.match(/mega\.nz|mediafire|zippyshare|dropbox|google/i)) return;

    const urlLower = href.toLowerCase();
    let linkType: NormalizedDownloadLink["linkType"] = "redirect";
    let directDownloadCapable = false;
    let manualActionRequired = true;

    if (urlLower.includes("mega.nz")) {
      linkType = "redirect";
      directDownloadCapable = true;
      manualActionRequired = false;
    } else if (urlLower.includes("mediafire.com")) {
      linkType = "redirect";
      directDownloadCapable = false;
      manualActionRequired = true;
    } else if (urlLower.includes("dropbox.com")) {
      linkType = "redirect";
      directDownloadCapable = true;
      manualActionRequired = false;
    } else if (urlLower.startsWith("http") && !urlLower.includes("getcomics.org")) {
      linkType = "redirect";
      directDownloadCapable = false;
      manualActionRequired = true;
    } else if (href.startsWith("/") || urlLower.includes("getcomics.org")) {
      linkType = "manual";
      directDownloadCapable = false;
      manualActionRequired = true;
    }

    // Extract provider name from title attribute first (most reliable), then text, then URL
    const titleAttr = ($el.attr("title") || "").trim();
    let provider = titleAttr || $el.text().trim() || "Unknown";

    if (urlLower.includes("mega.nz")) provider = "Mega";
    else if (urlLower.includes("mediafire")) provider = "MediaFire";
    else if (urlLower.includes("zippyshare")) provider = "ZippyShare";
    else if (urlLower.includes("dropbox")) provider = "Dropbox";
    else if (urlLower.includes("google")) provider = "Google Drive";
    else if (urlLower.includes("pixeldrain")) provider = "PixelDrain";
    else if (urlLower.includes("1fichier")) provider = "1Fichier";
    else if (urlLower.includes("1024terabox.com") || urlLower.includes("terabox")) provider = "Terabox";
    else if (urlLower.includes("rootz.so") || urlLower.includes("rootz")) provider = "Rootz";
    else if (urlLower.includes("vikingfile.com") || urlLower.includes("vikingfile")) provider = "VikingFile";
    else if (urlLower.includes("datanodes.to") || urlLower.includes("datanodes")) provider = "Datanodes";
    else if (urlLower.includes("/dls/") || urlLower.includes("getcomics.org/download")) {
      // Proxy/protected link — use the title attribute or text for the real provider name
      provider = titleAttr || $el.text().trim() || "GetComics Download";
    }

    // Extract file name from text
    const rawFileName = $el.text().trim();
    const fileName: string | undefined = !rawFileName || rawFileName.length > 100 ? undefined : rawFileName;


    links.push({
      provider,
      fileName,
      url: href,
      linkType,
      directDownloadCapable,
      manualActionRequired,
    });
  });

  return links;
}

async function scrapeListPage(
  url: string,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  const html = await fetchPage(url, options);
  const $ = cheerio.load(html);
  const items: NormalizedItem[] = [];

  // Try multiple possible post container selectors (WordPress themes vary)
  $("article, .post, .post-item, .entry, .blog-post").each((_, el) => {
    const $el = $(el);

    const titleEl = $el.find("h2 a, h3 a, .entry-title a, .post-title a").first();
    const title = titleEl.text().trim();
    const detailUrl = titleEl.attr("href");

    if (!title || !detailUrl) return;

    const coverUrl =
      $el.find("img").first().attr("src") ||
      $el.find(".post-thumbnail img, .entry-image img, .wp-post-image").attr("src");

    // Extract metadata from text content
    const text = $el.text();
    const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|Gb|Mb))/i);
    const dateMatch = text.match(/(\d{4}\.\d{2}\.\d{2})/);
    const publisherMatch = text.match(/(DC|Marvel|Image|Dark\s*Horse|Boom|IDW|Dynamite|Valiant|Vertigo|Rebellion|Aftershock|Vault|Abstract)/i);

    items.push({
      sourceId: "getcomics",
      title,
      detailUrl: detailUrl.startsWith("http") ? detailUrl : `${BASE_URL}${detailUrl}`,
      coverUrl: coverUrl?.startsWith("http") ? coverUrl : coverUrl ? `https:${coverUrl}` : undefined,
      publisher: publisherMatch?.[1],
      releaseDate: dateMatch?.[1]?.replace(/\./g, "-"),
      fileSize: sizeMatch?.[1],
      downloadLinks: [],
      description: $el.find(".entry-content p, .post-excerpt p, p").first().text().trim().slice(0, 500) as string | undefined,
      tags: [],
    });
  });

  // Also try a more generic approach
  if (items.length === 0) {
    $("a[href*='getcomics.org']").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");
      const title = $el.text().trim();
      if (!href || !title || title.length < 10) return;
      // Skip nav links
      if (href === BASE_URL || href === `${BASE_URL}/`) return;
      if (items.some((i) => i.detailUrl === href)) return;

      const parent = $el.parent();
      const coverImg = parent.find("img").first().attr("src") || $el.closest("div, article").find("img").first().attr("src");

      items.push({
        sourceId: "getcomics",
        title,
        detailUrl: href.startsWith("http") ? href : `${BASE_URL}${href}`,
        coverUrl: coverImg?.startsWith("http") ? coverImg : coverImg ? `https:${coverImg}` : undefined,
        downloadLinks: [],
      });
    });
  }

  return {
    title: `GetComics - ${url.split("/").pop() || "home"}`,
    items,
  };
}

async function scrapeDetailPage(
  url: string,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  const html = await fetchPage(url, options);
  const $ = cheerio.load(html);
  const title = $("h1, .entry-title, .post-title").first().text().trim() || "GetComics Detail";

  const $content = $(".entry-content, .post-content, .entry, article").first();
  const fullText = $content.text();

  // Cover image
  const coverUrl =
    $content.find("img").first().attr("src") ||
    $(".wp-post-image, .attachment-full, .post-thumbnail img").first().attr("src");

  // Metadata extraction
  const sizeMatch = fullText.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB))/i);
  const dateMatch =
    fullText.match(/(\d{4}\.\d{2}\.\d{2})/) ||
    fullText.match(/(\d{4}-\d{2}-\d{2})/);
  const publisherMatch = fullText.match(
    /(DC|Marvel|Image|Dark\s*Horse|Boom|IDW|Dynamite|Valiant|Vertigo|Rebellion|Aftershock|Vault|Abstract)/i
  );

  // Description (first few paragraphs)
  const descParagraphs: string[] = [];
  $content.find("p").each((_, el) => {
    const pText = $(el).text().trim();
    if (pText.length > 30 && !pText.toLowerCase().includes("download")) {
      descParagraphs.push(pText);
    }
  });
  const description = descParagraphs.slice(0, 3).join("\n\n");

  // Tags
  const tags: string[] = [];
  $("[rel='tag'], .tags a, .post-tags a").each((_, el) => {
    const tag = $(el).text().trim();
    if (tag) tags.push(tag);
  });

  // Download links
  const downloadLinks = extractDownloadLinks($, $content);

  // Parse format from title/description
  let format: string | undefined;
  const formatMatch = fullText.match(/\b(CBR|CBZ|PDF|EPUB|MOBI)\b/i);
  if (formatMatch) format = formatMatch[1].toUpperCase();

  const item: NormalizedItem = {
    sourceId: "getcomics",
    title,
    detailUrl: url,
    coverUrl: coverUrl?.startsWith("http") ? coverUrl : coverUrl ? `https:${coverUrl}` : undefined,
    publisher: publisherMatch?.[1],
    releaseDate: dateMatch?.[1]?.replace(/\./g, "-"),
    fileSize: sizeMatch?.[1],
    format,
    description: description || undefined,
    tags: tags.length > 0 ? tags : undefined,
    downloadLinks,
  };

  return {
    title,
    items: [item],
  };
}
