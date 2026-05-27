// ── Provider Adapter Architecture ──

export interface NormalizedItem {
  id?: string;
  sourceId: string;
  title: string;
  series?: string;
  issueNumber?: string;
  volume?: string;
  publisher?: string;
  releaseDate?: string;
  language?: string;
  format?: string;
  fileSize?: string;
  fileSizeBytes?: number;
  tags?: string[];
  description?: string;
  coverUrl?: string;
  detailUrl?: string;
  downloadLinks: NormalizedDownloadLink[];
}

export interface NormalizedDownloadLink {
  provider: string;
  fileName?: string;
  size?: string;
  url: string;
  linkType: "direct" | "redirect" | "manual" | "unknown";
  directDownloadCapable: boolean;
  manualActionRequired: boolean;
}

export interface ProviderInspectionResult {
  title: string;
  items: NormalizedItem[];
  error?: string;
  /** Total results available (used by paginated APIs like Internet Archive) */
  totalResults?: number;
}

export interface DownloadRequest {
  url: string;
  fileName?: string;
  destinationPath: string;
  onProgress?: (downloadedBytes: number, totalBytes?: number) => void;
  signal?: AbortSignal;
}

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  totalBytes?: number;
  error?: string;
}

export interface ProviderAdapter {
  id: string;
  name: string;
  canHandle(url: string): boolean;
  inspect(url: string, options?: ProviderInspectOptions): Promise<ProviderInspectionResult>;
  download(request: DownloadRequest): Promise<DownloadResult>;
}

export interface ProviderInspectOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Optional rate limiting in ms between requests */
  rateLimitMs?: number;
  /** Optional headers to include in requests */
  headers?: Record<string, string>;
  /** Max pages to sync during refresh (for paginated feeds). Default no limit */
  maxPages?: number;
}

/** Create a stable hash for deduplication */
export function createStableHash(item: {
  title: string;
  issueNumber?: string;
  publisher?: string;
  releaseDate?: string;
  sourceId: string;
}): string {
  const parts = [
    item.title?.toLowerCase().trim() || "",
    item.issueNumber?.toLowerCase().trim() || "",
    item.publisher?.toLowerCase().trim() || "",
    item.releaseDate?.trim() || "",
    item.sourceId,
  ];
  // Simple hash function
  const str = parts.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36) + "_" + str.length.toString(36);
}
