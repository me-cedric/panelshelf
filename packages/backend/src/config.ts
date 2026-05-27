import path from "node:path";

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  host: process.env.HOST || "0.0.0.0",
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
  downloadDir: process.env.DOWNLOAD_DIR || path.join(process.cwd(), "data", "downloads"),
  maxConcurrentDownloads: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || "3", 10),
  defaultRefreshIntervalMin: parseInt(process.env.DEFAULT_REFRESH_INTERVAL_MIN || "60", 10),
  autoScanOnStart: process.env.AUTO_SCAN_ON_START === "true",
  logLevel: process.env.LOG_LEVEL || "info",
  isDev: process.env.NODE_ENV !== "production",
  // Optional FlareSolverr proxy for Cloudflare-protected sites (e.g. zipcomic.com).
  // Set to the FlareSolverr API endpoint, e.g. "http://flaresolverr:8191/v1"
  flareSolverrUrl: process.env.FLARESOLVERR_URL || "",
  // Optional curl_cffi sidecar for lightweight Cloudflare bypass (TLS fingerprint impersonation).
  // Set to the sidecar endpoint, e.g. "http://localhost:8192/fetch"
  curlCffiUrl: process.env.CURL_CFFI_URL || "",

};
