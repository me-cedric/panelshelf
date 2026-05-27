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

export const manualUrlProvider: ProviderAdapter = {
  id: "manual-url",
  name: "Manual URL",
  canHandle(_url: string) {
    return true; // Can attempt to inspect any URL
  },

  async inspect(
    url: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string> }
  ): Promise<ProviderInspectionResult> {
    try {
      const resp = await request(url, {
        method: "GET",
        signal: options?.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ...options?.headers,
        },
      });

      const contentType = resp.headers["content-type"] || "";
      const html = await resp.body.text();

      // Try to parse as HTML for metadata
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        const $ = cheerio.load(html);
        const title =
          $("h1").first().text().trim() ||
          $("title").text().trim() ||
          "Manual URL Entry";
        const description = $("meta[name='description']").attr("content") || "";
        const coverUrl =
          $("meta[property='og:image']").attr("content") ||
          $("meta[name='twitter:image']").attr("content");

        // Extract links
        const downloadLinks: NormalizedDownloadLink[] = [];
        $("a[href]").each((_, el) => {
          const linkUrl = $(el).attr("href")!;
          const text = $(el).text().trim();
          if (
            linkUrl.match(/mega\.nz|mediafire|zippyshare|dropbox|google/i) ||
            text.toLowerCase().includes("download")
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
              fileName: text.length <= 100 ? text : undefined,
              url: linkUrl,
              linkType: "redirect",
              directDownloadCapable: urlLower.includes("mega.nz") || urlLower.includes("dropbox"),
              manualActionRequired: !urlLower.includes("mega.nz") && !urlLower.includes("dropbox"),
            });
          }
        });

        return {
          title,
          items: [
            {
              sourceId: "manual-url",
              title,
              description: description || undefined,
              detailUrl: url,
              coverUrl: coverUrl || undefined,
              downloadLinks,
            },
          ],
        };
      }

      // Plain URL - treat as direct download
      const fileName = url.split("/").pop() || "download";
      return {
        title: fileName,
        items: [
          {
            sourceId: "manual-url",
            title: fileName,
            detailUrl: url,
            downloadLinks: [
              {
                provider: "Direct Download",
                fileName,
                url,
                linkType: "direct",
                directDownloadCapable: true,
                manualActionRequired: false,
              },
            ],
          },
        ],
      };
    } catch (err: any) {
      return {
        title: "Error",
        items: [],
        error: `Failed to inspect URL: ${err.message}`,
      };
    }
  },

  async download(downloadReq: DownloadRequest): Promise<DownloadResult> {
    try {
      const resp = await request(downloadReq.url, {
        method: "GET",
        signal: downloadReq.signal,
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
