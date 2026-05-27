import { request } from "undici";
import type {
  ProviderAdapter,
  ProviderInspectionResult,
  DownloadRequest,
  DownloadResult,
  NormalizedItem,
  NormalizedDownloadLink,
} from "../types";

const BASE_URL = "https://archive.org";

/** Normalize IA API fields that can be either a string or an array of strings. */
function asStr(val: string | string[] | undefined): string | undefined {
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}

function asStrArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split(";").map((s) => s.trim()).filter(Boolean);
}

export const internetArchiveProvider: ProviderAdapter = {
  id: "internetarchive",
  name: "Internet Archive",
  canHandle(url: string) {
    return (
      url.includes("archive.org") &&
      !url.includes("blog.archive.org") &&
      !url.includes("help.archive.org")
    );
  },

  async inspect(
    url: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string>; maxPages?: number }
  ): Promise<ProviderInspectionResult> {
    // Normalize the URL
    const parsed = new URL(url);

    // Determine URL type
    const isDetailsPage = parsed.pathname.startsWith("/details/");
    const isSearchPage =
      parsed.pathname.startsWith("/search") ||
      parsed.pathname === "/advancedsearch.php";

    if (isDetailsPage) {
      // Extract identifier from /details/<identifier>
      const identifier = parsed.pathname.replace("/details/", "").split("/")[0];
      if (!identifier) {
        return {
          title: "Internet Archive",
          items: [],
          error: "Invalid details page URL — no identifier found",
        };
      }
      return inspectDetail(identifier, options);
    }

    if (isSearchPage) {
      const query = parsed.searchParams.get("query") || parsed.searchParams.get("q") || "";
      const page = parseInt(parsed.searchParams.get("page") || "1", 10);

      // If no query, default to comics collection browse
      const effectiveQuery = query || "collection:comics";
      return searchArchive(effectiveQuery, page, options);
    }

    // Fallback: treat base URL as a browse-all search through the collection
    // When maxPages is set (refresh mode), paginate through multiple pages
    const maxPages = options?.maxPages ?? 1;
    if (maxPages > 1) {
      return searchArchivePaginated("collection:comics", maxPages, options);
    }
    return searchArchive("collection:comics", 1, options);
  },

  async download(downloadReq: DownloadRequest): Promise<DownloadResult> {
    try {
      const resp = await request(downloadReq.url, {
        method: "GET",
        signal: downloadReq.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      const contentLength = resp.headers["content-length"];
      const totalBytes = contentLength ? parseInt(String(contentLength), 10) : undefined;

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

/**
 * Fetch JSON from a URL with proper headers and error handling.
 */
async function fetchJson<T>(url: string, options?: { signal?: AbortSignal }): Promise<T> {
  const resp = await request(url, {
    method: "GET",
    signal: options?.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (resp.statusCode !== 200) {
    throw new Error(`Internet Archive API returned HTTP ${resp.statusCode}`);
  }

  return JSON.parse(await resp.body.text());
}

/**
 * Inspect a single item via its metadata API.
 * GET https://archive.org/metadata/<identifier>
 */
async function inspectDetail(
  identifier: string,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  const data = await fetchJson<{
    metadata: {
      identifier: string;
      title?: string | string[];
      creator?: string | string[];
      date?: string | string[];
      description?: string | string[];
      publisher?: string | string[];
      language?: string | string[];
      subject?: string | string[];
      collection?: string | string[];
    };
    files: Array<{
      name: string;
      source: string;
      format: string;
      size?: string;
      mtime?: string;
      crc32?: string;
      md5?: string;
      sha1?: string;
    }>;
  }>(`${BASE_URL}/metadata/${identifier}`, options);

  const meta = data.metadata;
  const title = asStr(meta.title) || identifier;

  // Extract the cover image URL
  const coverUrl = `${BASE_URL}/services/img/${identifier}`;

  // Filter files to find comic-related files
  const comicFormats = new Set([
    "Comic Book ZIP",
    "Comic Book RAR",
    "Comic Book Zip",
    "Comic Book Rar",
    "CBZ",
    "CBR",
    "PDF",
    "EPUB",
    "Text PDF",
    "Encrypted PDF",
  ]);

  const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

  const downloadLinks: NormalizedDownloadLink[] = [];
  let format: string | undefined;
  let fileSize: string | undefined;

  for (const file of data.files) {
    const fileName = file.name;

    // Skip metadata files and source files
    if (file.source !== "original") continue;
    if (fileName === `${identifier}_meta.xml`) continue;
    if (fileName === `${identifier}_archive.torrent`) continue;
    if (fileName === `${identifier}_files.xml`) continue;
    if (fileName.endsWith(".torrent")) continue;
    if (fileName.endsWith(".xml")) continue;

    // Detect comic format from the format field or file extension
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const isComicFormat = comicFormats.has(file.format);
    const isImage = imageExtensions.has(`.${ext}`);

    // If this is a comic file (CBZ/CBR/PDF), add a download link
    if (isComicFormat || ext === "cbz" || ext === "cbr" || ext === "pdf") {
      const downloadUrl = `${BASE_URL}/download/${identifier}/${fileName}`;

      // Determine the link type
      let linkType: NormalizedDownloadLink["linkType"] = "direct";
      let manualActionRequired = false;
      let directDownloadCapable = true;

      if (ext === "pdf") {
        // PDFs are fully downloadable
        linkType = "direct";
      }

      downloadLinks.push({
        provider: "Internet Archive",
        fileName,
        size: file.size ? formatBytes(parseInt(file.size, 10)) : undefined,
        url: downloadUrl,
        linkType,
        directDownloadCapable,
        manualActionRequired,
      });

      // Use the first comic file's format and size for the item metadata
      if (!format) {
        format = ext.toUpperCase();
        if (file.size) fileSize = formatBytes(parseInt(file.size, 10));
      }
    }
  }

  // Parse publisher from metadata
  const publisher = asStr(meta.publisher) || asStr(meta.creator) || undefined;

  // Parse release year
  let releaseDate: string | undefined;
  const rawDate = asStr(meta.date);
  if (rawDate) {
    const yearMatch = rawDate.match(/(\d{4})/);
    if (yearMatch) releaseDate = yearMatch[1];
  }

  // Parse tags/subjects
  const tags: string[] = [];
  tags.push(...asStrArray(meta.subject));
  if (publisher) tags.push(publisher);

  // Description
  const rawDesc = asStr(meta.description);
  const description = rawDesc
    ? rawDesc.replace(/<[^>]*>/g, "").trim().slice(0, 1000)
    : undefined;

  // Language
  let language: string | undefined;
  const rawLang = asStr(meta.language);
  if (rawLang) {
    // Map common IA language codes (e.g., "eng" → "en")
    const langMap: Record<string, string> = {
      eng: "en",
      spa: "es",
      fre: "fr",
      ger: "de",
      ita: "it",
      por: "pt",
      rus: "ru",
      jpn: "ja",
      chi: "zh",
    };
    language = langMap[rawLang] || rawLang.slice(0, 2);
  }

  const item: NormalizedItem = {
    sourceId: "internetarchive",
    title,
    series: asStr(meta.collection),
    publisher,
    releaseDate,
    language,
    format,
    fileSize,
    description,
    coverUrl,
    detailUrl: `${BASE_URL}/details/${identifier}`,
    tags: tags.length > 0 ? tags : undefined,
    downloadLinks,
  };

  return {
    title: title || "Internet Archive",
    items: [item],
  };
}

/**
 * Search the Internet Archive using the Advanced Search API.
 * GET https://archive.org/advancedsearch.php?q=<query>&fl[]=...&output=json&rows=50&page=<page>
 */
async function searchArchive(
  query: string,
  page: number = 1,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  // Build the fields we want
  const fields = [
    "identifier",
    "title",
    "creator",
    "date",
    "description",
    "publisher",
    "language",
    "subject",
    "format",
    "collection",
  ];

  const fieldParams = fields.map((f) => `fl[]=${encodeURIComponent(f)}`).join("&");

  const searchUrl =
    `${BASE_URL}/advancedsearch.php?q=${encodeURIComponent(query)}&${fieldParams}&output=json&rows=50&page=${page}&sort[]=date+desc`;

  const data = await fetchJson<{
    responseHeader: { status: number; QTime: number; params: Record<string, any> };
    response: {
      numFound: number;
      start: number;
      docs: Array<{
        identifier: string;
        title?: string | string[];
        creator?: string | string[];
        date?: string | string[];
        description?: string | string[];
        publisher?: string | string[];
        language?: string | string[];
        subject?: string | string[];
        format?: string | string[];
        collection?: string | string[];
      }>;
    };
  }>(searchUrl, options);

  const docs = data.response?.docs || [];
  const numFound = data.response?.numFound || 0;

  const items: NormalizedItem[] = [];

  for (const doc of docs) {
    const identifier = doc.identifier;
    const title = asStr(doc.title) || identifier;

    // Skip items without files (metadata-only records)
    if (!identifier) continue;

    // Use the generated thumbnail for cover
    const coverUrl = `${BASE_URL}/services/img/${identifier}`;

    // Parse year
    let releaseDate: string | undefined;
    const docDate = asStr(doc.date);
    if (docDate) {
      const yearMatch = docDate.match(/(\d{4})/);
      if (yearMatch) releaseDate = yearMatch[1];
    }

    // Subjects → tags
    const publisher = asStr(doc.publisher) || asStr(doc.creator) || undefined;
    const tags: string[] = [];
    tags.push(...asStrArray(doc.subject));
    if (publisher) tags.push(publisher);

    // Language
    let language: string | undefined;
    const docLang = asStr(doc.language);
    if (docLang) {
      const langMap: Record<string, string> = {
        eng: "en",
        spa: "es",
        fre: "fr",
        ger: "de",
        ita: "it",
        por: "pt",
        rus: "ru",
        jpn: "ja",
        chi: "zh",
      };
      language = langMap[docLang] || docLang.slice(0, 2);
    }

    const rawDocDesc = asStr(doc.description);
    items.push({
      sourceId: "internetarchive",
      id: identifier,
      title,
      publisher,
      releaseDate,
      language,
      description: rawDocDesc
        ? rawDocDesc.replace(/<[^>]*>/g, "").trim().slice(0, 500)
        : undefined,
      coverUrl,
      detailUrl: `${BASE_URL}/details/${identifier}`,
      tags: tags.length > 0 ? tags : undefined,
      downloadLinks: [], // Will be populated when user navigates to the detail page
    });
  }

  return {
    title: `Internet Archive — "${query}" (page ${page})`,
    items,
    totalResults: numFound,
    error: items.length === 0 ? "No comics found matching your query on the Internet Archive." : undefined,
  };
}

/**
 * Paginate through multiple pages of the IA Advanced Search API.
 * Used during source refresh to ingest more than 50 items.
 */
async function searchArchivePaginated(
  query: string,
  maxPages: number,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<ProviderInspectionResult> {
  if (maxPages < 1) {
    return { title: `Internet Archive — "${query}"`, items: [], totalResults: 0 };
  }

  const allItems: NormalizedItem[] = [];
  let title = `Internet Archive — "${query}"`;
  let lastError: string | undefined;
  let totalResults = 0;

  // Fetch page 1 first to get totalResults
  const page1 = await searchArchive(query, 1, options);
  allItems.push(...page1.items);
  title = page1.title;
  totalResults = page1.totalResults ?? 0;
  if (page1.error) lastError = page1.error;

  // If page 1 returned a full page, fetch more
  const ITEMS_PER_PAGE = 50;
  const totalPages = Math.min(
    Math.ceil(totalResults / ITEMS_PER_PAGE),
    maxPages
  );

  for (let page = 2; page <= totalPages; page++) {
    if (options?.signal?.aborted) break;

    try {
      // Rate limit: 300ms between pages to avoid hammering the IA API
      await new Promise((r) => setTimeout(r, 300));
      const result = await searchArchive(query, page, options);
      allItems.push(...result.items);
    } catch (err: any) {
      console.error(`[IA] Error fetching page ${page}:`, err.message);
      lastError = `Failed to fetch page ${page}: ${err.message}`;
      break; // Stop on error, keep items from successful pages
    }
  }

  return {
    title,
    items: allItems,
    totalResults,
    error: lastError,
  };
}

/**
 * Format bytes into a human-readable size string.
 */
function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}
