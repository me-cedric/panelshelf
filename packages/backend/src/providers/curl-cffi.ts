import { request } from "undici";
import { config } from "../config";

interface CurlCffiFetchRequest {
  url: string;
  impersonate?: string;
  max_timeout?: number;
}

interface CurlCffiFetchResponse {
  success: boolean;
  html?: string;
  url?: string;
  status_code?: number;
  elapsed_ms?: number;
  error?: string;
}

/**
 * Fetch a URL via the curl_cffi Python sidecar, bypassing Cloudflare
 * TLS fingerprint detection.
 *
 * curl_cffi uses curl-impersonate under the hood to mimic browser
 * TLS/JA3 fingerprints, which is more lightweight than a full headless
 * browser (Playwright) and often effective against Cloudflare challenges.
 *
 * Returns the HTML body string on success, or null if the fetch failed.
 *
 * Throws if the sidecar is not configured (CURL_CFFI_URL is not set).
 */
export async function fetchViaCurlCffi(
  url: string,
  options?: { signal?: AbortSignal; maxTimeout?: number }
): Promise<string | null> {
  if (!config.curlCffiUrl) {
    throw new Error("curl_cffi sidecar is not configured — set CURL_CFFI_URL in your environment");
  }

  const body: CurlCffiFetchRequest = {
    url,
    max_timeout: options?.maxTimeout ?? 30000,
    impersonate: "chrome120",
  };

  const resp = await request(config.curlCffiUrl, {
    method: "POST",
    signal: options?.signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (resp.statusCode !== 200) {
    throw new Error(`curl_cffi sidecar returned HTTP ${resp.statusCode}`);
  }

  const data = JSON.parse(await resp.body.text()) as CurlCffiFetchResponse;

  if (!data.success) {
    console.warn(`[curl_cffi] Fetch failed for ${url}: ${data.error}`);
    return null;
  }

  return data.html ?? null;
}

/**
 * Returns true when the curl_cffi sidecar is configured.
 */
export function isCurlCffiConfigured(): boolean {
  return Boolean(config.curlCffiUrl);
}
